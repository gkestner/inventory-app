// app/lib/permissions.ts
import { prisma } from "@/app/lib/prisma";
import { Permission, Role } from "@prisma/client";

/**
 * Canonical server-side permission loader.
 *
 * Compatibility rules (kept):
 * - Session enum role ADMIN => allowAll = true
 * - Session enum role MAINTENANCE => baseline maintenance permissions
 * - Others => direct permissions + title-based permissions
 *
 * New (dynamic roles) rules:
 * - If dynamic roles tables exist:
 *   - User can have 0..N AppRoles via UserRole
 *   - Permissions come from:
 *       (a) Role direct permissions (AppRolePermission)
 *       (b) Role titles -> permissions (AppRolePermissionTitle -> PermissionTitlePermission)
 *   - If user has a system role named "ADMIN" => allowAll = true
 *
 * Defensive: keeps working even before the new tables are migrated.
 */

export type LoadedPermissions = {
  userId: string | null;
  role: Role | null; // legacy enum role (kept for compatibility)
  isAdmin: boolean; // true if allowAll due to legacy ADMIN or dynamic ADMIN
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

// ===== Dynamic role delegates (optional until migrated) =====
type PrismaUserRoleDelegate = {
  findMany: (args: unknown) => Promise<Array<{ roleId: string }>>;
};

type PrismaAppRoleDelegate = {
  findMany: (
    args: unknown
  ) => Promise<Array<{ id: string; name: string; isSystem: boolean }>>;
};

type PrismaAppRolePermissionDelegate = {
  findMany: (
    args: unknown
  ) => Promise<Array<{ permission: Permission }>>;
};

type PrismaAppRolePermissionTitleDelegate = {
  findMany: (args: unknown) => Promise<Array<{ titleId: string }>>;
};

const db = prisma as unknown as {
  user: PrismaUserDelegate;
  userPermission: PrismaUserPermissionDelegate;

  // existing titles RBAC (optional until migrated)
  userPermissionTitle?: PrismaUserPermissionTitleDelegate;
  permissionTitlePermission?: PrismaPermissionTitlePermissionDelegate;

  // dynamic roles RBAC (optional until migrated)
  userRole?: PrismaUserRoleDelegate;
  appRole?: PrismaAppRoleDelegate;
  appRolePermission?: PrismaAppRolePermissionDelegate;
  appRolePermissionTitle?: PrismaAppRolePermissionTitleDelegate;
};

function titlesReady(): boolean {
  return (
    typeof db.userPermissionTitle?.findMany === "function" &&
    typeof db.permissionTitlePermission?.findMany === "function"
  );
}

function rolesReady(): boolean {
  return (
    typeof db.userRole?.findMany === "function" &&
    typeof db.appRole?.findMany === "function" &&
    typeof db.appRolePermission?.findMany === "function" &&
    typeof db.appRolePermissionTitle?.findMany === "function" &&
    typeof db.permissionTitlePermission?.findMany === "function"
  );
}

function isSystemAdminRoleName(name: string): boolean {
  return name.trim().toUpperCase() === "ADMIN";
}

function uniqStrings(vals: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export async function loadUserPermissions(session: unknown): Promise<LoadedPermissions> {
  const role = getSessionUserRole(session);
  const sessionUserId = getSessionUserId(session);
  const sessionUserEmail = getSessionUserEmail(session);

  const enumIsAdmin = role === Role.ADMIN;

  // ✅ Session enum ADMIN = allow-all (compat)
  if (enumIsAdmin) {
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

  // ✅ MAINTENANCE baseline permissions (compat)
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

  for (const r of directRows) permissions.add(r.permission);

  // Collect user titleIds (for both legacy title permissions and role->title permissions merge)
  let userTitleIds: string[] = [];
  if (titlesReady()) {
    const titleRows = await db.userPermissionTitle!.findMany({
      where: { userId },
      select: { titleId: true },
    } as unknown);
    userTitleIds = titleRows.map((r) => r.titleId);
  }

  // Apply user title permissions (legacy system)
  if (titlesReady() && userTitleIds.length > 0) {
    const titlePerms = await db.permissionTitlePermission!.findMany({
      where: { titleId: { in: uniqStrings(userTitleIds) } },
      select: { permission: true },
    } as unknown);

    for (const r of titlePerms) permissions.add(r.permission);
  }

  // Dynamic roles permissions (new system, optional until migrated)
  let allowAll = false;

  if (rolesReady()) {
    // 1) user -> roles
    const userRoleRows = await db.userRole!.findMany({
      where: { userId },
      select: { roleId: true },
    } as unknown);

    const roleIds = uniqStrings(userRoleRows.map((r) => r.roleId));

    if (roleIds.length > 0) {
      // 2) identify system admin role (allowAll)
      const roleRows = await db.appRole!.findMany({
        where: { id: { in: roleIds } },
        select: { id: true, name: true, isSystem: true },
      } as unknown);

      allowAll = roleRows.some((rr) => rr.isSystem && isSystemAdminRoleName(rr.name));

      if (allowAll) {
        return {
          userId,
          role,
          isAdmin: true, // treat dynamic ADMIN as admin for UI checks
          allowAll: true,
          permissions: new Set<Permission>(),
        };
      }

      // 3) role direct permissions
      const rolePermRows = await db.appRolePermission!.findMany({
        where: { roleId: { in: roleIds } },
        select: { permission: true },
      } as unknown);

      for (const r of rolePermRows) permissions.add(r.permission);

      // 4) role titles -> permissions
      const roleTitleRows = await db.appRolePermissionTitle!.findMany({
        where: { roleId: { in: roleIds } },
        select: { titleId: true },
      } as unknown);

      const roleTitleIds = roleTitleRows.map((r) => r.titleId);
      const mergedTitleIds = uniqStrings([...userTitleIds, ...roleTitleIds]);

      if (mergedTitleIds.length > 0) {
        const roleTitlePermRows = await db.permissionTitlePermission!.findMany({
          where: { titleId: { in: mergedTitleIds } },
          select: { permission: true },
        } as unknown);

        for (const r of roleTitlePermRows) permissions.add(r.permission);
      }
    }
  }

  return {
    userId,
    role,
    isAdmin: false,
    allowAll, // ✅ IMPORTANT: return the computed allowAll (was a bug if always false)
    permissions,
  };
}

/**
 * Check ANY
 */
export function hasAnyPermission(perms: LoadedPermissions, required: Permission[]): boolean {
  if (perms.allowAll) return true;

  for (const key of required) {
    if (perms.permissions.has(key)) return true;
  }

  return false;
}

/**
 * Check ALL
 */
export function hasAllPermissions(perms: LoadedPermissions, required: Permission[]): boolean {
  if (perms.allowAll) return true;

  for (const key of required) {
    if (!perms.permissions.has(key)) return false;
  }

  return true;
}