-- Add permission-tree entries for receipt feature access.
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'VIEW_RECEIPTS';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'CREATE_RECEIPTS';
