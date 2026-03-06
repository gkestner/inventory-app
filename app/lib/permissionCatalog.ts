// app/lib/permissionCatalog.ts
import { Permission } from "@prisma/client";
import {
  ADMIN_VIEW_REPORT_FLEET_TCO,
  ADMIN_VIEW_REPORT_NOTIFICATION_EFFECTIVENESS,
  ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS,
  ADMIN_VIEW_REPORT_PERMISSION_COVERAGE,
  ADMIN_VIEW_REPORT_PM_COMPLIANCE,
  ADMIN_VIEW_REPORT_SLA_BREACHES,
  ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD,
  ADMIN_VIEW_REPORT_TEMPERATURE_INCIDENTS,
  ADMIN_VIEW_COMPANY_VEHICLES,
  ADMIN_VIEW_EQUIPMENT_TRACKING,
  ADMIN_VIEW_MAINTENANCE_REQUESTS,
  ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
  ADMIN_VIEW_TEMPERATURE_DASHBOARD,
  CREATE_COMPANY_VEHICLE_INFO,
  CREATE_RECEIPTS,
  CREATE_WORK_ORDERS_FOR_OTHERS,
  EDIT_COMPANY_VEHICLE_INFO,
  RECEIVE_NOTIFICATION_CYCLE_COUNTS,
  RECEIVE_NOTIFICATION_MAINTENANCE_REQUESTS,
  RECEIVE_NOTIFICATION_TEMPERATURE_ALERTS,
  RECEIVE_NOTIFICATION_WORK_ORDER_SCHEDULES,
  VIEW_COMPANY_VEHICLE_LOG,
  VIEW_EQUIPMENT_TRACKING,
  VIEW_MAINTENANCE_REQUESTS,
  VIEW_PREVENTATIVE_MAINTENANCE,
  VIEW_RECEIPTS,
  VIEW_TEMPERATURE_DASHBOARD,
} from "@/app/lib/permission-constants";

export type PermissionCatalogEntry = {
  permission: Permission;
  module: string; // left nav category
  path: string[]; // tree grouping inside that module
  label: string; // checkbox label
  description?: string;
};

