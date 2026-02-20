SELECT migration_name, finished_at
FROM "_prisma_migrations"
WHERE migration_name = '20260213160000_align_workorders_userlocations';

DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260213160000_align_workorders_userlocations';

SELECT migration_name
FROM "_prisma_migrations"
WHERE migration_name = '20260213160000_align_workorders_userlocations';
