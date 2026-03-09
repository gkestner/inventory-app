// app/lib/prisma.ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Vercel/Next can evaluate server modules during `next build` (e.g. collecting page data for /_not-found).
 * If PrismaClient is constructed at module scope during that phase, builds can fail.
 *
 * Solution: NEVER construct Prisma at module scope.
 * Export a lazy proxy that constructs PrismaClient only when actually used at runtime.
 */
const isBuildTimeEvaluation =
  process.env.npm_lifecycle_event === "build" ||
  process.env.NEXT_PHASE === "phase-production-build";

let client: PrismaClient | undefined = globalForPrisma.prisma;

const DEMO_MODE_COOKIE = "admin_demo_mode";

const WRITE_MODEL_METHODS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

const TRUTHY_QUERY_VALUES = new Set(["1", "true", "yes", "on"]);

function getClient(): PrismaClient {
  if (!client) {
    client = new PrismaClient({ log: ["error"] });

    // Keep the typical dev hot-reload cache behavior.
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = client;
    }
  }
  return client;
}

function throwIfBuildTime() {
  if (isBuildTimeEvaluation) {
    throw new Error(
      "Prisma client was accessed during Next.js build-time evaluation. " +
        "A module is doing DB/auth work at build time (often at module scope). " +
        "Move DB access to request-time."
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function isDemoModeActiveForRequest(): Promise<boolean> {
  if (TRUTHY_QUERY_VALUES.has(String(process.env.ADMIN_DEMO_MODE_FORCE ?? "").trim().toLowerCase())) {
    return true;
  }

  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const raw = String(jar.get(DEMO_MODE_COOKIE)?.value ?? "").trim().toLowerCase();
    return TRUTHY_QUERY_VALUES.has(raw);
  } catch {
    return false;
  }
}

function selectProjection(select: unknown, source: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(select)) return source;

  const out: Record<string, unknown> = {};
  for (const [key, flag] of Object.entries(select)) {
    if (flag === true) {
      out[key] = key in source ? source[key] : null;
      continue;
    }
    if (isPlainObject(flag)) {
      const nestedSelect = (flag as Record<string, unknown>).select;
      const nestedSource = isPlainObject(source[key]) ? (source[key] as Record<string, unknown>) : {};
      out[key] = selectProjection(nestedSelect, nestedSource);
    }
  }
  return out;
}

function buildMockMutationResult(methodName: string, args: unknown[]): unknown {
  if (methodName === "createMany" || methodName === "updateMany" || methodName === "deleteMany") {
    return { count: 0 };
  }
  if (methodName === "createManyAndReturn" || methodName === "updateManyAndReturn") {
    return [];
  }

  const first = isPlainObject(args[0]) ? (args[0] as Record<string, unknown>) : {};
  const data = isPlainObject(first.data) ? { ...first.data } : {};
  const where = isPlainObject(first.where) ? first.where : {};

  if (!("id" in data)) {
    const whereId = typeof where.id === "string" ? where.id : null;
    data.id = whereId ?? `demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  const merged: Record<string, unknown> = {
    ...where,
    ...data,
    updatedAt: new Date(),
  };

  if (isPlainObject(first.select)) {
    return selectProjection(first.select, merged);
  }

  return merged;
}

function createModelDelegateProxy(delegate: Record<PropertyKey, unknown>) {
  return new Proxy(delegate, {
    get(target, methodProp: PropertyKey) {
      const value = target[methodProp];
      if (typeof value !== "function") return value;

      const methodName = String(methodProp);
      if (!WRITE_MODEL_METHODS.has(methodName)) {
        return (value as (...args: unknown[]) => unknown).bind(target);
      }

      return async (...args: unknown[]) => {
        if (await isDemoModeActiveForRequest()) {
          return buildMockMutationResult(methodName, args);
        }
        return (value as (...innerArgs: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

function createPrismaLikeProxy(prismaLike: Record<PropertyKey, unknown>) {
  return new Proxy(prismaLike, {
    get(target, prop: PropertyKey) {
      const value = target[prop];

      if (typeof value === "function") {
        const fnName = String(prop);

        if (fnName === "$executeRaw" || fnName === "$executeRawUnsafe") {
          return async (...args: unknown[]) => {
            if (await isDemoModeActiveForRequest()) {
              return 0;
            }
            return (value as (...innerArgs: unknown[]) => unknown).apply(target, args);
          };
        }

        if (fnName === "$transaction") {
          return async (...args: unknown[]) => {
            if (!(await isDemoModeActiveForRequest())) {
              return (value as (...innerArgs: unknown[]) => unknown).apply(target, args);
            }

            const firstArg = args[0];

            if (typeof firstArg === "function") {
              const callback = firstArg as (tx: unknown) => unknown;
              const simulatedTx = createPrismaLikeProxy(target);
              return callback(simulatedTx);
            }

            if (Array.isArray(firstArg)) {
              return Promise.all(firstArg as Array<Promise<unknown>>);
            }

            return (value as (...innerArgs: unknown[]) => unknown).apply(target, args);
          };
        }

        return (value as (...innerArgs: unknown[]) => unknown).bind(target);
      }

      if (isPlainObject(value)) {
        return createModelDelegateProxy(value as Record<PropertyKey, unknown>);
      }

      return value;
    },
  });
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop: PropertyKey) {
    throwIfBuildTime();

    const c = getClient();
    const proxied = createPrismaLikeProxy(c as unknown as Record<PropertyKey, unknown>);
    const value = proxied[prop];

    // Ensure methods keep correct `this` binding.
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(c);
    }

    return value;
  },

  // ✅ IMPORTANT: makes `"modelName" in prisma` work
  has(_target, prop: PropertyKey) {
    throwIfBuildTime();
    const c = getClient();
    return prop in (c as unknown as Record<PropertyKey, unknown>);
  },

  // ✅ Helps some reflection-based checks (rare, but nice to have)
  ownKeys() {
    throwIfBuildTime();
    return Reflect.ownKeys(getClient() as unknown as object);
  },

  // ✅ Keeps TS/JS runtime happy when using reflection
  getOwnPropertyDescriptor(_target, prop: PropertyKey) {
    throwIfBuildTime();
    const desc = Object.getOwnPropertyDescriptor(getClient() as unknown as object, prop);
    if (desc) return desc;

    // Fallback: if it exists, claim it's configurable so reflection doesn't explode
    const c = getClient() as unknown as Record<PropertyKey, unknown>;
    if (prop in c) {
      return { configurable: true, enumerable: true };
    }
    return undefined;
  },
});