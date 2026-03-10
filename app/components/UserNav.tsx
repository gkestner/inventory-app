// app/components/UserNav.tsx
import Link from "next/link";
import Script from "next/script";
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { Permission } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
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
  const email = String(session?.user?.email ?? "").trim().toLowerCase();
  const me = email
    ? await prisma.user.findUnique({ where: { email }, select: { id: true } })
    : null;
  const unreadCount = me?.id
    ? await prisma.notification.count({ where: { userId: me.id, readAt: null } })
    : 0;
  const unreadBadgeText = unreadCount > 99 ? "99+" : String(unreadCount);

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
  const canTemperatureDashboard =
    perms.allowAll || hasAnyPermission(perms, [VIEW_TEMPERATURE_DASHBOARD, ADMIN_VIEW_TEMPERATURE_DASHBOARD]);
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
    <div className="site-nav-shell" style={shell} data-user-nav-root>
      <div className="site-nav-inner" style={inner}>
        <div style={left}>
          <style>{`
            details > summary::-webkit-details-marker { display: none; }
            details[data-user-dropdown][open] { z-index: 4000; }
          `}</style>

          <Script id="user-nav-dropdown-behavior" strategy="afterInteractive">{`
(function () {
  function getRoot() {
    return document.querySelector('[data-user-nav-root]');
  }

  function getOpen(root) {
    return Array.prototype.slice.call((root || document).querySelectorAll('details[data-user-dropdown][open]'));
  }

  function closeAll(root) {
    var nodes = getOpen(root);
    for (var i = 0; i < nodes.length; i++) nodes[i].removeAttribute('open');
  }

  function bind() {
    var root = getRoot();
    if (!root || root.__userNavBound) return;
    root.__userNavBound = true;

    // Keep only one dropdown open at a time.
    root.addEventListener('toggle', function (e) {
      var t = e.target;
      if (!t || t.tagName !== 'DETAILS') return;
      if (!t.matches('details[data-user-dropdown]')) return;
      if (!t.hasAttribute('open')) return;

      var opened = getOpen(root);
      for (var i = 0; i < opened.length; i++) {
        if (opened[i] !== t) opened[i].removeAttribute('open');
      }
    }, true);

    // Click outside closes dropdowns.
    document.addEventListener('click', function (e) {
      var r = getRoot();
      if (!r) return;
      var t = e.target;
      if (t && t.closest && t.closest('[data-user-nav-root]')) return;
      closeAll(r);
    }, false);

    // Clicking nav links closes dropdowns.
    root.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var link = t.closest('a[href]');
      if (!link) return;
      closeAll(root);
    }, true);

    document.addEventListener('keydown', function (e) {
      if (!e || e.key !== 'Escape') return;
      var r = getRoot();
      if (!r) return;
      closeAll(r);
    }, true);
  }

  bind();
  setTimeout(bind, 250);
})();
          `}</Script>

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

          {canTemperatureDashboard ? (
            <Link href="/maintenance/temperature-dashboard" className="site-link" style={linkStyle}>
              Temperature Dashboard
            </Link>
          ) : null}

          {(canOfficeEntry || canTravelLog || canReceipts || canLiveOrders) && (
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
                {canPreventativeMaintenance ? (
                  <Link href="/maintenance/preventative-maintenance/compliance" style={menuItemStyle}>
                    Backflow / Grease Trap / Boiler
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
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            Notifications
            {unreadCount > 0 ? (
              <span
                style={{
                  minWidth: 20,
                  height: 20,
                  padding: "0 6px",
                  borderRadius: 999,
                  border: "1px solid color-mix(in srgb, var(--brand) 50%, var(--border))",
                  background: "linear-gradient(160deg, var(--brand-2) 0%, var(--brand) 100%)",
                  color: "var(--brand-contrast)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 900,
                  lineHeight: 1,
                }}
                aria-label={`${unreadCount} unread notifications`}
              >
                {unreadBadgeText}
              </span>
            ) : null}
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