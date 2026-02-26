// app/lib/permissionCatalog.ts
import { Permission } from "@prisma/client";

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
  { permission: Permission.UPDATE_OWN_WORK_ORDERS, module: "Maintenance", path: ["Work Orders"], label: "Update Own Work Orders" },
  { permission: Permission.SUBMIT_OWN_WORK_ORDERS, module: "Maintenance", path: ["Work Orders"], label: "Submit Own Work Orders" },

  // ===== Admin / Items =====
  { permission: Permission.ADMIN_VIEW_ITEMS, module: "Admin", path: ["Items"], label: "View Items" },
  { permission: Permission.ADMIN_EDIT_ITEMS, module: "Admin", path: ["Items"], label: "Edit Items" },
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