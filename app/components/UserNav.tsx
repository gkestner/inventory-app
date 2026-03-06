// app/components/UserNav.tsx
import Link from "next/link";
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { Permission } from "@prisma/client";
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
import SignOutButton from "@/app/components/SignOutButton";

export const dynamic = "force-dynamic";

/**
 * UserNav
 * - ADMIN role => allow-all
 * - Non-admin => permission-gated
 */
export default async function UserNav() {
  const session = await getServerSession(authOptions);
  const perms = await loadUserPermissions(session);

  const shell: CSSProperties = { color: "var(--foreground)" };

  const inner: CSSProperties = {};

  const left: CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
    minWidth: 0,
  };

  const brand: CSSProperties = {};

  const linkStyle: CSSProperties = { whiteSpace: "nowrap" };

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
    minWidth: 220,
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

  const canTravelLog = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_WORK_ORDERS]);

  const canCheckout = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_CHECKOUT, Permission.CREATE_CHECKOUT]);
  const canMaintenanceRequests = perms.allowAll || hasAnyPermission(perms, [VIEW_MAINTENANCE_REQUESTS]);
  const canTemperatureDashboard = perms.allowAll || hasAnyPermission(perms, [VIEW_TEMPERATURE_DASHBOARD]);
  const canReceipts = perms.allowAll || hasAnyPermission(perms, [VIEW_RECEIPTS, CREATE_RECEIPTS]);
  const canPreventativeMaintenance = perms.allowAll || hasAnyPermission(perms, [VIEW_PREVENTATIVE_MAINTENANCE]);
  const canEquipmentTracking = perms.allowAll || hasAnyPermission(perms, [VIEW_EQUIPMENT_TRACKING]);
  const canVehicleLog = perms.allowAll || hasAnyPermission(perms, [VIEW_COMPANY_VEHICLE_LOG]);
  const canLiveOrders = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_LIVE_ORDERS]);

  const homeHref =
    canWorkOrders ||
    canOfficeEntry ||
    canCheckout ||
    canMaintenanceRequests ||
    canTemperatureDashboard ||
    canReceipts ||
    canPreventativeMaintenance ||
    canEquipmentTracking ||
    canVehicleLog ||
    canLiveOrders
      ? "/maintenance"
      : "/";

  return (
    <div className="site-nav-shell" style={shell}>
      <div className="site-nav-inner" style={inner}>
        <div style={left}>
          <style>{`
            details > summary::-webkit-details-marker { display: none; }
            details[data-user-dropdown][open] { z-index: 4000; }
          `}</style>

          <Link href={homeHref} className="site-brand" style={brand}>
            Maintenance
          </Link>

          {canWorkOrders ? (
            <Link href="/maintenance/work-orders" className="site-link" style={linkStyle}>
              Work Orders
            </Link>
          ) : null}

          {canCheckout ? (
            <Link href="/maintenance/checkout" className="site-link" style={linkStyle}>
              Checkout
            </Link>
          ) : null}

          {canMaintenanceRequests ? (
            <Link href="/maintenance-requests" className="site-link" style={linkStyle}>
              Requests
            </Link>
          ) : null}

          {(canOfficeEntry || canTravelLog || canTemperatureDashboard || canReceipts || canLiveOrders) && (
            <details data-user-dropdown style={detailsStyle}>
              <summary style={summaryStyle}>More</summary>
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
                {canTemperatureDashboard ? (
                  <Link href="/maintenance/temperature-dashboard" style={menuItemStyle}>
                    Temperature Dashboard
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

          {(canPreventativeMaintenance || canEquipmentTracking || canVehicleLog) && (
            <details data-user-dropdown style={detailsStyle}>
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
              </div>
            </details>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link
            href="/notifications"
            className="site-link"
            style={{
              padding: "6px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            Notifications
          </Link>

          <Link
            href="/settings"
            className="site-link"
            style={{
              padding: "6px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            Settings
          </Link>

          <SignOutButton
            label="Logout"
            callbackUrl="/login"
            style={{
              padding: "6px 12px",
              borderRadius: 10,
              border: "1px solid color-mix(in srgb, var(--brand) 55%, var(--border))",
              background: "linear-gradient(160deg, var(--brand-2) 0%, var(--brand) 100%)",
              color: "var(--brand-contrast)",
              fontWeight: 800,
              cursor: "pointer",
            }}
          />
        </div>
      </div>
    </div>
  );
}