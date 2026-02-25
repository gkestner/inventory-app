-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'MAINTENANCE';

-- CreateTable
CREATE TABLE "PermissionTitle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionTitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionTitlePermission" (
    "titleId" TEXT NOT NULL,
    "permission" "Permission" NOT NULL,

    CONSTRAINT "PermissionTitlePermission_pkey" PRIMARY KEY ("titleId","permission")
);

-- CreateTable
CREATE TABLE "UserPermissionTitle" (
    "userId" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermissionTitle_pkey" PRIMARY KEY ("userId","titleId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PermissionTitle_name_key" ON "PermissionTitle"("name");

-- CreateIndex
CREATE INDEX "PermissionTitle_active_idx" ON "PermissionTitle"("active");

-- CreateIndex
CREATE INDEX "PermissionTitlePermission_permission_idx" ON "PermissionTitlePermission"("permission");

-- CreateIndex
CREATE INDEX "PermissionTitlePermission_titleId_idx" ON "PermissionTitlePermission"("titleId");

-- CreateIndex
CREATE INDEX "UserPermissionTitle_userId_idx" ON "UserPermissionTitle"("userId");

-- CreateIndex
CREATE INDEX "UserPermissionTitle_titleId_idx" ON "UserPermissionTitle"("titleId");

-- CreateIndex
CREATE INDEX "InventoryOrder_supplierName_idx" ON "InventoryOrder"("supplierName");

-- CreateIndex
CREATE INDEX "InventoryOrder_supplierPartNumber_idx" ON "InventoryOrder"("supplierPartNumber");

-- AddForeignKey
ALTER TABLE "PermissionTitlePermission" ADD CONSTRAINT "PermissionTitlePermission_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "PermissionTitle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionTitle" ADD CONSTRAINT "UserPermissionTitle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionTitle" ADD CONSTRAINT "UserPermissionTitle_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "PermissionTitle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
