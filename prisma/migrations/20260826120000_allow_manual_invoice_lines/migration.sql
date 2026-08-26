-- Manual invoice lines are not backed by an inventory checkout.
ALTER TABLE "InvoiceLine" ALTER COLUMN "checkoutId" DROP NOT NULL;
