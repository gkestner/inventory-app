-- Add cancellation support to inventory orders.
ALTER TYPE "InventoryOrderStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "InventoryOrder"
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