export const PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  // ===== Navigation =====
  { permission: Permission.VIEW_HOME, module: "Navigation", path: ["General"], label: "View Home" },

  // ===== Inventory / Checkout =====
  { permission: Permission.VIEW_CHECKOUT, module: "Inventory", path: ["Checkout"], label: "View Checkout" },
  { permission: Permission.CREATE_CHECKOUT, module: "Inventory", path: ["Checkout"], label: "Create Checkout" },

  // ===== Maintenance / Work Orders (non-admin) =====
  { permission: Permission.VIEW_WORK_ORDERS, module: "Maintenance", path: ["Work Orders"], label: "View Work Orders" },
  { permission: Permission.CREATE_WORK_ORDERS, module: "Maintenance", path: ["Work Orders"], label: "Create Work Orders" },
  {
    permission: CREATE_WORK_ORDERS_FOR_OTHERS,
    module: "Maintenance",
    path: ["Work Orders"],
    label: "Create Work Orders For Others (Office Entry)",
  },
  { permission: Permission.UPDATE_OWN_WORK_ORDERS, module: "Maintenance", path: ["Work Orders"], label: "Update Own Work Orders" },
  { permission: Permission.SUBMIT_OWN_WORK_ORDERS, module: "Maintenance", path: ["Work Orders"], label: "Submit Own Work Orders" },
  {
    permission: VIEW_PREVENTATIVE_MAINTENANCE,
    module: "Maintenance",
    path: ["Preventative Maintenance"],
    label: "View Preventative Maintenance",
  },
  {
    permission: VIEW_EQUIPMENT_TRACKING,
    module: "Maintenance",
    path: ["Equipment Tracking"],
    label: "View Equipment Tracking",
  },
  {
    permission: VIEW_COMPANY_VEHICLE_LOG,
    module: "Maintenance",
    path: ["Company Vehicles"],
    label: "View Vehicle Log",
  },
  {
    permission: VIEW_MAINTENANCE_REQUESTS,
    module: "Maintenance",
    path: ["Maintenance Requests"],
    label: "View Maintenance Requests",
  },
  {
    permission: VIEW_TEMPERATURE_DASHBOARD,
    module: "Maintenance",
    path: ["Temperature Dashboard"],
    label: "View Temperature Dashboard",
  },
  {
    permission: VIEW_RECEIPTS,
    module: "Maintenance",
    path: ["Receipts"],
    label: "View Receipts",
  },
  {
    permission: CREATE_RECEIPTS,
    module: "Maintenance",
    path: ["Receipts"],
    label: "Create Receipts",
  },

  // ===== Admin / Items =====
  {
    permission: Permission.ADMIN_VIEW_ITEMS,
    module: "Admin",
    path: ["Items"],
    label: "View Items (also enables Reports Hub + Inventory Alerts)",
  },
  {
    permission: Permission.ADMIN_EDIT_ITEMS,
    module: "Admin",
    path: ["Items"],
    label: "Edit Items (also enables resolving Inventory Alerts)",
  },
  { permission: Permission.ADMIN_IMPORT_EXPORT_ITEMS, module: "Admin", path: ["Items"], label: "Import / Export Items" },

  // ===== Admin / Users =====
  { permission: Permission.ADMIN_VIEW_USERS, module: "Admin", path: ["Users"], label: "View Users" },
  { permission: Permission.ADMIN_EDIT_USERS, module: "Admin", path: ["Users"], label: "Edit Users" },

  // ===== Admin / Locations =====
  { permission: Permission.ADMIN_VIEW_LOCATIONS, module: "Admin", path: ["Locations"], label: "View Locations" },
  { permission: Permission.ADMIN_EDIT_LOCATIONS, module: "Admin", path: ["Locations"], label: "Edit Locations" },

  // ===== Admin / Work Orders (admin-side edit/purge) =====
  { permission: Permission.ADMIN_VIEW_WORK_ORDERS, module: "Admin", path: ["Work Orders"], label: "View Work Orders (Admin)" },
  { permission: Permission.ADMIN_EDIT_WORK_ORDERS, module: "Admin", path: ["Work Orders"], label: "Edit Work Orders (Admin)" },
  {
    permission: Permission.ADMIN_DELETE_WORK_ORDERS,
    module: "Admin",
    path: ["Work Orders"],
    label: "Delete / Purge Work Orders (Admin)",
    description: "Allows permanently deleting work orders in the admin module.",
  },

  // ===== Admin / Maintenance Tickets =====
  { permission: Permission.ADMIN_VIEW_MAINTENANCE_TICKETS, module: "Admin", path: ["Maintenance Tickets"], label: "View Maintenance Tickets" },
  { permission: Permission.ADMIN_EXPORT_MAINTENANCE_TICKETS, module: "Admin", path: ["Maintenance Tickets"], label: "Export Maintenance Tickets" },
  {
    permission: ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
    module: "Admin",
    path: ["Preventative Maintenance"],
    label: "View Preventative Maintenance",
  },
  {
    permission: ADMIN_VIEW_EQUIPMENT_TRACKING,
    module: "Admin",
    path: ["Equipment Tracking"],
    label: "View Equipment Tracking",
  },
  {
    permission: ADMIN_VIEW_COMPANY_VEHICLES,
    module: "Admin",
    path: ["Company Vehicles"],
    label: "View Company Vehicles",
  },
  {
    permission: CREATE_COMPANY_VEHICLE_INFO,
    module: "Admin",
    path: ["Company Vehicles"],
    label: "Create Company Vehicles",
  },
  {
    permission: EDIT_COMPANY_VEHICLE_INFO,
    module: "Admin",
    path: ["Company Vehicles"],
    label: "Edit Company Vehicles",
  },
  {
    permission: ADMIN_VIEW_MAINTENANCE_REQUESTS,
    module: "Admin",
    path: ["Maintenance Requests"],
    label: "View Maintenance Requests",
  },
  {
    permission: ADMIN_VIEW_TEMPERATURE_DASHBOARD,
    module: "Admin",
    path: ["Temperature Dashboard"],
    label: "View Temperature Dashboard",
  },

  // ===== Admin / Reports =====
  {
    permission: ADMIN_VIEW_REPORT_SLA_BREACHES,
    module: "Admin",
    path: ["Reports"],
    label: "View Report: SLA Breach Monitor",
  },
  {
    permission: ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD,
    module: "Admin",
    path: ["Reports"],
    label: "View Report: Technician Workload",
  },
  {
    permission: ADMIN_VIEW_REPORT_TEMPERATURE_INCIDENTS,
    module: "Admin",
    path: ["Reports"],
    label: "View Report: Temperature Incident Timeline",
  },
  {
    permission: ADMIN_VIEW_REPORT_PM_COMPLIANCE,
    module: "Admin",
    path: ["Reports"],
    label: "View Report: PM Compliance Scorecard",
  },
  {
    permission: ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS,
    module: "Admin",
    path: ["Reports"],
    label: "View Report: Parts Consumption + Cost",
  },
  {
    permission: ADMIN_VIEW_REPORT_FLEET_TCO,
    module: "Admin",
    path: ["Reports"],
    label: "View Report: Fleet TCO",
  },
  {
    permission: ADMIN_VIEW_REPORT_PERMISSION_COVERAGE,
    module: "Admin",
    path: ["Reports"],
    label: "View Report: Permission Coverage",
  },
  {
    permission: ADMIN_VIEW_REPORT_NOTIFICATION_EFFECTIVENESS,
    module: "Admin",
    path: ["Reports"],
    label: "View Report: Notification Effectiveness",
  },

  // ===== Notifications / Routing =====
  {
    permission: RECEIVE_NOTIFICATION_MAINTENANCE_REQUESTS,
    module: "Notifications",
    path: ["Routing"],
    label: "Receive Maintenance Request Notifications",
  },
  {
    permission: RECEIVE_NOTIFICATION_TEMPERATURE_ALERTS,
    module: "Notifications",
    path: ["Routing"],
    label: "Receive Temperature Alert Notifications",
  },
  {
    permission: RECEIVE_NOTIFICATION_WORK_ORDER_SCHEDULES,
    module: "Notifications",
    path: ["Routing"],
    label: "Receive PM Schedule Work Order Notifications",
  },
  {
    permission: RECEIVE_NOTIFICATION_CYCLE_COUNTS,
    module: "Notifications",
    path: ["Routing"],
    label: "Receive Cycle Count Variance Notifications",
  },
];

