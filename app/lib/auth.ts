// app/lib/auth.ts
import type { NextAuthOptions } from "next-auth";
import type { DefaultSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { prisma } from "@/app/lib/prisma";
import { Role } from "@prisma/client";

/**
 * NextAuth type augmentation.
 *
 * IMPORTANT:
 * Do NOT extend DefaultUser here. In some NextAuth/TS setups, DefaultUser resolves to (or is
 * widened by) the augmented `User` interface, which can produce:
 *   "Type 'User' recursively references itself as a base type."
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;

      /**
       * Legacy single location (kept for compatibility).
       * This remains the canonical "current location" for existing code paths.
       */
      locationId: string | null;

      /**
       * Multi-location support (ordered).
       * - primaryLocationIds: all locations flagged primary (order preserved)
       * - optionalLocationIds: all optional locations (order preserved)
       * - allowedLocationIds: primary then optional (order preserved, deduped)
       */
      primaryLocationIds: string[];
      optionalLocationIds: string[];
      allowedLocationIds: string[];

      active: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;

    role: Role;
    locationId: string | null;

    primaryLocationIds: string[];
    optionalLocationIds: string[];
    allowedLocationIds: string[];

    active: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: Role;
    locationId?: string | null;

    primaryLocationIds?: string[];
    optionalLocationIds?: string[];
    allowedLocationIds?: string[];

    active?: boolean;
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function uniqPreserveOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeLocationLists(input: {
  legacyLocationId: string | null;
  primaryLocationIds: string[];
  optionalLocationIds: string[];
}): {
  legacyLocationId: string | null;
  primaryLocationIds: string[];
  optionalLocationIds: string[];
  allowedLocationIds: string[];
} {
  // Enforce invariants:
  // - primary + optional are ordered & deduped
  // - no overlaps (primary wins)
  // - allowed = primary then optional (deduped, stable)
  const prim = uniqPreserveOrder(input.primaryLocationIds);
  const optRaw = uniqPreserveOrder(input.optionalLocationIds);

  const primSet = new Set(prim);
  const opt = optRaw.filter((id) => !primSet.has(id));

  // Legacy safety:
  // - If legacyLocationId is missing but primary exists, mirror primary[0]
  // - If user has *no* join rows yet but legacyLocationId exists, treat legacy as primary[0]
  let legacy = input.legacyLocationId ? String(input.legacyLocationId).trim() : "";
  if (!legacy) {
    if (prim.length > 0) legacy = prim[0];
    else if (opt.length > 0) legacy = opt[0];
  }

  const primFinal = prim.length > 0 ? prim : legacy ? [legacy] : [];
  const optFinal = opt.filter((id) => !primFinal.includes(id));

  const allowed = uniqPreserveOrder([...primFinal, ...optFinal]);

  return {
    legacyLocationId: legacy ? legacy : null,
    primaryLocationIds: primFinal,
    optionalLocationIds: optFinal,
    allowedLocationIds: allowed,
  };
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const emailRaw = credentials?.email;
        const passwordRaw = credentials?.password;

        const email = isNonEmptyString(emailRaw) ? emailRaw.trim().toLowerCase() : "";
        const password = isNonEmptyString(passwordRaw) ? passwordRaw : "";

        if (!email || !password) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            name: true,
            email: true,
            passwordHash: true,
            role: true,
            locationId: true,
            active: true,
            allowedLocations: {
              select: {
                locationId: true,
                isPrimary: true,
                sortOrder: true,
                location: { select: { active: true } },
              },
              // Primary first, then explicit ordering within each group.
              // NOTE: we intentionally keep assigned inactive locations for stability/testing.
              orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
            },
          },
        });

        if (!user) return null;
        if (!user.active) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        const primaryFromJoin = user.allowedLocations.filter((r) => r.isPrimary).map((r) => r.locationId);
        const optionalFromJoin = user.allowedLocations.filter((r) => !r.isPrimary).map((r) => r.locationId);

        const normalized = normalizeLocationLists({
          legacyLocationId: user.locationId,
          primaryLocationIds: primaryFromJoin,
          optionalLocationIds: optionalFromJoin,
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,

          // Legacy + multi-location
          locationId: normalized.legacyLocationId,
          primaryLocationIds: normalized.primaryLocationIds,
          optionalLocationIds: normalized.optionalLocationIds,
          allowedLocationIds: normalized.allowedLocationIds,

          active: user.active,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in, NextAuth passes `user` (from authorize).
      if (user) {
        const primary = Array.isArray(user.primaryLocationIds) ? user.primaryLocationIds : [];
        const optional = Array.isArray(user.optionalLocationIds) ? user.optionalLocationIds : [];

        const normalized = normalizeLocationLists({
          legacyLocationId: (user.locationId ?? null) as string | null,
          primaryLocationIds: primary,
          optionalLocationIds: optional,
        });

        token.uid = user.id;
        token.role = user.role;
        token.locationId = normalized.legacyLocationId;

        token.primaryLocationIds = normalized.primaryLocationIds;
        token.optionalLocationIds = normalized.optionalLocationIds;
        token.allowedLocationIds = normalized.allowedLocationIds;

        token.active = user.active;
      }

      return token;
    },
    async session({ session, token }) {
      const uid = typeof token.uid === "string" ? token.uid : "";
      const role = token.role ?? Role.EMPLOYEE;

      const primary = Array.isArray(token.primaryLocationIds) ? token.primaryLocationIds : [];
      const optional = Array.isArray(token.optionalLocationIds) ? token.optionalLocationIds : [];

      const normalized = normalizeLocationLists({
        legacyLocationId: (token.locationId ?? null) as string | null,
        primaryLocationIds: primary,
        optionalLocationIds: optional,
      });

      session.user = {
        ...(session.user ?? {}),
        id: uid,
        role,

        locationId: normalized.legacyLocationId,

        primaryLocationIds: normalized.primaryLocationIds,
        optionalLocationIds: normalized.optionalLocationIds,
        allowedLocationIds: normalized.allowedLocationIds,

        active: Boolean(token.active ?? true),
      };

      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
