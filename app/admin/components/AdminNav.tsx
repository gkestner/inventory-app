// app/admin/components/AdminNav.tsx
import Link from "next/link";
import Script from "next/script";
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { Permission, Role } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import {
  ADMIN_VIEW_COMPANY_VEHICLES,
  ADMIN_VIEW_EQUIPMENT_TRACKING,
  ADMIN_VIEW_MAINTENANCE_REQUESTS,
  ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
  ADMIN_VIEW_REPORT_FLEET_TCO,
  ADMIN_VIEW_REPORT_NOTIFICATION_EFFECTIVENESS,
  ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS,
  ADMIN_VIEW_REPORT_PERMISSION_COVERAGE,
  ADMIN_VIEW_REPORT_PM_COMPLIANCE,
  ADMIN_VIEW_REPORT_SLA_BREACHES,
  ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD,
  ADMIN_VIEW_REPORT_TEMPERATURE_INCIDENTS,
  ADMIN_VIEW_TEMPERATURE_DASHBOARD,
  CREATE_COMPANY_VEHICLE_INFO,
  CREATE_WORK_ORDERS_FOR_OTHERS,
  EDIT_COMPANY_VEHICLE_INFO,
} from "@/app/lib/permission-constants";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminNav() {
  const session = await getServerSession(authOptions);
  const perms = await loadUserPermissions(session);
  const email = String(session?.user?.email ?? "").trim().toLowerCase();
  const dbRole = email
    ? (
        await prisma.user.findUnique({
          where: { email },
          select: { role: true },
        })
      )?.role ?? null
    : null;
  const isAdminByRole = session?.user?.role === Role.ADMIN || dbRole === Role.ADMIN;
  const me = email
    ? await prisma.user.findUnique({ where: { email }, select: { id: true } })
    : null;
  const unreadCount = me?.id
    ? await prisma.notification.count({ where: { userId: me.id, readAt: null } })
    : 0;
  const unreadBadgeText = unreadCount > 99 ? "99+" : String(unreadCount);
  const isAdmin = isAdminByRole || perms.allowAll;

  const shell: CSSProperties = {
    color: "var(--foreground)",
    position: "relative",
    zIndex: 120,
    overflow: "visible",
  };

  const inner: CSSProperties = {};

  const left: CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  };

  const brand: CSSProperties = {};

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

  const topLinkStyle: CSSProperties = {
    ...summaryStyle,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    textDecoration: "none",
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
    minWidth: 210,
    padding: 8,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--background)",
    color: "var(--foreground)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
    pointerEvents: "auto",
  };

  const menuItemStyle: CSSProperties = {
    display: "block",
    padding: "8px 10px",
    borderRadius: 10,
    textDecoration: "none",
    color: "var(--foreground)",
    fontWeight: 800,
    opacity: 1,
    whiteSpace: "nowrap",
  };

  const menuItemDisabled: CSSProperties = {
    display: "block",
    padding: "8px 10px",
    borderRadius: 10,
    color: "var(--foreground)",
    fontWeight: 800,
    opacity: 0.5,
    whiteSpace: "nowrap",
    cursor: "not-allowed",
  };

  const groupLabel: CSSProperties = {
    fontSize: 12,
    opacity: 0.7,
    fontWeight: 900,
    marginLeft: 6,
    marginRight: -2,
    whiteSpace: "nowrap",
  };

  // permissions
  const canAdminItems = isAdmin || hasAnyPermission(perms, [
    Permission.ADMIN_VIEW_ITEMS,
    Permission.ADMIN_EDIT_ITEMS,
    Permission.ADMIN_IMPORT_EXPORT_ITEMS,
  ]);

  const canAdminUsers = isAdmin || hasAnyPermission(perms, [
    Permission.ADMIN_VIEW_USERS,
    Permission.ADMIN_EDIT_USERS,
  ]);

  const canAdminLocations = isAdmin || hasAnyPermission(perms, [
    Permission.ADMIN_VIEW_LOCATIONS,
    Permission.ADMIN_EDIT_LOCATIONS,
  ]);

  const canAdminWorkOrders = isAdmin || hasAnyPermission(perms, [
    Permission.ADMIN_VIEW_WORK_ORDERS,
    Permission.ADMIN_EDIT_WORK_ORDERS,
    Permission.ADMIN_DELETE_WORK_ORDERS,
  ]);

  const canAdminMaintenanceTickets = isAdmin || hasAnyPermission(perms, [
    Permission.ADMIN_VIEW_MAINTENANCE_TICKETS,
    Permission.ADMIN_EXPORT_MAINTENANCE_TICKETS,
  ]);

  const canPreventativeMaintenance = isAdmin || hasAnyPermission(perms, [ADMIN_VIEW_PREVENTATIVE_MAINTENANCE]);
  const canEquipmentTracking = isAdmin || hasAnyPermission(perms, [ADMIN_VIEW_EQUIPMENT_TRACKING]);
  const canCompanyVehicles =
    isAdmin || hasAnyPermission(perms, [ADMIN_VIEW_COMPANY_VEHICLES, CREATE_COMPANY_VEHICLE_INFO, EDIT_COMPANY_VEHICLE_INFO]);
  const canMaintenanceRequests = isAdmin || hasAnyPermission(perms, [ADMIN_VIEW_MAINTENANCE_REQUESTS]);
  const canTemperatureDashboard = isAdmin || hasAnyPermission(perms, [ADMIN_VIEW_TEMPERATURE_DASHBOARD]);

  const canUserWorkOrders = isAdmin || hasAnyPermission(perms, [
    Permission.VIEW_WORK_ORDERS,
    Permission.CREATE_WORK_ORDERS,
    CREATE_WORK_ORDERS_FOR_OTHERS,
    Permission.UPDATE_OWN_WORK_ORDERS,
    Permission.SUBMIT_OWN_WORK_ORDERS,
  ]);

  const canCheckout = isAdmin || hasAnyPermission(perms, [
    Permission.VIEW_CHECKOUT,
    Permission.CREATE_CHECKOUT,
  ]);
  const canRoomDiagrams =
    isAdmin ||
    hasAnyPermission(perms, [
      Permission.VIEW_ROOM_DIAGRAMS,
      Permission.EDIT_QUICK_COUNT,
      ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_EDIT_ITEMS,
    ]);
  const canQuickCountEditor =
    isAdmin || hasAnyPermission(perms, [Permission.EDIT_QUICK_COUNT, Permission.ADMIN_EDIT_ITEMS]);
  const canAdminTravelLogs = canAdminWorkOrders || canUserWorkOrders;

  // For now: gate invoices + order history under items perms (no enum changes)
  const canAdminOrderHistory = canAdminItems;
  const canAdminInvoices = canAdminItems;
  const canAdminReports =
    isAdmin ||
    hasAnyPermission(perms, [
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_EDIT_ITEMS,
      ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
      ADMIN_VIEW_MAINTENANCE_REQUESTS,
      ADMIN_VIEW_REPORT_SLA_BREACHES,
      ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD,
      ADMIN_VIEW_REPORT_TEMPERATURE_INCIDENTS,
      ADMIN_VIEW_REPORT_PM_COMPLIANCE,
      ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS,
      ADMIN_VIEW_REPORT_FLEET_TCO,
      ADMIN_VIEW_REPORT_PERMISSION_COVERAGE,
      ADMIN_VIEW_REPORT_NOTIFICATION_EFFECTIVENESS,
    ]);
  const canAdminInventoryAlerts = canAdminItems;

  const brandHref = canAdminItems
    ? "/admin/items"
    : canAdminReports
      ? "/admin/reports"
      : canMaintenanceRequests
        ? "/admin/maintenance-requests"
        : "/admin";
  const brandLabel = canAdminItems ? "Inventory Admin" : "Admin";

  const showAccounting = canAdminInvoices;
  const showInventory = canAdminItems || canAdminOrderHistory || canAdminInventoryAlerts;
  const showAdmin = canAdminUsers || canAdminLocations;
  const showMaintenance =
    canAdminMaintenanceTickets ||
    canAdminWorkOrders ||
    canUserWorkOrders ||
    canCheckout ||
    canPreventativeMaintenance ||
    canEquipmentTracking ||
    canCompanyVehicles ||
    canMaintenanceRequests ||
    canTemperatureDashboard;

  return (
    <div className="site-nav-shell" style={shell} data-admin-nav-root>
      {/* Ensure disclosure marker is hidden consistently */}
      <style>{`
        details > summary::-webkit-details-marker { display: none; }
        details[data-admin-dropdown][open] { z-index: 4000; }
      `}</style>

      <Script id="admin-nav-dropdown-behavior" strategy="afterInteractive">{`
(function () {
  function getRoot() {
    return document.querySelector('[data-admin-nav-root]');
  }

  function getOpen(root) {
    return Array.prototype.slice.call((root || document).querySelectorAll('details[data-admin-dropdown][open]'));
  }

  function closeAll(root) {
    var nodes = getOpen(root);
    for (var i = 0; i < nodes.length; i++) nodes[i].removeAttribute('open');
  }

  function bind() {
    var root = getRoot();
    if (!root || root.__adminNavBound) return;
    root.__adminNavBound = true;

    // Keep only one dropdown open at a time.
    root.addEventListener('toggle', function (e) {
      var t = e.target;
      if (!t || t.tagName !== 'DETAILS') return;
      if (!t.matches('details[data-admin-dropdown]')) return;
      if (!t.hasAttribute('open')) return;

      var opened = getOpen(root);
      for (var i = 0; i < opened.length; i++) {
        if (opened[i] !== t) opened[i].removeAttribute('open');
      }
    }, true);

    // Click outside closes any open dropdown.
    document.addEventListener('click', function (e) {
      var r = getRoot();
      if (!r) return;
      var t = e.target;
      if (t && t.closest && t.closest('[data-admin-nav-root]')) return;
      closeAll(r);
    }, false);

    // Clicking any nav link should collapse dropdowns before route transition.
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

      <div className="site-nav-inner" style={inner}>
        <div style={left}>
          <Link href={brandHref} className="site-brand" style={brand}>
            {brandLabel}
          </Link>

          <span style={groupLabel}>Admin</span>

          {/* Accounting */}
          {showAccounting ? (
            <details data-admin-dropdown style={detailsStyle}>
              <summary style={summaryStyle}>Accounting</summary>
              <div style={menuStyle}>
                {canAdminInvoices ? (
                  <Link href="/admin/invoices" style={menuItemStyle}>
                    Invoices
                  </Link>
                ) : null}
                {canAdminInvoices ? (
                  <Link href="/admin/invoices/print-batch" style={menuItemStyle}>
                    Invoices Batch Print
                  </Link>
                ) : null}
              </div>
            </details>
          ) : null}

          {/* Inventory */}
          {showInventory ? (
            <details data-admin-dropdown style={detailsStyle}>
              <summary style={summaryStyle}>Inventory</summary>
              <div style={menuStyle}>
                {canAdminItems ? (
                  <Link href="/admin/items" style={menuItemStyle}>
                    Items
                  </Link>
                ) : null}
                {canAdminItems ? (
                  <Link href="/admin/price-lookup" style={menuItemStyle}>
                    AI Price Lookup
                  </Link>
                ) : null}
                {canAdminOrderHistory ? (
                  <Link href="/admin/inventory-orders" style={menuItemStyle}>
                    Order History
                  </Link>
                ) : null}
                {canAdminInventoryAlerts ? (
                  <Link href="/admin/inventory-alerts" style={menuItemStyle}>
                    Alerts
                  </Link>
                ) : null}
              </div>
            </details>
          ) : null}

          {/* Reports */}
          {canAdminReports ? (
            <Link href="/admin/reports" style={topLinkStyle}>
              Reports
            </Link>
          ) : null}

          <Link href="/notifications" style={topLinkStyle}>
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

          {/* Admin */}
          {showAdmin ? (
            <details data-admin-dropdown style={detailsStyle}>
              <summary style={summaryStyle}>Admin</summary>
              <div style={menuStyle}>
                {canAdminUsers ? (
                  <Link href="/admin/users" style={menuItemStyle}>
                    Users
                  </Link>
                ) : null}
                {canAdminLocations ? (
                  <Link href="/admin/locations" style={menuItemStyle}>
                    Locations
                  </Link>
                ) : null}
              </div>
            </details>
          ) : null}

          {/* Maintenance */}
          {showMaintenance ? (
            <details data-admin-dropdown style={detailsStyle}>
              <summary style={summaryStyle}>Maintenance</summary>
              <div style={menuStyle}>
                {canAdminMaintenanceTickets ? (
                  <Link href="/admin/maintenance-tickets" style={menuItemStyle}>
                    Maintenance Tickets (Parts)
                  </Link>
                ) : null}
                {canMaintenanceRequests ? (
                  <Link href="/admin/maintenance-requests" style={menuItemStyle}>
                    Maintenance Requests (Queue)
                  </Link>
                ) : null}
                {canPreventativeMaintenance ? (
                  <Link href="/admin/preventative-maintenance" style={menuItemStyle}>
                    Preventative Maintenance
                  </Link>
                ) : null}
                {canPreventativeMaintenance ? (
                  <Link href="/admin/preventative-maintenance/compliance" style={menuItemStyle}>
                    Backflow / Grease Trap / Boiler
                  </Link>
                ) : null}
                {canEquipmentTracking ? (
                  <Link href="/admin/equipment-tracking" style={menuItemStyle}>
                    Equipment Tracking
                  </Link>
                ) : null}
                {canCompanyVehicles ? (
                  <Link href="/admin/company-vehicles" style={menuItemStyle}>
                    Company Vehicles
                  </Link>
                ) : null}
                {canTemperatureDashboard ? (
                  <Link href="/maintenance/temperature-dashboard" style={menuItemStyle}>
                    Temperature Dashboard
                  </Link>
                ) : null}
                {canRoomDiagrams ? (
                  <Link href="/maintenance/room-diagrams" style={menuItemStyle}>
                    Room Diagrams
                  </Link>
                ) : null}
                {canQuickCountEditor ? (
                  <Link href="/maintenance/room-diagrams/quick-count" style={menuItemStyle}>
                    Quick Count Editor
                  </Link>
                ) : null}
                {canAdminWorkOrders ? (
                  <Link href="/admin/work-orders" style={menuItemStyle}>
                    Work Orders
                  </Link>
                ) : null}
                {canAdminWorkOrders ? (
                  <Link href="/admin/work-orders/schedules" style={menuItemStyle}>
                    PM Scheduler
                  </Link>
                ) : null}
                {canAdminTravelLogs ? (
                  <Link href="/admin/travel-log" style={menuItemStyle}>
                    Travel Logs
                  </Link>
                ) : (
                  <span style={menuItemDisabled}>Travel Logs</span>
                )}
                {canAdminWorkOrders ? (
                  <Link href="/admin/cycle-counts" style={menuItemStyle}>
                    Cycle Counts
                  </Link>
                ) : null}
                {canAdminUsers ? (
                  <Link href="/admin/permission-diagnostics" style={menuItemStyle}>
                    Permission Diagnostics
                  </Link>
                ) : null}
                {canAdminUsers ? (
                  <Link href="/admin/audit" style={menuItemStyle}>
                    Audit Trail
                  </Link>
                ) : null}
                {canUserWorkOrders ? (
                  <Link href="/maintenance/work-orders" style={menuItemStyle}>
                    Work Orders (User)
                  </Link>
                ) : null}
                {canCheckout ? (
                  <Link href="/maintenance/checkout" style={menuItemStyle}>
                    Checkout
                  </Link>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>

        {/* ✅ Removed top-right logout here on purpose */}
        <div />
      </div>
    </div>
  );
}