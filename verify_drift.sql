-- 1) Verify EquipmentArea enum has the legacy values
SELECT enumlabel
FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'EquipmentArea'
ORDER BY enumsortorder;

-- 2) Verify UserLocation has isPrimary column
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'UserLocation'
ORDER BY ordinal_position;
