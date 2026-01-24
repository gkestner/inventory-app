-- CreateTable
CREATE TABLE "ItemVersion" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "partNumber" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "unit" TEXT,
    "cost" DECIMAL(10,2),
    "price" DECIMAL(10,2),
    "taxable" BOOLEAN NOT NULL,
    "active" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemVersion_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ItemVersion" ADD CONSTRAINT "ItemVersion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
