// app/page.tsx
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission, Role } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SessionShape = {
  user?: {
    role?: Role | null;
  } | null;
} | null;

export default async function HomePage() {
  const session = (await getServerSession(authOptions)) as SessionShape;

  // Not logged in -> go login
  if (!session) {
    redirect("/login");
  }

  const role = session.user?.role ?? null;
  const perms = await loadUserPermissions(session);

  const hasAdminAccess =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_VIEW_USERS,
      Permission.ADMIN_VIEW_LOCATIONS,
      Permission.ADMIN_VIEW_WORK_ORDERS,
      Permission.ADMIN_VIEW_MAINTENANCE_TICKETS,
    ]);

  const hasMaintenanceAccess =
    role === Role.EMPLOYEE ||
    role === Role.MAINTENANCE ||
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_WORK_ORDERS,
      Permission.CREATE_WORK_ORDERS,
      Permission.UPDATE_OWN_WORK_ORDERS,
      Permission.SUBMIT_OWN_WORK_ORDERS,
      Permission.VIEW_CHECKOUT,
      Permission.CREATE_CHECKOUT,
      Permission.VIEW_LIVE_ORDERS,
    ]);

  const canWorkOrders =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_WORK_ORDERS,
      Permission.CREATE_WORK_ORDERS,
      Permission.UPDATE_OWN_WORK_ORDERS,
      Permission.SUBMIT_OWN_WORK_ORDERS,
    ]);

  const canCheckout = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_CHECKOUT, Permission.CREATE_CHECKOUT]);

  const canLiveOrders = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_LIVE_ORDERS]);

  // Admin -> admin area
  if (role === Role.ADMIN || hasAdminAccess) {
    redirect("/admin");
  }

  if (hasMaintenanceAccess) {
    if (canWorkOrders) redirect("/maintenance/work-orders");
    if (canCheckout) redirect("/maintenance/checkout");
    if (canLiveOrders) redirect("/employee/live-orders");
    redirect("/maintenance");
  }

  redirect("/login");
}