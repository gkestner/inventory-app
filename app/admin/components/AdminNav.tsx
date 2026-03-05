// app/admin/components/AdminNav.tsx
import Link from "next/link";
import Script from "next/script";
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { Permission, Role } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
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
  const isAdmin = session?.user?.role === Role.ADMIN || dbRole === Role.ADMIN;

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
    display: "inline-block",
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

  const canUserWorkOrders = isAdmin || hasAnyPermission(perms, [
    Permission.VIEW_WORK_ORDERS,
    Permission.CREATE_WORK_ORDERS,
    Permission.UPDATE_OWN_WORK_ORDERS,
    Permission.SUBMIT_OWN_WORK_ORDERS,
  ]);

  const canCheckout = isAdmin || hasAnyPermission(perms, [
    Permission.VIEW_CHECKOUT,
    Permission.CREATE_CHECKOUT,
  ]);
  const canAdminTravelLogs = canAdminWorkOrders || canUserWorkOrders;

  // For now: gate invoices + order history under items perms (no enum changes)
  const canAdminOrderHistory = canAdminItems;
  const canAdminInvoices = canAdminItems;
  const canAdminReports = canAdminItems;
  const canAdminInventoryAlerts = canAdminItems;

  const showAccounting = canAdminInvoices;
  const showInventory = canAdminItems || canAdminOrderHistory || canAdminInventoryAlerts;
  const showAdmin = canAdminUsers || canAdminLocations;
  const showMaintenance =
    canAdminMaintenanceTickets || canAdminWorkOrders || canUserWorkOrders || canCheckout;

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
          <Link href="/admin/items" className="site-brand" style={brand}>
            Inventory Admin
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
                    Maintenance Tickets
                  </Link>
                ) : null}
                {canAdminWorkOrders ? (
                  <Link href="/admin/work-orders" style={menuItemStyle}>
                    Work Orders
                  </Link>
                ) : null}
                {canAdminTravelLogs ? (
                  <Link href="/admin/travel-log" style={menuItemStyle}>
                    Travel Logs
                  </Link>
                ) : (
                  <span style={menuItemDisabled}>Travel Logs</span>
                )}
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