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

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop: PropertyKey) {
    throwIfBuildTime();

    const c = getClient();
    const value = (c as unknown as Record<PropertyKey, unknown>)[prop];

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