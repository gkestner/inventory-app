// app/admin/layout.tsx
import type { ReactNode, CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Role, Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { loadUserPermissions, hasAnyPermission, type LoadedPermissions } from "@/app/lib/permissions";
import SignOutButton from "@/app/components/SignOutButton";
import AdminSidebar, { type AdminSidebarCatalogItem } from "@/app/admin/components/AdminSidebar";
import { prisma } from "@/app/lib/prisma";
import { parseAdminSidebarPreferences, type AdminSidebarItemPreference } from "@/app/lib/user-preferences";
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
  ADMIN_EDIT_SUPPLIERS,
  ADMIN_VIEW_SUPPLIERS,
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
      ADMIN_VIEW_SUPPLIERS,
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
      ADMIN_VIEW_REPORT_SLA_BREACHES,
      ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD,
      ADMIN_VIEW_REPORT_TEMPERATURE_INCIDENTS,
      ADMIN_VIEW_REPORT_PM_COMPLIANCE,
      ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS,
      ADMIN_VIEW_REPORT_FLEET_TCO,
      ADMIN_VIEW_REPORT_PERMISSION_COVERAGE,
      ADMIN_VIEW_REPORT_NOTIFICATION_EFFECTIVENESS,
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
  const canSuppliers = allowAll || hasAnyPermission(perms, [ADMIN_VIEW_SUPPLIERS, ADMIN_EDIT_SUPPLIERS]);

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

  const canCheckout =
    allowAll || hasAnyPermission(perms, [Permission.VIEW_CHECKOUT, Permission.CREATE_CHECKOUT]);
  const canQuickCountEditor = allowAll || hasAnyPermission(perms, [Permission.EDIT_QUICK_COUNT, Permission.ADMIN_EDIT_ITEMS]);
  const canRoomDiagrams =
    allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_ROOM_DIAGRAMS,
      Permission.EDIT_QUICK_COUNT,
      ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_EDIT_ITEMS,
    ]);
  const canScannerCount = allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  const canAuditTools = canUsers;

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

  const userId = (session.user as unknown as { id?: string | null } | null)?.id?.trim() || "";
  const email = (session.user as unknown as { email?: string | null } | null)?.email ?? "—";
  const sidebarUser = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { uiPreferences: true } })
    : null;

  const availableSidebarItems: AdminSidebarCatalogItem[] = [];

  if (canItems) {
    availableSidebarItems.push({ key: "items", label: "Items", href: "/admin/items", tag: "Catalog", group: "Inventory" });
    availableSidebarItems.push({ key: "price-lookup", label: "AI Price Lookup", href: "/admin/price-lookup", tag: "GPT", group: "Inventory" });
  }
  if (canAlerts) {
    availableSidebarItems.push({ key: "inventory-alerts", label: "Inventory Alerts", href: "/admin/inventory-alerts", tag: "Alerts", group: "Inventory" });
  }
  if (canOrders) {
    availableSidebarItems.push({ key: "inventory-orders", label: "Inventory Orders", href: "/admin/inventory-orders", tag: "History", group: "Inventory" });
  }
  if (canReports) {
    availableSidebarItems.push({ key: "reports", label: "Reports Hub", href: "/admin/reports", tag: "Reports", group: "Inventory" });
  }
  if (canQuickCountEditor) {
    availableSidebarItems.push({ key: "quick-count", label: "Quick Count Editor", href: "/maintenance/room-diagrams/quick-count", tag: "Count", group: "Inventory" });
  }
  if (canScannerCount) {
    availableSidebarItems.push({ key: "scanner-count", label: "Scanner Count", href: "/maintenance/scanner-count", tag: "Scan", group: "Inventory" });
  }
  if (canLiveOrders) {
    availableSidebarItems.push({ key: "live-orders", label: "Live Orders Board", href: "/admin/live-orders", tag: "Live", group: "Operations" });
  }
  if (canWorkOrders) {
    availableSidebarItems.push({ key: "work-orders", label: "Work Orders", href: "/admin/work-orders", tag: "Ops", group: "Operations" });
    availableSidebarItems.push({ key: "work-order-checklists", label: "Work Order Checklists", href: "/admin/work-orders/checklists", tag: "Setup", group: "Operations" });
    availableSidebarItems.push({ key: "pm-scheduler", label: "PM Scheduler", href: "/admin/work-orders/schedules", tag: "PM", group: "Facilities" });
    availableSidebarItems.push({ key: "travel-log", label: "Travel Logs", href: "/admin/travel-log", tag: "Travel", group: "Operations" });
  }
  if (canMaintenanceRequests) {
    availableSidebarItems.push({ key: "maintenance-requests", label: "Maintenance Requests", href: "/admin/maintenance-requests", tag: "Queue", group: "Operations" });
  }
  if (canTickets) {
    availableSidebarItems.push({ key: "maintenance-tickets", label: "Maintenance Tickets", href: "/admin/maintenance-tickets", tag: "Parts", group: "Operations" });
  }
  if (canCheckout) {
    availableSidebarItems.push({ key: "checkout", label: "Checkout", href: "/maintenance/checkout", tag: "Stock", group: "Operations" });
  }
  if (canRoomDiagrams) {
    availableSidebarItems.push({ key: "room-diagrams", label: "Room Diagrams", href: "/maintenance/room-diagrams", tag: "Layout", group: "Facilities" });
  }
  if (canPreventativeMaintenance) {
    availableSidebarItems.push({ key: "preventative-maintenance", label: "Preventative Maintenance", href: "/admin/preventative-maintenance", tag: "PM", group: "Facilities" });
    availableSidebarItems.push({ key: "pm-compliance", label: "Backflow / Grease Trap / Boiler", href: "/admin/preventative-maintenance/compliance", tag: "Compliance", group: "Facilities" });
  }
  if (canEquipmentTracking) {
    availableSidebarItems.push({ key: "equipment-tracking", label: "Equipment Tracking", href: "/admin/equipment-tracking", tag: "Assets", group: "Facilities" });
  }
  if (canCompanyVehicles) {
    availableSidebarItems.push({ key: "company-vehicles", label: "Company Vehicles", href: "/admin/company-vehicles", tag: "Fleet", group: "Facilities" });
  }
  if (canTemperatureDashboard) {
    availableSidebarItems.push({ key: "temperature-dashboard", label: "Temperature Dashboard", href: "/maintenance/temperature-dashboard", tag: "Mocreo", group: "Facilities" });
  }
  if (canUsers) {
    availableSidebarItems.push({ key: "users", label: "Users", href: "/admin/users", tag: "Security", group: "Administration" });
  }
  if (canSuppliers) {
    availableSidebarItems.push({ key: "suppliers", label: "Suppliers", href: "/admin/suppliers", tag: "Tools", group: "Administration" });
  }
  if (canLocations) {
    availableSidebarItems.push({ key: "locations", label: "Locations", href: "/admin/locations", tag: "Setup", group: "Administration" });
  }
  if (canRoles) {
    availableSidebarItems.push({ key: "access-titles", label: "Permission Titles", href: "/admin/access-titles", tag: "RBAC", group: "Administration" });
  }
  if (canAuditTools) {
    availableSidebarItems.push({ key: "audit", label: "Audit Trail", href: "/admin/audit", tag: "Audit", group: "Administration" });
    availableSidebarItems.push({ key: "permission-diagnostics", label: "Permission Diagnostics", href: "/admin/permission-diagnostics", tag: "Tools", group: "Administration" });
  }
  availableSidebarItems.push({ key: "notifications", label: "Notifications", href: "/notifications", tag: "Inbox", group: "General" });

  const defaultSidebarItems: AdminSidebarItemPreference[] = [
    { type: "preset" as const, key: "items" },
    { type: "preset" as const, key: "inventory-alerts" },
    { type: "preset" as const, key: "inventory-orders" },
    { type: "preset" as const, key: "quick-count" },
    { type: "preset" as const, key: "scanner-count" },
    { type: "preset" as const, key: "reports" },
    { type: "preset" as const, key: "work-orders" },
    { type: "preset" as const, key: "maintenance-requests" },
    { type: "preset" as const, key: "live-orders" },
    { type: "preset" as const, key: "preventative-maintenance" },
    { type: "preset" as const, key: "users" },
    { type: "preset" as const, key: "locations" },
  ].filter((item) => availableSidebarItems.some((availableItem) => availableItem.key === item.key));

  const savedSidebar = parseAdminSidebarPreferences(sidebarUser?.uiPreferences);
  const initialSidebarItems = savedSidebar?.items ?? defaultSidebarItems;

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

      <aside className="admin-layout-sidebar" style={sidebar}>
        <AdminSidebar
          email={email}
          roleLabel={roleLabel}
          availableItems={availableSidebarItems}
          defaultItems={defaultSidebarItems}
          initialItems={initialSidebarItems}
        />
      </aside>

      <section className="admin-layout-main" style={main}>
        {/* ✅ Visible on every admin page */}
        <div className="admin-layout-topbar" style={topBar}>
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

        <div className="admin-layout-content" style={contentWrap}>{children}</div>
      </section>
    </div>
  );
}
