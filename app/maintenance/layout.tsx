// app/maintenance/layout.tsx
import type { ReactNode, CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import {
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
      VIEW_PREVENTATIVE_MAINTENANCE,
      VIEW_EQUIPMENT_TRACKING,
      VIEW_COMPANY_VEHICLE_LOG,
      VIEW_MAINTENANCE_REQUESTS,
      VIEW_TEMPERATURE_DASHBOARD,
      VIEW_RECEIPTS,
      CREATE_RECEIPTS,
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
  const canPreventativeMaintenance = perms.allowAll || hasAnyPermission(perms, [VIEW_PREVENTATIVE_MAINTENANCE]);
  const canEquipmentTracking = perms.allowAll || hasAnyPermission(perms, [VIEW_EQUIPMENT_TRACKING]);
  const canVehicleLog = perms.allowAll || hasAnyPermission(perms, [VIEW_COMPANY_VEHICLE_LOG]);
  const canMaintenanceRequests = perms.allowAll || hasAnyPermission(perms, [VIEW_MAINTENANCE_REQUESTS]);
  const canTemperatureDashboard = perms.allowAll || hasAnyPermission(perms, [VIEW_TEMPERATURE_DASHBOARD]);
  const canReceipts = perms.allowAll || hasAnyPermission(perms, [VIEW_RECEIPTS, CREATE_RECEIPTS]);

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
    minWidth: 0,
  };

  const pill = (): CSSProperties => ({
    whiteSpace: "nowrap",
  });

  const summaryStyle: CSSProperties = {
    listStyle: "none",
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    color: "var(--foreground)",
    fontWeight: 900,
    opacity: 0.92,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
  };

  const detailsStyle: CSSProperties = {
    position: "relative",
    display: "inline-block",
  };

  const menuStyle: CSSProperties = {
    position: "absolute",
    top: "calc(100% + 8px)",
    left: 0,
    zIndex: 3000,
    minWidth: 240,
    padding: 8,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--background)",
    color: "var(--foreground)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
  };

  const menuItemStyle: CSSProperties = {
    display: "block",
    padding: "8px 10px",
    borderRadius: 10,
    textDecoration: "none",
    color: "var(--foreground)",
    fontWeight: 800,
    whiteSpace: "nowrap",
  };

  return (
    <div>
      <nav className="site-nav-shell" style={shell}>
        <div className="site-nav-inner" style={inner}>
          <div style={left}>
            <style>{`
              details > summary::-webkit-details-marker { display: none; }
              details[data-maintenance-dropdown][open] { z-index: 4000; }
            `}</style>

            <Link href="/maintenance" className="site-brand" style={pill()}>
              Maintenance
            </Link>

            {canWorkOrders ? (
              <Link href="/maintenance/work-orders" className="site-link" style={pill()}>
                Work Orders
              </Link>
            ) : null}

            {canCheckout ? (
              <Link href="/maintenance/checkout" className="site-link" style={pill()}>
                Checkout
              </Link>
            ) : null}

            {canMaintenanceRequests ? (
              <Link href="/maintenance-requests" className="site-link" style={pill()}>
                Requests
              </Link>
            ) : null}

            {(canOfficeEntry || canTravelLog || canReceipts || canLiveOrders) && (
              <details data-maintenance-dropdown style={detailsStyle}>
                <summary style={summaryStyle}>Operations</summary>
                <div style={menuStyle}>
                  {canOfficeEntry ? (
                    <Link href="/maintenance/work-orders/office-entry" style={menuItemStyle}>
                      Office Entry
                    </Link>
                  ) : null}
                  {canTravelLog ? (
                    <Link href="/maintenance/travel-log" style={menuItemStyle}>
                      Travel Log
                    </Link>
                  ) : null}
                  {canReceipts ? (
                    <Link href="/maintenance/receipts" style={menuItemStyle}>
                      Receipts
                    </Link>
                  ) : null}
                  {canLiveOrders ? (
                    <Link href="/employee/live-orders" style={menuItemStyle}>
                      Live Orders
                    </Link>
                  ) : null}
                </div>
              </details>
            )}

            {(canPreventativeMaintenance || canEquipmentTracking || canVehicleLog || canTemperatureDashboard) && (
              <details data-maintenance-dropdown style={detailsStyle}>
                <summary style={summaryStyle}>PM List</summary>
                <div style={menuStyle}>
                  {canPreventativeMaintenance ? (
                    <Link href="/maintenance/preventative-maintenance" style={menuItemStyle}>
                      Preventative Maintenance
                    </Link>
                  ) : null}
                  {canEquipmentTracking ? (
                    <Link href="/maintenance/equipment-tracking" style={menuItemStyle}>
                      Equipment Tracking
                    </Link>
                  ) : null}
                  {canVehicleLog ? (
                    <Link href="/maintenance/vehicle-log" style={menuItemStyle}>
                      Vehicle Log
                    </Link>
                  ) : null}
                  {canTemperatureDashboard ? (
                    <Link href="/maintenance/temperature-dashboard" style={menuItemStyle}>
                      Temperature Dashboard
                    </Link>
                  ) : null}
                </div>
              </details>
            )}
          </div>

          {/* right-side items (logout button etc.) can stay where you already render them elsewhere */}
        </div>
      </nav>

      {children}
    </div>
  );
}