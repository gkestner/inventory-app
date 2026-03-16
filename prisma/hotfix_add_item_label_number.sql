DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Item'
      AND column_name = 'labelNumber'
  ) THEN
    ALTER TABLE "Item" ADD COLUMN "labelNumber" SERIAL;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "Item_labelNumber_key"
  ON "Item"("labelNumber");
