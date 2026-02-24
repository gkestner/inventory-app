/*
  Warnings:

  - You are about to drop the column `unit` on the `Item` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "InvoiceVendorConfig" ADD COLUMN     "costFormula" TEXT NOT NULL DEFAULT 'baseCost * (1 + partsUpchargePct / 100)',
ADD COLUMN     "taxFormula" TEXT NOT NULL DEFAULT 'lineSubtotal * (taxRatePct / 100)';

-- AlterTable
ALTER TABLE "Item" DROP COLUMN "unit";
