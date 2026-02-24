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

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop: PropertyKey) {
    // If anything attempts to use Prisma during build-time evaluation,
    // throw a crisp error so we can find the offending module.
    if (isBuildTimeEvaluation) {
      throw new Error(
        "Prisma client was accessed during Next.js build-time evaluation. " +
          "A module is doing DB/auth work at build time (often at module scope). " +
          "Move DB access to request-time."
      );
    }

    const c = getClient();

    // Avoid `any` while still allowing dynamic property access.
    const value = (c as unknown as Record<PropertyKey, unknown>)[prop];

    // Ensure methods keep correct `this` binding.
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(c);
    }

    return value;
  },
});