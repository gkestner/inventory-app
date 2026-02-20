/*
  Warnings:

  - A unique constraint covering the columns `[locationNumber]` on the table `Location` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "InvoiceVendor" AS ENUM ('SUCCESS_PLUS', 'AMERICAN_PLUS');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOIDED');

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "locationNumber" TEXT;

-- AlterTable
ALTER TABLE "PartsCheckoutTicket" ADD COLUMN     "invoiceId" TEXT;

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "vendor" "InvoiceVendor" NOT NULL,
    "vendorNumber" TEXT NOT NULL,
    "billedTo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "storeNumber" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "taxTotal" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidNote" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "sku" TEXT NOT NULL,
    "partNumber" TEXT,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "taxable" BOOLEAN NOT NULL,
    "lineSubtotal" DECIMAL(12,2) NOT NULL,
    "lineTax" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invoice_storeId_invoiceDate_idx" ON "Invoice"("storeId", "invoiceDate");

-- CreateIndex
CREATE INDEX "Invoice_vendor_invoiceDate_idx" ON "Invoice"("vendor", "invoiceDate");

-- CreateIndex
CREATE INDEX "Invoice_status_createdAt_idx" ON "Invoice"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_storeId_periodStart_periodEnd_idx" ON "Invoice"("storeId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_checkoutId_key" ON "InvoiceLine"("checkoutId");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_locationNumber_key" ON "Location"("locationNumber");

-- CreateIndex
CREATE INDEX "PartsCheckoutTicket_invoiceId_idx" ON "PartsCheckoutTicket"("invoiceId");

-- AddForeignKey
ALTER TABLE "PartsCheckoutTicket" ADD CONSTRAINT "PartsCheckoutTicket_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "PartsCheckoutTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
