DO $$
BEGIN
  -- Required pizza list
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'EquipmentArea' AND e.enumlabel = 'DOUGH_ROLLER'
  ) THEN
    ALTER TYPE "EquipmentArea" ADD VALUE 'DOUGH_ROLLER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'EquipmentArea' AND e.enumlabel = 'MAKETABLE'
  ) THEN
    ALTER TYPE "EquipmentArea" ADD VALUE 'MAKETABLE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'EquipmentArea' AND e.enumlabel = 'DOUGH_COOLER'
  ) THEN
    ALTER TYPE "EquipmentArea" ADD VALUE 'DOUGH_COOLER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'EquipmentArea' AND e.enumlabel = 'MIXER'
  ) THEN
    ALTER TYPE "EquipmentArea" ADD VALUE 'MIXER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'EquipmentArea' AND e.enumlabel = 'OVEN'
  ) THEN
    ALTER TYPE "EquipmentArea" ADD VALUE 'OVEN';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'EquipmentArea' AND e.enumlabel = 'BUILDING_STRUCTURE'
  ) THEN
    ALTER TYPE "EquipmentArea" ADD VALUE 'BUILDING_STRUCTURE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'EquipmentArea' AND e.enumlabel = 'LIGHTING'
  ) THEN
    ALTER TYPE "EquipmentArea" ADD VALUE 'LIGHTING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'EquipmentArea' AND e.enumlabel = 'PARKING_LOT'
  ) THEN
    ALTER TYPE "EquipmentArea" ADD VALUE 'PARKING_LOT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'EquipmentArea' AND e.enumlabel = 'HVAC_GAME_ROOM'
  ) THEN
    ALTER TYPE "EquipmentArea" ADD VALUE 'HVAC_GAME_ROOM';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'EquipmentArea' AND e.enumlabel = 'HVAC_KITCHEN'
  ) THEN
    ALTER TYPE "EquipmentArea" ADD VALUE 'HVAC_KITCHEN';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'EquipmentArea' AND e.enumlabel = 'HVAC_DINING_ROOM'
  ) THEN
    ALTER TYPE "EquipmentArea" ADD VALUE 'HVAC_DINING_ROOM';
  END IF;
END$$;
