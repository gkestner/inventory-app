// app/admin/components/AdminNav.tsx
import Link from "next/link";
import Script from "next/script";
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { Permission } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

export default async function AdminNav() {
  const session = await getServerSession(authOptions);
  const perms = await loadUserPermissions(session);

  const shell: CSSProperties = {
    borderBottom: "1px solid rgba(128,128,128,0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
  };

  const inner: CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    maxWidth: 1400,
    margin: "0 auto",
  };

  const left: CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  };

  const brand: CSSProperties = {
    fontWeight: 900,
    letterSpacing: 0.2,
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(128,128,128,0.25)",
    textDecoration: "none",
    color: "var(--foreground)",
  };

  const summaryStyle: CSSProperties = {
    listStyle: "none",
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(128,128,128,0.18)",
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
    zIndex: 50,
    minWidth: 210,
    padding: 8,
    borderRadius: 12,
    border: "1px solid rgba(128,128,128,0.25)",
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
    opacity: 0.95,
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
  const canAdminItems = hasAnyPermission(perms, [
    Permission.ADMIN_VIEW_ITEMS,
    Permission.ADMIN_EDIT_ITEMS,
    Permission.ADMIN_IMPORT_EXPORT_ITEMS,
  ]);

  const canAdminUsers = hasAnyPermission(perms, [
    Permission.ADMIN_VIEW_USERS,
    Permission.ADMIN_EDIT_USERS,
  ]);

  const canAdminLocations = hasAnyPermission(perms, [
    Permission.ADMIN_VIEW_LOCATIONS,
    Permission.ADMIN_EDIT_LOCATIONS,
  ]);

  const canAdminWorkOrders = hasAnyPermission(perms, [
    Permission.ADMIN_VIEW_WORK_ORDERS,
    Permission.ADMIN_EDIT_WORK_ORDERS,
    Permission.ADMIN_DELETE_WORK_ORDERS,
  ]);

  const canAdminMaintenanceTickets = hasAnyPermission(perms, [
    Permission.ADMIN_VIEW_MAINTENANCE_TICKETS,
    Permission.ADMIN_EXPORT_MAINTENANCE_TICKETS,
  ]);

  const canUserWorkOrders = hasAnyPermission(perms, [
    Permission.VIEW_WORK_ORDERS,
    Permission.CREATE_WORK_ORDERS,
    Permission.UPDATE_OWN_WORK_ORDERS,
    Permission.SUBMIT_OWN_WORK_ORDERS,
  ]);

  const canCheckout = hasAnyPermission(perms, [
    Permission.VIEW_CHECKOUT,
    Permission.CREATE_CHECKOUT,
  ]);

  // For now: gate invoices + order history under items perms (no enum changes)
  const canAdminOrderHistory = canAdminItems;
  const canAdminInvoices = canAdminItems;

  const showAccounting = canAdminInvoices;
  const showInventory = canAdminItems || canAdminOrderHistory;
  const showAdmin = canAdminUsers || canAdminLocations;
  const showMaintenance =
    canAdminMaintenanceTickets || canAdminWorkOrders || canUserWorkOrders || canCheckout;

  return (
    <div style={shell} data-admin-nav-root>
      <style>{`
        details > summary::-webkit-details-marker { display: none; }
      `}</style>

      <Script id="admin-nav-autoclose" strategy="afterInteractive">{`
(function () {
  function getRoot() { return document.querySelector('[data-admin-nav-root]'); }
  function closeAll(root) {
    var nodes = (root || document).querySelectorAll('details[data-admin-dropdown][open]');
    for (var i = 0; i < nodes.length; i++) nodes[i].removeAttribute('open');
  }
  function closeOthers(root, keep) {
    var nodes = (root || document).querySelectorAll('details[data-admin-dropdown][open]');
    for (var i = 0; i < nodes.length; i++) if (nodes[i] !== keep) nodes[i].removeAttribute('open');
  }
  function bindOnce() {
    var root = getRoot();
    if (!root) return;
    if (root.__adminNavBound) return;
    root.__adminNavBound = true;

    root.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var a = t.closest('a');
      if (!a) return;
      var dd = a.closest('details[data-admin-dropdown]');
      if (!dd) return;
      dd.removeAttribute('open');
      closeAll(root);
    }, true);

    root.addEventListener('toggle', function (e) {
      var t = e.target;
      if (!t || t.tagName !== 'DETAILS') return;
      if (!t.matches('details[data-admin-dropdown]')) return;
      if (t.hasAttribute('open')) closeOthers(root, t);
    }, true);

    document.addEventListener('click', function (e) {
      var root = getRoot();
      if (!root) return;
      var t = e.target;
      if (!t || !t.closest) { closeAll(root); return; }
      if (t.closest('details[data-admin-dropdown]')) return;
      if (t.closest('[data-admin-nav-root]')) { closeAll(root); return; }
      closeAll(root);
    }, true);

    document.addEventListener('keydown', function (e) {
      if (!e || e.key !== 'Escape') return;
      var root = getRoot();
      if (!root) return;
      closeAll(root);
    }, true);
  }

  bindOnce();
  setTimeout(bindOnce, 250);
})();
      `}</Script>

      <div style={inner}>
        <div style={left}>
          <Link href="/admin/items" style={brand}>
            Inventory Admin
          </Link>

          <span style={groupLabel}>Admin</span>

          {showAccounting ? (
            <details data-admin-dropdown style={detailsStyle}>
              <summary style={summaryStyle}>Accounting</summary>
              <div style={menuStyle}>
                {canAdminInvoices ? <Link href="/admin/invoices" style={menuItemStyle}>Invoices</Link> : null}
                {canAdminInvoices ? (
                  <Link href="/admin/invoices/print-batch" style={menuItemStyle}>
                    Invoices Batch Print
                  </Link>
                ) : null}
              </div>
            </details>
          ) : null}

          {showInventory ? (
            <details data-admin-dropdown style={detailsStyle}>
              <summary style={summaryStyle}>Inventory</summary>
              <div style={menuStyle}>
                {canAdminItems ? <Link href="/admin/items" style={menuItemStyle}>Items</Link> : null}
                {canAdminOrderHistory ? (
                  <Link href="/admin/inventory-orders" style={menuItemStyle}>
                    Order History
                  </Link>
                ) : null}
              </div>
            </details>
          ) : null}

          {showAdmin ? (
            <details data-admin-dropdown style={detailsStyle}>
              <summary style={summaryStyle}>Admin</summary>
              <div style={menuStyle}>
                {canAdminUsers ? <Link href="/admin/users" style={menuItemStyle}>Users</Link> : null}
                {canAdminLocations ? <Link href="/admin/locations" style={menuItemStyle}>Locations</Link> : null}
              </div>
            </details>
          ) : null}

          {showMaintenance ? (
            <details data-admin-dropdown style={detailsStyle}>
              <summary style={summaryStyle}>Maintenance</summary>
              <div style={menuStyle}>
                {canAdminMaintenanceTickets ? (
                  <Link href="/admin/maintenance-tickets" style={menuItemStyle}>
                    Maintenance Tickets
                  </Link>
                ) : null}
                {canAdminWorkOrders ? <Link href="/admin/work-orders" style={menuItemStyle}>Work Orders</Link> : null}
                <span style={menuItemDisabled}>Travel Logs (coming soon)</span>
                {canUserWorkOrders ? (
                  <Link href="/maintenance/work-orders" style={menuItemStyle}>
                    Work Orders (User)
                  </Link>
                ) : null}
                {canCheckout ? <Link href="/maintenance/checkout" style={menuItemStyle}>Checkout</Link> : null}
              </div>
            </details>
          ) : null}
        </div>

        {/* Intentionally empty right side: logout lives in the admin sidebar layout */}
        <div />
      </div>
    </div>
  );
}