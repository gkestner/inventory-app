CREATE TABLE "Supplier" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  "paymentMethod" TEXT,
  "accountNumber" TEXT,
  "phone" TEXT,
  "extension" TEXT,
  "email" TEXT,
  "partsSummary" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierAlias" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupplierAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Supplier_normalizedKey_key" ON "Supplier"("normalizedKey");
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");
CREATE INDEX "Supplier_updatedAt_idx" ON "Supplier"("updatedAt");

CREATE UNIQUE INDEX "SupplierAlias_normalizedKey_key" ON "SupplierAlias"("normalizedKey");
CREATE INDEX "SupplierAlias_supplierId_idx" ON "SupplierAlias"("supplierId");
CREATE INDEX "SupplierAlias_name_idx" ON "SupplierAlias"("name");

ALTER TABLE "SupplierAlias"
  ADD CONSTRAINT "SupplierAlias_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
