/*
  Warnings:

  - The values [FRONT_COUNTER,DRIVE_THRU,KITCHEN,ROOF,HVAC] on the enum `EquipmentArea` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "EquipmentArea_new" AS ENUM ('DOUGH_ROLLER', 'MAKETABLE', 'DOUGH_COOLER', 'MIXER', 'OVEN', 'WALK_IN', 'FREEZER', 'BUILDING_STRUCTURE', 'LIGHTING', 'PARKING_LOT', 'OFFICE', 'HVAC_GAME_ROOM', 'HVAC_KITCHEN', 'HVAC_DINING_ROOM', 'OTHER');
ALTER TABLE "WorkOrderEquipmentArea" ALTER COLUMN "area" TYPE "EquipmentArea_new" USING ("area"::text::"EquipmentArea_new");
ALTER TYPE "EquipmentArea" RENAME TO "EquipmentArea_old";
ALTER TYPE "EquipmentArea_new" RENAME TO "EquipmentArea";
DROP TYPE "EquipmentArea_old";
COMMIT;
