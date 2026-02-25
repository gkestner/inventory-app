-- CreateTable
CREATE TABLE "AppRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "AppRolePermission" (
    "roleId" TEXT NOT NULL,
    "permission" "Permission" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppRolePermission_pkey" PRIMARY KEY ("roleId","permission")
);

-- CreateTable
CREATE TABLE "AppRolePermissionTitle" (
    "roleId" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppRolePermissionTitle_pkey" PRIMARY KEY ("roleId","titleId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppRole_name_key" ON "AppRole"("name");

-- CreateIndex
CREATE INDEX "AppRole_isSystem_idx" ON "AppRole"("isSystem");

-- CreateIndex
CREATE INDEX "UserRole_userId_idx" ON "UserRole"("userId");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE INDEX "AppRolePermission_permission_idx" ON "AppRolePermission"("permission");

-- CreateIndex
CREATE INDEX "AppRolePermission_roleId_idx" ON "AppRolePermission"("roleId");

-- CreateIndex
CREATE INDEX "AppRolePermissionTitle_roleId_idx" ON "AppRolePermissionTitle"("roleId");

-- CreateIndex
CREATE INDEX "AppRolePermissionTitle_titleId_idx" ON "AppRolePermissionTitle"("titleId");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AppRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppRolePermission" ADD CONSTRAINT "AppRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AppRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppRolePermissionTitle" ADD CONSTRAINT "AppRolePermissionTitle_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AppRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppRolePermissionTitle" ADD CONSTRAINT "AppRolePermissionTitle_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "PermissionTitle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
