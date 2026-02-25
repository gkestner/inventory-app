// app/lib/permissionCatalog.ts
import { Permission } from "@prisma/client";

export type PermissionCatalogEntry = {
  permission: Permission;
  module: string; // left nav category (Payroll, Admin, Inventory, etc.)
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