// app/lib/permissions.ts
import { prisma } from "@/app/lib/prisma";
import { Permission, Role } from "@prisma/client";

/**
 * Canonical server-side permission loader.
 *
 * Rules:
 * - ADMIN role => allowAll = true (no DB lookup required)
 * - Non-admin => explicit Permission enum rows via UserPermission
 * - No client usage
 * - No raw SQL
 * - Safe for RSC usage
 */

export type LoadedPermissions = {
  userId: string | null;
  role: Role | null;
  isAdmin: boolean;
  allowAll: boolean;
  permissions: Set<Permission>;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getSessionUserId(session: unknown): string | null {
  if (!isRecord(session)) return null;
  const user = session.user;
  if (!isRecord(user)) return null;
  const id = user.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function getSessionUserEmail(session: unknown): string | null {
  if (!isRecord(session)) return null;
  const user = session.user;
  if (!isRecord(user)) return null;
  const email = user.email;
  return typeof email === "string" && email.trim()
    ? email.trim().toLowerCase()
    : null;
}

function getSessionUserRole(session: unknown): Role | null {
  if (!isRecord(session)) return null;
  const user = session.user;
  if (!isRecord(user)) return null;
  const role = user.role;
  return role === Role.ADMIN ||
    role === Role.MANAGER ||
    role === Role.EMPLOYEE
    ? role
    : null;
}

export async function loadUserPermissions(
  session: unknown
): Promise<LoadedPermissions> {
  const role = getSessionUserRole(session);
  const isAdmin = role === Role.ADMIN;

  const sessionUserId = getSessionUserId(session);
  const sessionUserEmail = getSessionUserEmail(session);

  // Admin = allow-all (no DB lookup)
  if (isAdmin) {
    return {
      userId: sessionUserId,
      role,
      isAdmin: true,
      allowAll: true,
      permissions: new Set<Permission>(),
    };
  }

  // Resolve stable userId
  let userId: string | null = sessionUserId;

  if (!userId && sessionUserEmail) {
    const u = await prisma.user.findUnique({
      where: { email: sessionUserEmail },
      select: { id: true, role: true },
    });
    userId = u?.id ?? null;
  }

  if (!userId) {
    return {
      userId: null,
      role,
      isAdmin: false,
      allowAll: false,
      permissions: new Set<Permission>(),
    };
  }

  const rows = await prisma.userPermission.findMany({
    where: { userId },
    select: { permission: true },
  });

  return {
    userId,
    role,
    isAdmin: false,
    allowAll: false,
    permissions: new Set(rows.map((r) => r.permission)),
  };
}

/**
 * Helper: check if user has ANY of given permissions
 */
export function hasAnyPermission(
  perms: LoadedPermissions,
  required: Permission[]
): boolean {
  if (perms.allowAll) return true;

  for (const key of required) {
    if (perms.permissions.has(key)) return true;
  }

  return false;
}

/**
 * Helper: check if user has ALL of given permissions
 */
export function hasAllPermissions(
  perms: LoadedPermissions,
  required: Permission[]
): boolean {
  if (perms.allowAll) return true;

  for (const key of required) {
    if (!perms.permissions.has(key)) return false;
  }

  return true;
}
