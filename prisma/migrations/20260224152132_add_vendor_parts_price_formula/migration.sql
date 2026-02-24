/*
  Warnings:

  - You are about to drop the column `costFormula` on the `InvoiceVendorConfig` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "InvoiceVendorConfig" DROP COLUMN "costFormula",
ADD COLUMN     "partsPriceFormula" TEXT NOT NULL DEFAULT 'cost * (1 + (partsUpchargePct / 100))';
