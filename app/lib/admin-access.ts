import { Permission, Role } from "@prisma/client";

import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const ADMIN_ENTRY_PERMISSIONS: Permission[] = [
  Permission.ADMIN_VIEW_ITEMS,
  Permission.ADMIN_VIEW_USERS,
  Permission.ADMIN_VIEW_LOCATIONS,
  Permission.ADMIN_VIEW_WORK_ORDERS,
  Permission.ADMIN_VIEW_MAINTENANCE_TICKETS,
];

export async function canAccessAdmin(session: unknown): Promise<boolean> {
  const role = (session as { user?: { role?: unknown } } | null)?.user?.role;
  if (role === Role.ADMIN || role === "ADMIN") return true;
  if (!session) return false;

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return true;
  return hasAnyPermission(perms, ADMIN_ENTRY_PERMISSIONS);
}
