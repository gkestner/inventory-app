// app/page.tsx
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission, Role } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { ADMIN_ENTRY_PERMISSIONS } from "@/app/lib/admin-access";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import {
  ADMIN_VIEW_TEMPERATURE_DASHBOARD,
  CREATE_RECEIPTS,
  CREATE_WORK_ORDERS_FOR_OTHERS,
  VIEW_COMPANY_VEHICLE_LOG,
  VIEW_EQUIPMENT_TRACKING,
  VIEW_MAINTENANCE_REQUESTS,
  VIEW_PREVENTATIVE_MAINTENANCE,
  VIEW_RECEIPTS,
  VIEW_TEMPERATURE_DASHBOARD,
} from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SessionShape = {
  user?: {
    role?: Role | null;
  } | null;
} | null;

export default async function HomePage() {
  let session: SessionShape = null;

  try {
    session = (await getServerSession(authOptions)) as SessionShape;
  } catch (error) {
    console.error("HomePage session load error:", error);
    redirect("/login");
  }

  // Not logged in -> go login
  if (!session) {
    redirect("/login");
  }

  const role = session.user?.role ?? null;

  let perms: Awaited<ReturnType<typeof loadUserPermissions>>;
  try {
    perms = await loadUserPermissions(session);
  } catch (error) {
    console.error("HomePage permission load error:", error);
    redirect("/login");
  }

  const hasAdminAccess = perms.allowAll || hasAnyPermission(perms, ADMIN_ENTRY_PERMISSIONS);

  const hasMaintenanceAccess =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_HOME,
      Permission.VIEW_WORK_ORDERS,
      Permission.CREATE_WORK_ORDERS,
      CREATE_WORK_ORDERS_FOR_OTHERS,
      Permission.UPDATE_OWN_WORK_ORDERS,
      Permission.SUBMIT_OWN_WORK_ORDERS,
      Permission.VIEW_CHECKOUT,
      Permission.CREATE_CHECKOUT,
      Permission.VIEW_ROOM_DIAGRAMS,
      Permission.EDIT_QUICK_COUNT,
      Permission.VIEW_LIVE_ORDERS,
      VIEW_PREVENTATIVE_MAINTENANCE,
      VIEW_EQUIPMENT_TRACKING,
      VIEW_COMPANY_VEHICLE_LOG,
      VIEW_MAINTENANCE_REQUESTS,
      VIEW_TEMPERATURE_DASHBOARD,
      ADMIN_VIEW_TEMPERATURE_DASHBOARD,
      VIEW_RECEIPTS,
      CREATE_RECEIPTS,
    ]);

  const canWorkOrders =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_WORK_ORDERS,
      Permission.CREATE_WORK_ORDERS,
      CREATE_WORK_ORDERS_FOR_OTHERS,
      Permission.UPDATE_OWN_WORK_ORDERS,
      Permission.SUBMIT_OWN_WORK_ORDERS,
    ]);

  const canOfficeEntry = perms.allowAll || hasAnyPermission(perms, [CREATE_WORK_ORDERS_FOR_OTHERS]);

  const canCheckout = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_CHECKOUT, Permission.CREATE_CHECKOUT]);
  const canRoomDiagrams = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_ROOM_DIAGRAMS, Permission.EDIT_QUICK_COUNT]);

  const canLiveOrders = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_LIVE_ORDERS]);

  // Admin -> admin area
  if (role === Role.ADMIN || hasAdminAccess) {
    redirect("/admin");
  }

  if (hasMaintenanceAccess) {
    if (canWorkOrders) redirect("/maintenance/work-orders");
    if (canOfficeEntry) redirect("/maintenance/work-orders/office-entry");
    if (canCheckout) redirect("/maintenance/checkout");
    if (canRoomDiagrams) redirect("/maintenance/room-diagrams");
    if (canLiveOrders) redirect("/employee/live-orders");
    redirect("/maintenance");
  }

  redirect("/dashboard");
}