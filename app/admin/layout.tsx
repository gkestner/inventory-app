// app/admin/layout.tsx
import type { ReactNode, CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Role, Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { loadUserPermissions, hasAnyPermission, type LoadedPermissions } from "@/app/lib/permissions";
import SignOutButton from "@/app/components/SignOutButton";
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
  EDIT_COMPANY_VEHICLE_INFO,
} from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

async function requireAdmin() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const role = (session.user as unknown as { role?: Role | null } | null)?.role ?? null;
  if (role === Role.ADMIN) return session;

  const perms = await loadUserPermissions(session as unknown as Parameters<typeof loadUserPermissions>[0]);
  const hasAdminAccess =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_VIEW_USERS,
      Permission.ADMIN_VIEW_LOCATIONS,
      Permission.ADMIN_VIEW_WORK_ORDERS,
      Permission.ADMIN_VIEW_MAINTENANCE_TICKETS,
      ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
      ADMIN_VIEW_EQUIPMENT_TRACKING,
      ADMIN_VIEW_COMPANY_VEHICLES,
      CREATE_COMPANY_VEHICLE_INFO,
      EDIT_COMPANY_VEHICLE_INFO,
      ADMIN_VIEW_MAINTENANCE_REQUESTS,
      ADMIN_VIEW_TEMPERATURE_DASHBOARD,
    ]);

  if (!hasAdminAccess) redirect("/");

  return session;
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdmin();

  const sessionArg = session as unknown as Parameters<typeof loadUserPermissions>[0];
  const perms = (await loadUserPermissions(sessionArg)) as LoadedPermissions;

  const allowAll = !!perms.allowAll;
  const roleLabel = allowAll ? "ADMIN" : "PERMISSIONED";

  const canItems =
    allowAll ||
    hasAnyPermission(perms, [
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_EDIT_ITEMS,
      Permission.ADMIN_IMPORT_EXPORT_ITEMS,
    ]);

  const canOrders = allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  const canReports =
    allowAll ||
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
  const canAlerts = canOrders;

  const canUsers = allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_USERS, Permission.ADMIN_EDIT_USERS]);

  // Reuse Users permission for Roles/Permission Titles management
  const canRoles = canUsers;

  const canLocations =
    allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_LOCATIONS, Permission.ADMIN_EDIT_LOCATIONS]);

  const canWorkOrders =
    allowAll ||
    hasAnyPermission(perms, [
      Permission.ADMIN_VIEW_WORK_ORDERS,
      Permission.ADMIN_EDIT_WORK_ORDERS,
      Permission.ADMIN_DELETE_WORK_ORDERS,
    ]);

  const canLiveOrders =
    allowAll ||
    hasAnyPermission(perms, [Permission.VIEW_LIVE_ORDERS, Permission.ADMIN_VIEW_WORK_ORDERS, Permission.ADMIN_EDIT_WORK_ORDERS]);

  const canTickets =
    allowAll ||
    hasAnyPermission(perms, [Permission.ADMIN_EXPORT_MAINTENANCE_TICKETS, Permission.ADMIN_VIEW_MAINTENANCE_TICKETS]);

  const canPreventativeMaintenance =
    allowAll || hasAnyPermission(perms, [ADMIN_VIEW_PREVENTATIVE_MAINTENANCE]);
  const canEquipmentTracking = allowAll || hasAnyPermission(perms, [ADMIN_VIEW_EQUIPMENT_TRACKING]);
  const canCompanyVehicles =
    allowAll || hasAnyPermission(perms, [ADMIN_VIEW_COMPANY_VEHICLES, CREATE_COMPANY_VEHICLE_INFO, EDIT_COMPANY_VEHICLE_INFO]);
  const canMaintenanceRequests = allowAll || hasAnyPermission(perms, [ADMIN_VIEW_MAINTENANCE_REQUESTS]);
  const canTemperatureDashboard = allowAll || hasAnyPermission(perms, [ADMIN_VIEW_TEMPERATURE_DASHBOARD]);

  const wrap: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "260px minmax(0, 1fr)",
    minHeight: "100vh",
    background: "transparent",
    color: "var(--foreground)",
    gap: 12,
    padding: 12,
  };

  const sidebar: CSSProperties = {
    border: "1px solid var(--border)",
    background: "var(--surface)",
    padding: 14,
    borderRadius: 14,
    boxShadow: "var(--shadow)",
    alignSelf: "start",
    position: "sticky",
    top: 12,
  };

  const main: CSSProperties = {
    padding: 0,
    background: "var(--surface)",
    color: "var(--foreground)",
    minWidth: 0,
    border: "1px solid var(--border)",
    borderRadius: 14,
    boxShadow: "var(--shadow)",
    overflow: "hidden",
  };

  const brand: CSSProperties = {
    fontWeight: 900,
    fontSize: 16,
    marginBottom: 10,
  };

  const meta: CSSProperties = {
    fontSize: 12,
    color: "var(--muted)",
    marginBottom: 14,
    lineHeight: 1.3,
  };

  const nav: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  };

  const linkStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "10px 10px",
    textDecoration: "none",
    color: "var(--foreground)",
    background: "var(--surface)",
    fontSize: 13,
  };

  const pill: CSSProperties = {
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid var(--border)",
    background: "var(--surface-2)",
    color: "var(--muted)",
    whiteSpace: "nowrap",
  };

  const sectionTitle: CSSProperties = {
    marginTop: 14,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: 800,
    color: "var(--muted)",
    letterSpacing: 0.2,
  };

  const contentWrap: CSSProperties = {
    padding: 16,
  };

  const topBar: CSSProperties = {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    borderBottom: "1px solid var(--border)",
    background: "color-mix(in srgb, var(--surface-2) 85%, transparent)",
    position: "sticky",
    top: 0,
    zIndex: 10,
  };

  const topLogoutBtn: CSSProperties = {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "linear-gradient(160deg, var(--brand-2) 0%, var(--brand) 100%)",
    color: "var(--brand-contrast)",
    fontWeight: 900,
    cursor: "pointer",
  };

  const email = (session.user as unknown as { email?: string | null } | null)?.email ?? "—";

  return (
    <div className="admin-layout-grid" style={wrap}>
      <style>{`
        @media (max-width: 1080px) {
          .admin-layout-grid {
            grid-template-columns: 1fr !important;
            gap: 10px !important;
            padding: 10px !important;
          }
          .admin-layout-grid aside {
            position: static !important;
          }
        }
      `}</style>

      <aside style={sidebar}>
        <div style={brand}>Admin</div>
        <div style={meta}>
          <div>{email}</div>
          <div style={{ marginTop: 2 }}>Role: {roleLabel}</div>
        </div>

        <div style={sectionTitle}>Operations</div>
        <nav style={nav}>
          {canLiveOrders ? (
            <Link href="/admin/live-orders" style={linkStyle}>
              <span>Live Orders Board</span>
              <span style={pill}>Live</span>
            </Link>
          ) : null}

          {canOrders ? (
            <Link href="/admin/inventory-orders" style={linkStyle}>
              <span>Inventory Orders</span>
              <span style={pill}>History</span>
            </Link>
          ) : null}

          {canOrders ? (
            <Link href="/admin/auto-orders" style={linkStyle}>
              <span>Auto Orders</span>
              <span style={pill}>Approval</span>
            </Link>
          ) : null}

          {canAlerts ? (
            <Link href="/admin/inventory-alerts" style={linkStyle}>
              <span>Inventory Alerts</span>
              <span style={pill}>Alerts</span>
            </Link>
          ) : null}

          {canReports ? (
            <Link href="/admin/reports" style={linkStyle}>
              <span>Reports Hub</span>
              <span style={pill}>Reports</span>
            </Link>
          ) : null}

          {canItems ? (
            <Link href="/admin/items" style={linkStyle}>
              <span>Items</span>
              <span style={pill}>Catalog</span>
            </Link>
          ) : null}

          {canItems ? (
            <Link href="/admin/price-lookup" style={linkStyle}>
              <span>AI Price Lookup</span>
              <span style={pill}>GPT</span>
            </Link>
          ) : null}
        </nav>

        <div style={sectionTitle}>Admin</div>
        <nav style={nav}>
          {canUsers ? (
            <Link href="/admin/users" style={linkStyle}>
              <span>Users</span>
              <span style={pill}>Security</span>
            </Link>
          ) : null}

          {canRoles ? (
            <Link href="/admin/access-titles" style={linkStyle}>
              <span>Permission Titles</span>
              <span style={pill}>RBAC</span>
            </Link>
          ) : null}

          {canLocations ? (
            <Link href="/admin/locations" style={linkStyle}>
              <span>Locations</span>
              <span style={pill}>Setup</span>
            </Link>
          ) : null}

          {canWorkOrders ? (
            <Link href="/admin/work-orders" style={linkStyle}>
              <span>Work Orders</span>
              <span style={pill}>Ops</span>
            </Link>
          ) : null}

          {canPreventativeMaintenance ? (
            <Link href="/admin/preventative-maintenance" style={linkStyle}>
              <span>Preventative Maintenance</span>
              <span style={pill}>PM</span>
            </Link>
          ) : null}

          {canEquipmentTracking ? (
            <Link href="/admin/equipment-tracking" style={linkStyle}>
              <span>Equipment Tracking</span>
              <span style={pill}>Assets</span>
            </Link>
          ) : null}

          {canCompanyVehicles ? (
            <Link href="/admin/company-vehicles" style={linkStyle}>
              <span>Company Vehicles</span>
              <span style={pill}>Fleet</span>
            </Link>
          ) : null}

          {canMaintenanceRequests ? (
            <Link href="/admin/maintenance-requests" style={linkStyle}>
              <span>Maintenance Requests (Queue)</span>
              <span style={pill}>Queue</span>
            </Link>
          ) : null}

          {canTemperatureDashboard ? (
            <Link href="/maintenance/temperature-dashboard" style={linkStyle}>
              <span>Temperature Dashboard</span>
              <span style={pill}>Mocreo</span>
            </Link>
          ) : null}

          {canTickets ? (
            <Link href="/admin/maintenance-tickets" style={linkStyle}>
              <span>Maintenance Tickets (Parts)</span>
              <span style={pill}>Invoicing</span>
            </Link>
          ) : null}
        </nav>

        <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
          <Link href="/settings" style={{ ...linkStyle, justifyContent: "center" }}>
            Account Settings
          </Link>

          <Link href="/" style={{ ...linkStyle, justifyContent: "center", background: "var(--surface-2)" }}>
            ← Back to App
          </Link>

          <SignOutButton
            label="Logout"
            callbackUrl="/login"
            style={{ ...linkStyle, justifyContent: "center", cursor: "pointer" }}
          />
        </div>
      </aside>

      <section style={main}>
        {/* ✅ Visible on every admin page */}
        <div style={topBar}>
          <Link
            href="/settings"
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--foreground)",
              fontWeight: 800,
              textDecoration: "none",
            }}
          >
            Settings
          </Link>
          <SignOutButton label="Logout" callbackUrl="/login" style={topLogoutBtn} />
        </div>

        <div style={contentWrap}>{children}</div>
      </section>
    </div>
  );
}