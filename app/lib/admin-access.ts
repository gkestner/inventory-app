import { Permission, Role } from "@prisma/client";

import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import {
  ADMIN_VIEW_COMPANY_VEHICLES,
  ADMIN_VIEW_EQUIPMENT_TRACKING,
  ADMIN_VIEW_MAINTENANCE_REQUESTS,
  ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
  ADMIN_VIEW_TEMPERATURE_DASHBOARD,
} from "@/app/lib/permission-constants";

export const ADMIN_ENTRY_PERMISSIONS: Permission[] = [
  Permission.ADMIN_VIEW_ITEMS,
  Permission.ADMIN_VIEW_USERS,
  Permission.ADMIN_VIEW_LOCATIONS,
  Permission.ADMIN_VIEW_WORK_ORDERS,
  Permission.ADMIN_VIEW_MAINTENANCE_TICKETS,
  ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
  ADMIN_VIEW_EQUIPMENT_TRACKING,
  ADMIN_VIEW_COMPANY_VEHICLES,
  ADMIN_VIEW_MAINTENANCE_REQUESTS,
  ADMIN_VIEW_TEMPERATURE_DASHBOARD,
];

export async function canAccessAdmin(session: unknown): Promise<boolean> {
  const role = (session as { user?: { role?: unknown } } | null)?.user?.role;
  if (role === Role.ADMIN || role === "ADMIN") return true;
  if (!session) return false;

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return true;
  return hasAnyPermission(perms, ADMIN_ENTRY_PERMISSIONS);
}
