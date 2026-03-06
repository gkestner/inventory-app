-- Add maintenance permissions for managing company vehicle information.
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'CREATE_COMPANY_VEHICLE_INFO';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'EDIT_COMPANY_VEHICLE_INFO';
