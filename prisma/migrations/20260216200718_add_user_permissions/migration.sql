-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('VIEW_HOME', 'VIEW_CHECKOUT', 'CREATE_CHECKOUT', 'VIEW_WORK_ORDERS', 'CREATE_WORK_ORDERS', 'UPDATE_OWN_WORK_ORDERS', 'SUBMIT_OWN_WORK_ORDERS', 'ADMIN_VIEW_ITEMS', 'ADMIN_EDIT_ITEMS', 'ADMIN_IMPORT_EXPORT_ITEMS', 'ADMIN_VIEW_USERS', 'ADMIN_EDIT_USERS', 'ADMIN_VIEW_LOCATIONS', 'ADMIN_EDIT_LOCATIONS', 'ADMIN_VIEW_WORK_ORDERS', 'ADMIN_EDIT_WORK_ORDERS', 'ADMIN_DELETE_WORK_ORDERS', 'ADMIN_VIEW_MAINTENANCE_TICKETS', 'ADMIN_EXPORT_MAINTENANCE_TICKETS');

-- CreateTable
CREATE TABLE "UserPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" "Permission" NOT NULL,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserPermission_permission_idx" ON "UserPermission"("permission");

-- CreateIndex
CREATE INDEX "UserPermission_userId_idx" ON "UserPermission"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_userId_permission_key" ON "UserPermission"("userId", "permission");

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
