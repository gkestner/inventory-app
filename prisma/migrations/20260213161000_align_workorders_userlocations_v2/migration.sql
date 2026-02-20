-- prisma/migrations/20260213161000_align_workorders_userlocations_v2/migration.sql

/*
  Purpose:
  - Resolve drift without resetting the database.
  - Shadow-safe: migration history in shadow DB may not include these objects.
  - Real DB-safe: additive only.
*/

-- 1) Add legacy enum variants to EquipmentArea (additive; safe; shadow-safe)
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TYPE "EquipmentArea" ADD VALUE IF NOT EXISTS ''FRONT_COUNTER''';
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;

  BEGIN
    EXECUTE 'ALTER TYPE "EquipmentArea" ADD VALUE IF NOT EXISTS ''DRIVE_THRU''';
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;

  BEGIN
    EXECUTE 'ALTER TYPE "EquipmentArea" ADD VALUE IF NOT EXISTS ''KITCHEN''';
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;

  BEGIN
    EXECUTE 'ALTER TYPE "EquipmentArea" ADD VALUE IF NOT EXISTS ''ROOF''';
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;

  BEGIN
    EXECUTE 'ALTER TYPE "EquipmentArea" ADD VALUE IF NOT EXISTS ''HVAC''';
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;
END
$$;

-- 2) Add isPrimary column to UserLocation (additive; safe; shadow-safe)
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE "UserLocation" ADD COLUMN IF NOT EXISTS "isPrimary" BOOLEAN NOT NULL DEFAULT false';
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;
END
$$;
