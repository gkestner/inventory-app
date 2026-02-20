-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "orderFrom" TEXT,
ADD COLUMN     "webUrl" TEXT;

-- AlterTable
ALTER TABLE "ItemVersion" ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "orderFrom" TEXT,
ADD COLUMN     "webUrl" TEXT;