// ✅ export exists (matches your import)
export function getPermissionModules(): string[] {
  const s = new Set<string>();
  for (const e of PERMISSION_CATALOG) s.add(e.module);
  return Array.from(s).sort((a, b) => a.localeCompare(b));
}

export type PermissionTreeNode =
  | { kind: "group"; key: string; name: string; children: PermissionTreeNode[] }
  | { kind: "leaf"; key: string; entry: PermissionCatalogEntry };

export function buildPermissionTreeForModule(module: string): PermissionTreeNode[] {
  const entries = PERMISSION_CATALOG.filter((e) => e.module === module).slice();

  entries.sort((a, b) => {
    const ap = a.path.join(" > ");
    const bp = b.path.join(" > ");
    if (ap !== bp) return ap.localeCompare(bp);
    return a.label.localeCompare(b.label);
  });

  const root: PermissionTreeNode = {
    kind: "group",
    key: `module:${module}`,
    name: module,
    children: [],
  };

  function getOrCreateGroup(parent: PermissionTreeNode[], name: string, key: string) {
    const existing = parent.find((n) => n.kind === "group" && n.key === key);
    if (existing && existing.kind === "group") return existing;
    const g: PermissionTreeNode = { kind: "group", key, name, children: [] };
    parent.push(g);
    return g as Extract<PermissionTreeNode, { kind: "group" }>;
  }

  for (const entry of entries) {
    let children = (root as Extract<PermissionTreeNode, { kind: "group" }>).children;
    let currentKey = `module:${module}`;

    for (const seg of entry.path) {
      currentKey += `/${seg}`;
      const g = getOrCreateGroup(children, seg, currentKey);
      children = g.children;
    }

    children.push({ kind: "leaf", key: `perm:${entry.permission}`, entry });
  }

  return (root as Extract<PermissionTreeNode, { kind: "group" }>).children;
}