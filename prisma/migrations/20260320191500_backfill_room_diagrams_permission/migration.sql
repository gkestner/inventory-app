INSERT INTO "PermissionTitlePermission" ("titleId", "permission")
SELECT "titleId", 'VIEW_ROOM_DIAGRAMS'::"Permission"
FROM "PermissionTitlePermission"
WHERE "permission" = 'VIEW_CHECKOUT'
ON CONFLICT ("titleId", "permission") DO NOTHING;

INSERT INTO "AppRolePermission" ("roleId", "permission", "assignedAt")
SELECT "roleId", 'VIEW_ROOM_DIAGRAMS'::"Permission", NOW()
FROM "AppRolePermission"
WHERE "permission" = 'VIEW_CHECKOUT'
ON CONFLICT ("roleId", "permission") DO NOTHING;

INSERT INTO "UserPermission" ("id", "userId", "permission")
SELECT md5("userId" || clock_timestamp()::text || random()::text), "userId", 'VIEW_ROOM_DIAGRAMS'::"Permission"
FROM "UserPermission"
WHERE "permission" = 'VIEW_CHECKOUT'
ON CONFLICT ("userId", "permission") DO NOTHING;