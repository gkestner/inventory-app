/*
  Warnings:

  - You are about to drop the column `sku` on the `ImportRowError` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[itemId,version]` on the table `ItemVersion` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "ImportRowError_jobId_rowNumber_idx";

-- DropIndex
DROP INDEX "ItemVersion_itemId_version_idx";

-- AlterTable
ALTER TABLE "ImportRowError" DROP COLUMN "sku";

-- CreateTable
CREATE TABLE "UserLocation" (
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UserLocation_pkey" PRIMARY KEY ("userId","locationId")
);

-- CreateIndex
CREATE INDEX "UserLocation_userId_sortOrder_idx" ON "UserLocation"("userId", "sortOrder");

-- CreateIndex
CREATE INDEX "UserLocation_locationId_idx" ON "UserLocation"("locationId");

-- CreateIndex
CREATE INDEX "ImportRowError_jobId_createdAt_idx" ON "ImportRowError"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "Item_updatedAt_idx" ON "Item"("updatedAt");

-- CreateIndex
CREATE INDEX "Item_name_idx" ON "Item"("name");

-- CreateIndex
CREATE INDEX "Item_category_idx" ON "Item"("category");

-- CreateIndex
CREATE INDEX "Item_manufacturer_idx" ON "Item"("manufacturer");

-- CreateIndex
CREATE INDEX "Item_orderFrom_idx" ON "Item"("orderFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ItemVersion_itemId_version_key" ON "ItemVersion"("itemId", "version");

-- AddForeignKey
ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
