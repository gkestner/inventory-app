// app/api/admin/users/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcrypt";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { Permission, Role } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

type AdminSession = {
  user?: {
    role?: Role | null;
  } | null;
} | null;

type CreateUserBody = {
  name: string;
  email: string;
  password: string;
  role: Role;

  // Primary/default location (back-compat)
  locationId?: string | null;

  // Optional allowed locations (ordered)
  optionalLocationIds?: string[]; // preferred
  allowedLocationIds?: string[]; // alias
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizeLocationId(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function normalizeStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (!isNonEmptyString(x)) continue;
    out.push(x.trim());
  }
  // de-dupe (preserve order)
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const s of out) {
    if (seen.has(s)) continue;
    seen.add(s);
    uniq.push(s);
  }
  return uniq;
}

function isCreateUserBody(v: unknown): v is CreateUserBody {
  if (!isRecord(v)) return false;

  const role = (v as { role?: unknown }).role;
  const okRole = role === Role.ADMIN || role === Role.MANAGER || role === Role.EMPLOYEE;
  if (!okRole) return false;

  const name = (v as { name?: unknown }).name;
  const email = (v as { email?: unknown }).email;
  const password = (v as { password?: unknown }).password;

  if (typeof name !== "string") return false;
  if (typeof email !== "string") return false;
  if (typeof password !== "string") return false;

  // locationId may be absent/null/string
  const loc = (v as { locationId?: unknown }).locationId;
  const okLoc = loc === undefined || loc === null || typeof loc === "string";
  if (!okLoc) return false;

  // optional arrays (if present) must be arrays
  const opt = (v as { optionalLocationIds?: unknown }).optionalLocationIds;
  const allowed = (v as { allowedLocationIds?: unknown }).allowedLocationIds;

  if (opt !== undefined && !Array.isArray(opt)) return false;
  if (allowed !== undefined && !Array.isArray(allowed)) return false;

  return true;
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions)) as AdminSession;

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const perms = await loadUserPermissions(session);
  const canEditUsers = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_USERS]);
  if (!canEditUsers) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isCreateUserBody(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const b = body as CreateUserBody;

  const name = b.name.trim();
  const emailLower = b.email.trim().toLowerCase();
  const password = b.password;
  const role = b.role;

  const locationId = normalizeLocationId(b.locationId);

  // optional locations: prefer optionalLocationIds, but allow allowedLocationIds alias
  const optionalLocationIds =
    normalizeStringArray(b.optionalLocationIds).length > 0
      ? normalizeStringArray(b.optionalLocationIds)
      : normalizeStringArray(b.allowedLocationIds);

  if (!name || !emailLower || !password || !role) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // If primary location is also in optional list, remove it (primary is already tracked on User.locationId)
  const filteredOptional =
    locationId ? optionalLocationIds.filter((id) => id !== locationId) : optionalLocationIds;

  // Validate email uniqueness before hashing (fast fail)
  const existing = await prisma.user.findUnique({
    where: { email: emailLower },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json({ error: "Email already exists" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const created = await prisma.$transaction(async (tx) => {
      // Validate location ids exist (atomic correctness; no partial create with bad ids)
      const idsToCheck = [
        ...(locationId ? [locationId] : []),
        ...filteredOptional,
      ];

      if (idsToCheck.length > 0) {
        const found = await tx.location.findMany({
          where: { id: { in: idsToCheck } },
          select: { id: true },
        });

        const foundSet = new Set(found.map((x) => x.id));
        const missing = idsToCheck.filter((id) => !foundSet.has(id));
        if (missing.length > 0) {
          throw new Error(
            `Invalid locationId(s): ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? "…" : ""}`
          );
        }
      }

      const user = await tx.user.create({
        data: {
          name,
          email: emailLower,
          passwordHash,
          role,
          active: true,
          locationId: locationId ?? null,
        },
      });

      if (filteredOptional.length > 0) {
        await tx.userLocation.createMany({
          data: filteredOptional.map((locId, idx) => ({
            userId: user.id,
            locationId: locId,
            sortOrder: idx, // stable, ordered list
          })),
        });
      }

      // Keep response stable (same as before: return user)
      return user;
    });

    return NextResponse.json(created);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Create user failed";
    // Bad input (missing location ids) -> 400, everything else -> 500
    const status = msg.startsWith("Invalid locationId") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
