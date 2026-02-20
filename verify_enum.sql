SELECT enumlabel
FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'EquipmentArea'
ORDER BY enumsortorder;
