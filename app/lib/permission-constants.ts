import type { Permission } from "@prisma/client";

// Cast to Permission so app code can compile before Prisma Client regeneration.
export const CREATE_WORK_ORDERS_FOR_OTHERS = "CREATE_WORK_ORDERS_FOR_OTHERS" as Permission;

// Maintenance feature permissions
export const VIEW_PREVENTATIVE_MAINTENANCE = "VIEW_PREVENTATIVE_MAINTENANCE" as Permission;
export const VIEW_EQUIPMENT_TRACKING = "VIEW_EQUIPMENT_TRACKING" as Permission;
export const VIEW_COMPANY_VEHICLE_LOG = "VIEW_COMPANY_VEHICLE_LOG" as Permission;
export const VIEW_MAINTENANCE_REQUESTS = "VIEW_MAINTENANCE_REQUESTS" as Permission;
export const VIEW_TEMPERATURE_DASHBOARD = "VIEW_TEMPERATURE_DASHBOARD" as Permission;

// Admin feature permissions
export const ADMIN_VIEW_PREVENTATIVE_MAINTENANCE = "ADMIN_VIEW_PREVENTATIVE_MAINTENANCE" as Permission;
export const ADMIN_VIEW_EQUIPMENT_TRACKING = "ADMIN_VIEW_EQUIPMENT_TRACKING" as Permission;
export const ADMIN_VIEW_COMPANY_VEHICLES = "ADMIN_VIEW_COMPANY_VEHICLES" as Permission;
export const ADMIN_VIEW_MAINTENANCE_REQUESTS = "ADMIN_VIEW_MAINTENANCE_REQUESTS" as Permission;
export const ADMIN_VIEW_TEMPERATURE_DASHBOARD = "ADMIN_VIEW_TEMPERATURE_DASHBOARD" as Permission;
