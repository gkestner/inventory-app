DO $$
DECLARE
  next_label_number bigint;
  sequence_name text;
BEGIN
  WITH invalid_items AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt", id) AS row_num
    FROM "Item"
    WHERE "labelNumber" IS NULL OR "labelNumber" <= 0
  ),
  baseline AS (
    SELECT GREATEST(COALESCE(MAX("labelNumber"), 0), 999) AS max_label_number
    FROM "Item"
    WHERE "labelNumber" IS NOT NULL AND "labelNumber" > 0
  )
  UPDATE "Item" AS item
  SET "labelNumber" = baseline.max_label_number + invalid_items.row_num
  FROM invalid_items, baseline
  WHERE item.id = invalid_items.id;

  SELECT GREATEST(COALESCE(MAX("labelNumber"), 0), 999)
  INTO next_label_number
  FROM "Item";

  sequence_name := pg_get_serial_sequence('"Item"', 'labelNumber');
  IF sequence_name IS NOT NULL THEN
    EXECUTE format('SELECT setval(%L::regclass, %s, true)', sequence_name, next_label_number);
  END IF;
END $$;