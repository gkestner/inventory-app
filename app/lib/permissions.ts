// app/lib/permissions.ts
import { prisma } from "@/app/lib/prisma";
import { Permission, Role } from "@prisma/client";

/**
 * Canonical server-side permission loader.
 *
 * Rules:
 * - ADMIN => allowAll = true
 * - MAINTENANCE => baseline maintenance permissions
 * - Others => direct permissions + title-based permissions
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
    role === Role.EMPLOYEE ||
    role === Role.MAINTENANCE
    ? role
    : null;
}

type PrismaUserDelegate = {
  findUnique: (args: unknown) => Promise<{ id: string } | null>;
};

type PrismaUserPermissionDelegate = {
  findMany: (args: unknown) => Promise<Array<{ permission: Permission }>>;
};

type PrismaUserPermissionTitleDelegate = {
  findMany: (args: unknown) => Promise<Array<{ titleId: string }>>;
};

type PrismaPermissionTitlePermissionDelegate = {
  findMany: (args: unknown) => Promise<Array<{ permission: Permission }>>;
};

const db = prisma as unknown as {
  user: PrismaUserDelegate;
  userPermission: PrismaUserPermissionDelegate;

  userPermissionTitle?: PrismaUserPermissionTitleDelegate;
  permissionTitlePermission?: PrismaPermissionTitlePermissionDelegate;
};

function rbacReady(): boolean {
  return (
    typeof db.userPermissionTitle?.findMany === "function" &&
    typeof db.permissionTitlePermission?.findMany === "function"
  );
}

export async function loadUserPermissions(
  session: unknown
): Promise<LoadedPermissions> {
  const role = getSessionUserRole(session);
  const isAdmin = role === Role.ADMIN;

  const sessionUserId = getSessionUserId(session);
  const sessionUserEmail = getSessionUserEmail(session);

  // ✅ ADMIN = allow-all
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
    const u = await db.user.findUnique({
      where: { email: sessionUserEmail },
      select: { id: true },
    });
    userId = u?.id ?? null;
  }

  const permissions = new Set<Permission>();

  // ✅ MAINTENANCE baseline permissions
  if (role === Role.MAINTENANCE) {
    permissions.add(Permission.VIEW_HOME);
    permissions.add(Permission.VIEW_WORK_ORDERS);
    permissions.add(Permission.CREATE_WORK_ORDERS);
    permissions.add(Permission.UPDATE_OWN_WORK_ORDERS);
    permissions.add(Permission.SUBMIT_OWN_WORK_ORDERS);
  }

  if (!userId) {
    return {
      userId: null,
      role,
      isAdmin: false,
      allowAll: false,
      permissions,
    };
  }

  // Direct user permissions
  const directRows = await db.userPermission.findMany({
    where: { userId },
    select: { permission: true },
  });

  for (const r of directRows) {
    permissions.add(r.permission);
  }

  // Title-based permissions (if migrated)
  if (rbacReady()) {
    const titleRows = await db.userPermissionTitle!.findMany({
      where: { userId },
      select: { titleId: true },
    } as unknown);

    const titleIds = titleRows.map((r) => r.titleId);

    if (titleIds.length > 0) {
      const titlePerms = await db.permissionTitlePermission!.findMany({
        where: { titleId: { in: titleIds } },
        select: { permission: true },
      } as unknown);

      for (const r of titlePerms) {
        permissions.add(r.permission);
      }
    }
  }

  return {
    userId,
    role,
    isAdmin: false,
    allowAll: false,
    permissions,
  };
}

/**
 * Check ANY
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
 * Check ALL
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