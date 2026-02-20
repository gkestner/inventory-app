/*
  Warnings:

  - The primary key for the `UserLocation` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[userId,locationId]` on the table `UserLocation` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `Location` table without a default value. This is not possible if the table is not empty.
  - The required column `id` was added to the `UserLocation` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EquipmentArea" ADD VALUE 'FRONT_COUNTER';
ALTER TYPE "EquipmentArea" ADD VALUE 'DRIVE_THRU';
ALTER TYPE "EquipmentArea" ADD VALUE 'KITCHEN';
ALTER TYPE "EquipmentArea" ADD VALUE 'ROOF';
ALTER TYPE "EquipmentArea" ADD VALUE 'HVAC';

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "UserLocation" DROP CONSTRAINT "UserLocation_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false,
ADD CONSTRAINT "UserLocation_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE INDEX "UserLocation_userId_isPrimary_sortOrder_idx" ON "UserLocation"("userId", "isPrimary", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "UserLocation_userId_locationId_key" ON "UserLocation"("userId", "locationId");
