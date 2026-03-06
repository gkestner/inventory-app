// app/maintenance/layout.tsx
import type { ReactNode, CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { CREATE_WORK_ORDERS_FOR_OTHERS } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SessionUser = {
  email?: string | null;
  name?: string | null;
};

export default async function MaintenanceLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const user = session.user as SessionUser;

  const email = (user.email ?? "").trim().toLowerCase();
  if (!email) redirect("/login");

  const perms = await loadUserPermissions(session);

  const hasMaintenanceAreaAccess =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_CHECKOUT,
      Permission.CREATE_CHECKOUT,
      Permission.VIEW_WORK_ORDERS,
      Permission.CREATE_WORK_ORDERS,
      CREATE_WORK_ORDERS_FOR_OTHERS,
      Permission.UPDATE_OWN_WORK_ORDERS,
      Permission.SUBMIT_OWN_WORK_ORDERS,
      Permission.VIEW_LIVE_ORDERS,
    ]);

  if (!hasMaintenanceAreaAccess) redirect("/");

  // ✅ Checkout is permission-based ONLY (no role special-casing)
  const canCheckout = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_CHECKOUT, Permission.CREATE_CHECKOUT]);

  // ✅ Work Orders are permission-based ONLY
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

  // ✅ Travel Log is treated as part of Work Orders permissions (no VIEW_TRAVEL_LOG exists)
  const canTravelLog = canWorkOrders;

  // ✅ NEW: Live Orders board
  const canLiveOrders = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_LIVE_ORDERS]);
  const canPreventativeMaintenance = hasMaintenanceAreaAccess;
  const canEquipmentTracking = hasMaintenanceAreaAccess;
  const canVehicleLog = hasMaintenanceAreaAccess;
  const canMaintenanceRequests = hasMaintenanceAreaAccess;
  const canTemperatureDashboard = hasMaintenanceAreaAccess;

  const shell: CSSProperties = {
    color: "var(--foreground)",
  };

  const inner: CSSProperties = {
    maxWidth: 1100,
  };

  const left: CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  };

  const pill = (): CSSProperties => ({
    whiteSpace: "nowrap",
  });

  return (
    <div>
      <nav className="site-nav-shell" style={shell}>
        <div className="site-nav-inner" style={inner}>
          <div style={left}>
            <Link href="/maintenance" className="site-brand" style={pill()}>
              Maintenance
            </Link>

            {/* ✅ Only show Work Orders + Travel Log if permitted */}
            {canWorkOrders || canOfficeEntry ? (
              <>
                {canWorkOrders ? (
                  <Link href="/maintenance/work-orders" className="site-link" style={pill()}>
                    Work Orders
                  </Link>
                ) : null}

                {canOfficeEntry ? (
                  <Link href="/maintenance/work-orders/office-entry" className="site-link" style={pill()}>
                    Office Entry
                  </Link>
                ) : null}

                {canTravelLog ? (
                  <Link href="/maintenance/travel-log" className="site-link" style={pill()}>
                    Travel Log
                  </Link>
                ) : null}
              </>
            ) : null}

            {/* ✅ Only show Checkout if permitted */}
            {canCheckout ? (
              <Link href="/maintenance/checkout" className="site-link" style={pill()}>
                Checkout
              </Link>
            ) : null}

            {canPreventativeMaintenance ? (
              <Link href="/maintenance/preventative-maintenance" className="site-link" style={pill()}>
                Preventative Maintenance
              </Link>
            ) : null}

            {canEquipmentTracking ? (
              <Link href="/maintenance/equipment-tracking" className="site-link" style={pill()}>
                Equipment Tracking
              </Link>
            ) : null}

            {canVehicleLog ? (
              <Link href="/maintenance/vehicle-log" className="site-link" style={pill()}>
                Vehicle Log
              </Link>
            ) : null}

            {canMaintenanceRequests ? (
              <Link href="/maintenance-requests" className="site-link" style={pill()}>
                Requests
              </Link>
            ) : null}

            {canTemperatureDashboard ? (
              <Link href="/maintenance/temperature-dashboard" className="site-link" style={pill()}>
                Temperature Dashboard
              </Link>
            ) : null}

            {/* ✅ NEW: Live Orders board (permission-based) */}
            {canLiveOrders ? (
              <Link href="/employee/live-orders" className="site-link" style={pill()}>
                Live Orders
              </Link>
            ) : null}
          </div>

          {/* right-side items (logout button etc.) can stay where you already render them elsewhere */}
        </div>
      </nav>

      {children}
    </div>
  );
}