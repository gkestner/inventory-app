import type { Permission } from "@prisma/client";

// Cast to Permission so app code can compile before Prisma Client regeneration.
export const CREATE_WORK_ORDERS_FOR_OTHERS = "CREATE_WORK_ORDERS_FOR_OTHERS" as Permission;
