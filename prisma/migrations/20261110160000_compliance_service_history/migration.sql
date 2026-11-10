BEGIN;
-- Additive, relational service ledger. Original annual rows and audit logs remain intact.
CREATE TABLE "ComplianceServiceEntry" (
 "id" TEXT PRIMARY KEY, "reminderLocationId" TEXT NOT NULL,
 "sourceAnnualEntryId" TEXT, "sourceAuditLogId" TEXT, "supersedesEntryId" TEXT,
 "recordedByUserId" TEXT, "companyId" TEXT, "companyName" TEXT,
 "serviceDate" TEXT NOT NULL, "recordYear" INTEGER NOT NULL,
 "intervalMonths" INTEGER NOT NULL, "intervalOverrideMonths" INTEGER, "intervalText" TEXT,
 "cost" TEXT, "tankSize" TEXT, "gallons" TEXT, "additionalDate" TEXT, "notes" TEXT,
 "source" TEXT NOT NULL, "submissionToken" TEXT, "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ComplianceServiceEntry_id_reminderLocationId_key" UNIQUE ("id","reminderLocationId"),
 CONSTRAINT "ComplianceServiceEntry_reminderLocationId_fkey" FOREIGN KEY ("reminderLocationId") REFERENCES "NotificationReminderLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ComplianceServiceEntry_sourceAnnualEntryId_fkey" FOREIGN KEY ("sourceAnnualEntryId") REFERENCES "PreventativeMaintenanceEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ComplianceServiceEntry_sourceAuditLogId_fkey" FOREIGN KEY ("sourceAuditLogId") REFERENCES "AuditLog"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 CONSTRAINT "ComplianceServiceEntry_supersedesEntryId_fkey" FOREIGN KEY ("supersedesEntryId","reminderLocationId") REFERENCES "ComplianceServiceEntry"("id","reminderLocationId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ComplianceServiceEntry_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 CONSTRAINT "ComplianceServiceEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "ReminderCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ComplianceServiceEntry_interval_check" CHECK ("intervalMonths" BETWEEN 1 AND 120 AND ("intervalOverrideMonths" IS NULL OR "intervalOverrideMonths" BETWEEN 1 AND 120)),
 CONSTRAINT "ComplianceServiceEntry_year_check" CHECK ("recordYear" BETWEEN 1000 AND 9999),
 CONSTRAINT "ComplianceServiceEntry_source_check" CHECK ("source" IN ('BASELINE','AUDIT','ANNUAL_EDIT','DASHBOARD','CUSTOM_EDIT')),
 CONSTRAINT "ComplianceServiceEntry_no_self_correction_check" CHECK ("supersedesEntryId" IS NULL OR "supersedesEntryId" <> "id")
);
CREATE UNIQUE INDEX "ComplianceServiceEntry_submissionToken_key" ON "ComplianceServiceEntry"("submissionToken");
CREATE UNIQUE INDEX "ComplianceServiceEntry_supersedesEntryId_reminderLocationId_key" ON "ComplianceServiceEntry"("supersedesEntryId","reminderLocationId");
CREATE UNIQUE INDEX "ComplianceServiceEntry_supersedesEntryId_key" ON "ComplianceServiceEntry"("supersedesEntryId");
CREATE UNIQUE INDEX "ComplianceServiceEntry_sourceAuditLogId_reminderLocationId_key" ON "ComplianceServiceEntry"("sourceAuditLogId", "reminderLocationId");
CREATE INDEX "ComplianceServiceEntry_reminderLocationId_recordedAt_id_idx" ON "ComplianceServiceEntry"("reminderLocationId", "recordedAt", "id");
CREATE INDEX "ComplianceServiceEntry_recordYear_recordedAt_id_idx" ON "ComplianceServiceEntry"("recordYear", "recordedAt", "id");
CREATE INDEX "ComplianceServiceEntry_sourceAnnualEntryId_idx" ON "ComplianceServiceEntry"("sourceAnnualEntryId");
CREATE INDEX "ComplianceServiceEntry_recordedByUserId_idx" ON "ComplianceServiceEntry"("recordedByUserId");
CREATE INDEX "ComplianceServiceEntry_companyId_idx" ON "ComplianceServiceEntry"("companyId");

-- Include inactive historical locations as well as currently visible locations.
INSERT INTO "NotificationReminderLocation" ("id","listId","locationId","createdAt","updatedAt")
SELECT 'history-row-' || md5(p."locationId" || ':' || s.id), s.id, p."locationId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "locationId" FROM "PreventativeMaintenanceEntry") p
CROSS JOIN "NotificationReminderList" s WHERE s."complianceKind" IS NOT NULL
ON CONFLICT ("listId","locationId") DO NOTHING;

-- GREASE_TRAP: import reliable full-value audit snapshots only for changes in this section.
INSERT INTO "ComplianceServiceEntry" ("id","reminderLocationId","sourceAnnualEntryId","sourceAuditLogId","recordedByUserId","companyId","companyName","serviceDate","recordYear","intervalMonths","intervalOverrideMonths","intervalText","cost","tankSize","gallons","additionalDate","source","recordedAt")
SELECT 'history-audit-' || md5(a.id || ':' || s.id), r.id, p.id, a.id, a."actorUserId",
 CASE WHEN EXISTS (SELECT 1 FROM "ReminderCompany" company WHERE company.id=a.metadata->'companyReferences'->'after'->>'greaseTrapCompanyId') THEN a.metadata->'companyReferences'->'after'->>'greaseTrapCompanyId' ELSE NULL END,
 NULLIF(trim(a.metadata->'values'->>'greaseTrapCompany'),''), COALESCE(NULLIF(trim(a.metadata->'values'->>'greaseTrapDatePumped'),''),''), p.year, COALESCE(CASE WHEN NULLIF(trim(a.metadata->'values'->>'greaseTrapReminderMonths'),'') ~ '^[0-9]{1,3}$' THEN CASE WHEN (NULLIF(trim(a.metadata->'values'->>'greaseTrapReminderMonths'),''))::INTEGER BETWEEN 1 AND 120 THEN (NULLIF(trim(a.metadata->'values'->>'greaseTrapReminderMonths'),''))::INTEGER ELSE NULL END ELSE NULL END,s."defaultIntervalMonths"), CASE WHEN NULLIF(trim(a.metadata->'values'->>'greaseTrapReminderMonths'),'') ~ '^[0-9]{1,3}$' THEN CASE WHEN (NULLIF(trim(a.metadata->'values'->>'greaseTrapReminderMonths'),''))::INTEGER BETWEEN 1 AND 120 THEN (NULLIF(trim(a.metadata->'values'->>'greaseTrapReminderMonths'),''))::INTEGER ELSE NULL END ELSE NULL END, NULLIF(trim(a.metadata->'values'->>'greaseTrapReminderMonths'),''), NULLIF(trim(a.metadata->'values'->>'greaseTrapCost'),''), NULLIF(trim(a.metadata->'values'->>'greaseTrapTankSize'),''), NULLIF(trim(a.metadata->'values'->>'greaseTrapGallons'),''), NULL::TEXT, 'AUDIT', a."createdAt"
FROM "AuditLog" a JOIN "PreventativeMaintenanceEntry" p ON a."entityType"='PreventativeMaintenanceEntry' AND a."entityId"=p.id
JOIN "NotificationReminderList" s ON s."complianceKind"='GREASE_TRAP'
JOIN "NotificationReminderLocation" r ON r."listId"=s.id AND r."locationId"=p."locationId"
WHERE a.module='PREVENTATIVE_MAINTENANCE' AND a.action IN ('CREATE_ENTRY','UPDATE_ENTRY')
 AND jsonb_typeof(a.metadata->'values')='object'
 AND (a.metadata->'changes' ?| ARRAY['greaseTrapDatePumped','greaseTrapReminderMonths','greaseTrapCompany','greaseTrapCost','greaseTrapTankSize','greaseTrapGallons'] OR (a.action='CREATE_ENTRY' AND (NULLIF(trim(a.metadata->'values'->>'greaseTrapDatePumped'),'') IS NOT NULL OR NULLIF(trim(a.metadata->'values'->>'greaseTrapReminderMonths'),'') IS NOT NULL OR NULLIF(trim(a.metadata->'values'->>'greaseTrapCompany'),'') IS NOT NULL OR NULLIF(trim(a.metadata->'values'->>'greaseTrapCost'),'') IS NOT NULL OR NULLIF(trim(a.metadata->'values'->>'greaseTrapTankSize'),'') IS NOT NULL OR NULLIF(trim(a.metadata->'values'->>'greaseTrapGallons'),'') IS NOT NULL)))
ON CONFLICT DO NOTHING;

-- Preserve the current facts if no matching latest audited section snapshot exists.
INSERT INTO "ComplianceServiceEntry" ("id","reminderLocationId","sourceAnnualEntryId","recordedByUserId","companyId","companyName","serviceDate","recordYear","intervalMonths","intervalOverrideMonths","intervalText","cost","tankSize","gallons","additionalDate","source","recordedAt")
SELECT 'history-baseline-' || md5(p.id || ':' || s.id), r.id, p.id, p."updatedByUserId", p."greaseTrapCompanyId", NULLIF(trim(p."greaseTrapCompany"),''), COALESCE(NULLIF(trim(p."greaseTrapDatePumped"),''),''), p.year,
 COALESCE(CASE WHEN NULLIF(trim(p."greaseTrapReminderMonths"),'') ~ '^[0-9]{1,3}$' THEN CASE WHEN (NULLIF(trim(p."greaseTrapReminderMonths"),''))::INTEGER BETWEEN 1 AND 120 THEN (NULLIF(trim(p."greaseTrapReminderMonths"),''))::INTEGER ELSE NULL END ELSE NULL END,s."defaultIntervalMonths"), CASE WHEN NULLIF(trim(p."greaseTrapReminderMonths"),'') ~ '^[0-9]{1,3}$' THEN CASE WHEN (NULLIF(trim(p."greaseTrapReminderMonths"),''))::INTEGER BETWEEN 1 AND 120 THEN (NULLIF(trim(p."greaseTrapReminderMonths"),''))::INTEGER ELSE NULL END ELSE NULL END, NULLIF(trim(p."greaseTrapReminderMonths"),''), NULLIF(trim(p."greaseTrapCost"),''), NULLIF(trim(p."greaseTrapTankSize"),''), NULLIF(trim(p."greaseTrapGallons"),''), NULL::TEXT, 'BASELINE', p."updatedAt"
FROM "PreventativeMaintenanceEntry" p JOIN "NotificationReminderList" s ON s."complianceKind"='GREASE_TRAP'
JOIN "NotificationReminderLocation" r ON r."listId"=s.id AND r."locationId"=p."locationId"
LEFT JOIN LATERAL (SELECT h.* FROM "ComplianceServiceEntry" h WHERE h."reminderLocationId"=r.id AND h."sourceAnnualEntryId"=p.id ORDER BY h."recordedAt" DESC,h.id DESC LIMIT 1) last ON true
WHERE (NULLIF(trim(p."greaseTrapDatePumped"),'') IS NOT NULL OR NULLIF(trim(p."greaseTrapReminderMonths"),'') IS NOT NULL OR NULLIF(trim(p."greaseTrapCompany"),'') IS NOT NULL OR NULLIF(trim(p."greaseTrapCost"),'') IS NOT NULL OR NULLIF(trim(p."greaseTrapTankSize"),'') IS NOT NULL OR NULLIF(trim(p."greaseTrapGallons"),'') IS NOT NULL OR last.id IS NOT NULL)
AND (last.id IS NULL OR ROW(last."serviceDate",last."intervalText",last."companyName",last.cost,last."tankSize",last.gallons,last."additionalDate") IS DISTINCT FROM ROW(COALESCE(NULLIF(trim(p."greaseTrapDatePumped"),''),''),NULLIF(trim(p."greaseTrapReminderMonths"),''),NULLIF(trim(p."greaseTrapCompany"),''),NULLIF(trim(p."greaseTrapCost"),''),NULLIF(trim(p."greaseTrapTankSize"),''),NULLIF(trim(p."greaseTrapGallons"),''),NULL::TEXT));

-- BACKFLOW: import reliable full-value audit snapshots only for changes in this section.
INSERT INTO "ComplianceServiceEntry" ("id","reminderLocationId","sourceAnnualEntryId","sourceAuditLogId","recordedByUserId","companyId","companyName","serviceDate","recordYear","intervalMonths","intervalOverrideMonths","intervalText","cost","tankSize","gallons","additionalDate","source","recordedAt")
SELECT 'history-audit-' || md5(a.id || ':' || s.id), r.id, p.id, a.id, a."actorUserId",
 CASE WHEN EXISTS (SELECT 1 FROM "ReminderCompany" company WHERE company.id=a.metadata->'companyReferences'->'after'->>'backflowCompanyId') THEN a.metadata->'companyReferences'->'after'->>'backflowCompanyId' ELSE NULL END,
 NULLIF(trim(a.metadata->'values'->>'backflowCompany'),''), COALESCE(NULLIF(trim(a.metadata->'values'->>'backflowDateChecked'),''),''), p.year, COALESCE(CASE WHEN NULLIF(trim(a.metadata->'values'->>'backflowReminderMonths'),'') ~ '^[0-9]{1,3}$' THEN CASE WHEN (NULLIF(trim(a.metadata->'values'->>'backflowReminderMonths'),''))::INTEGER BETWEEN 1 AND 120 THEN (NULLIF(trim(a.metadata->'values'->>'backflowReminderMonths'),''))::INTEGER ELSE NULL END ELSE NULL END,s."defaultIntervalMonths"), CASE WHEN NULLIF(trim(a.metadata->'values'->>'backflowReminderMonths'),'') ~ '^[0-9]{1,3}$' THEN CASE WHEN (NULLIF(trim(a.metadata->'values'->>'backflowReminderMonths'),''))::INTEGER BETWEEN 1 AND 120 THEN (NULLIF(trim(a.metadata->'values'->>'backflowReminderMonths'),''))::INTEGER ELSE NULL END ELSE NULL END, NULLIF(trim(a.metadata->'values'->>'backflowReminderMonths'),''), NULLIF(trim(a.metadata->'values'->>'backflowAmount'),''), NULL::TEXT, NULL::TEXT, NULL::TEXT, 'AUDIT', a."createdAt"
FROM "AuditLog" a JOIN "PreventativeMaintenanceEntry" p ON a."entityType"='PreventativeMaintenanceEntry' AND a."entityId"=p.id
JOIN "NotificationReminderList" s ON s."complianceKind"='BACKFLOW'
JOIN "NotificationReminderLocation" r ON r."listId"=s.id AND r."locationId"=p."locationId"
WHERE a.module='PREVENTATIVE_MAINTENANCE' AND a.action IN ('CREATE_ENTRY','UPDATE_ENTRY')
 AND jsonb_typeof(a.metadata->'values')='object'
 AND (a.metadata->'changes' ?| ARRAY['backflowDateChecked','backflowReminderMonths','backflowCompany','backflowAmount'] OR (a.action='CREATE_ENTRY' AND (NULLIF(trim(a.metadata->'values'->>'backflowDateChecked'),'') IS NOT NULL OR NULLIF(trim(a.metadata->'values'->>'backflowReminderMonths'),'') IS NOT NULL OR NULLIF(trim(a.metadata->'values'->>'backflowCompany'),'') IS NOT NULL OR NULLIF(trim(a.metadata->'values'->>'backflowAmount'),'') IS NOT NULL)))
ON CONFLICT DO NOTHING;

-- Preserve the current facts if no matching latest audited section snapshot exists.
INSERT INTO "ComplianceServiceEntry" ("id","reminderLocationId","sourceAnnualEntryId","recordedByUserId","companyId","companyName","serviceDate","recordYear","intervalMonths","intervalOverrideMonths","intervalText","cost","tankSize","gallons","additionalDate","source","recordedAt")
SELECT 'history-baseline-' || md5(p.id || ':' || s.id), r.id, p.id, p."updatedByUserId", p."backflowCompanyId", NULLIF(trim(p."backflowCompany"),''), COALESCE(NULLIF(trim(p."backflowDateChecked"),''),''), p.year,
 COALESCE(CASE WHEN NULLIF(trim(p."backflowReminderMonths"),'') ~ '^[0-9]{1,3}$' THEN CASE WHEN (NULLIF(trim(p."backflowReminderMonths"),''))::INTEGER BETWEEN 1 AND 120 THEN (NULLIF(trim(p."backflowReminderMonths"),''))::INTEGER ELSE NULL END ELSE NULL END,s."defaultIntervalMonths"), CASE WHEN NULLIF(trim(p."backflowReminderMonths"),'') ~ '^[0-9]{1,3}$' THEN CASE WHEN (NULLIF(trim(p."backflowReminderMonths"),''))::INTEGER BETWEEN 1 AND 120 THEN (NULLIF(trim(p."backflowReminderMonths"),''))::INTEGER ELSE NULL END ELSE NULL END, NULLIF(trim(p."backflowReminderMonths"),''), NULLIF(trim(p."backflowAmount"),''), NULL::TEXT, NULL::TEXT, NULL::TEXT, 'BASELINE', p."updatedAt"
FROM "PreventativeMaintenanceEntry" p JOIN "NotificationReminderList" s ON s."complianceKind"='BACKFLOW'
JOIN "NotificationReminderLocation" r ON r."listId"=s.id AND r."locationId"=p."locationId"
LEFT JOIN LATERAL (SELECT h.* FROM "ComplianceServiceEntry" h WHERE h."reminderLocationId"=r.id AND h."sourceAnnualEntryId"=p.id ORDER BY h."recordedAt" DESC,h.id DESC LIMIT 1) last ON true
WHERE (NULLIF(trim(p."backflowDateChecked"),'') IS NOT NULL OR NULLIF(trim(p."backflowReminderMonths"),'') IS NOT NULL OR NULLIF(trim(p."backflowCompany"),'') IS NOT NULL OR NULLIF(trim(p."backflowAmount"),'') IS NOT NULL OR last.id IS NOT NULL)
AND (last.id IS NULL OR ROW(last."serviceDate",last."intervalText",last."companyName",last.cost,last."tankSize",last.gallons,last."additionalDate") IS DISTINCT FROM ROW(COALESCE(NULLIF(trim(p."backflowDateChecked"),''),''),NULLIF(trim(p."backflowReminderMonths"),''),NULLIF(trim(p."backflowCompany"),''),NULLIF(trim(p."backflowAmount"),''),NULL::TEXT,NULL::TEXT,NULL::TEXT));

-- BOILER: import reliable full-value audit snapshots only for changes in this section.
INSERT INTO "ComplianceServiceEntry" ("id","reminderLocationId","sourceAnnualEntryId","sourceAuditLogId","recordedByUserId","companyId","companyName","serviceDate","recordYear","intervalMonths","intervalOverrideMonths","intervalText","cost","tankSize","gallons","additionalDate","source","recordedAt")
SELECT 'history-audit-' || md5(a.id || ':' || s.id), r.id, p.id, a.id, a."actorUserId",
 CASE WHEN EXISTS (SELECT 1 FROM "ReminderCompany" company WHERE company.id=a.metadata->'companyReferences'->'after'->>'boilerInspectionCompanyId') THEN a.metadata->'companyReferences'->'after'->>'boilerInspectionCompanyId' ELSE NULL END,
 NULLIF(trim(a.metadata->'values'->>'boilerInspectionCompany'),''), COALESCE(NULLIF(trim(a.metadata->'values'->>'boilerInspectionDatePrimary'),''),''), p.year, COALESCE(CASE WHEN NULLIF(trim(a.metadata->'values'->>'boilerInspectionReminderMonths'),'') ~ '^[0-9]{1,3}$' THEN CASE WHEN (NULLIF(trim(a.metadata->'values'->>'boilerInspectionReminderMonths'),''))::INTEGER BETWEEN 1 AND 120 THEN (NULLIF(trim(a.metadata->'values'->>'boilerInspectionReminderMonths'),''))::INTEGER ELSE NULL END ELSE NULL END,s."defaultIntervalMonths"), CASE WHEN NULLIF(trim(a.metadata->'values'->>'boilerInspectionReminderMonths'),'') ~ '^[0-9]{1,3}$' THEN CASE WHEN (NULLIF(trim(a.metadata->'values'->>'boilerInspectionReminderMonths'),''))::INTEGER BETWEEN 1 AND 120 THEN (NULLIF(trim(a.metadata->'values'->>'boilerInspectionReminderMonths'),''))::INTEGER ELSE NULL END ELSE NULL END, NULLIF(trim(a.metadata->'values'->>'boilerInspectionReminderMonths'),''), NULLIF(trim(a.metadata->'values'->>'boilerInspectionCost'),''), NULL::TEXT, NULL::TEXT, NULLIF(trim(a.metadata->'values'->>'boilerInspectionDateSecondary'),''), 'AUDIT', a."createdAt"
FROM "AuditLog" a JOIN "PreventativeMaintenanceEntry" p ON a."entityType"='PreventativeMaintenanceEntry' AND a."entityId"=p.id
JOIN "NotificationReminderList" s ON s."complianceKind"='BOILER'
JOIN "NotificationReminderLocation" r ON r."listId"=s.id AND r."locationId"=p."locationId"
WHERE a.module='PREVENTATIVE_MAINTENANCE' AND a.action IN ('CREATE_ENTRY','UPDATE_ENTRY')
 AND jsonb_typeof(a.metadata->'values')='object'
 AND (a.metadata->'changes' ?| ARRAY['boilerInspectionDatePrimary','boilerInspectionReminderMonths','boilerInspectionCompany','boilerInspectionCost','boilerInspectionDateSecondary'] OR (a.action='CREATE_ENTRY' AND (NULLIF(trim(a.metadata->'values'->>'boilerInspectionDatePrimary'),'') IS NOT NULL OR NULLIF(trim(a.metadata->'values'->>'boilerInspectionReminderMonths'),'') IS NOT NULL OR NULLIF(trim(a.metadata->'values'->>'boilerInspectionCompany'),'') IS NOT NULL OR NULLIF(trim(a.metadata->'values'->>'boilerInspectionCost'),'') IS NOT NULL OR NULLIF(trim(a.metadata->'values'->>'boilerInspectionDateSecondary'),'') IS NOT NULL)))
ON CONFLICT DO NOTHING;

-- Preserve the current facts if no matching latest audited section snapshot exists.
INSERT INTO "ComplianceServiceEntry" ("id","reminderLocationId","sourceAnnualEntryId","recordedByUserId","companyId","companyName","serviceDate","recordYear","intervalMonths","intervalOverrideMonths","intervalText","cost","tankSize","gallons","additionalDate","source","recordedAt")
SELECT 'history-baseline-' || md5(p.id || ':' || s.id), r.id, p.id, p."updatedByUserId", p."boilerInspectionCompanyId", NULLIF(trim(p."boilerInspectionCompany"),''), COALESCE(NULLIF(trim(p."boilerInspectionDatePrimary"),''),''), p.year,
 COALESCE(CASE WHEN NULLIF(trim(p."boilerInspectionReminderMonths"),'') ~ '^[0-9]{1,3}$' THEN CASE WHEN (NULLIF(trim(p."boilerInspectionReminderMonths"),''))::INTEGER BETWEEN 1 AND 120 THEN (NULLIF(trim(p."boilerInspectionReminderMonths"),''))::INTEGER ELSE NULL END ELSE NULL END,s."defaultIntervalMonths"), CASE WHEN NULLIF(trim(p."boilerInspectionReminderMonths"),'') ~ '^[0-9]{1,3}$' THEN CASE WHEN (NULLIF(trim(p."boilerInspectionReminderMonths"),''))::INTEGER BETWEEN 1 AND 120 THEN (NULLIF(trim(p."boilerInspectionReminderMonths"),''))::INTEGER ELSE NULL END ELSE NULL END, NULLIF(trim(p."boilerInspectionReminderMonths"),''), NULLIF(trim(p."boilerInspectionCost"),''), NULL::TEXT, NULL::TEXT, NULLIF(trim(p."boilerInspectionDateSecondary"),''), 'BASELINE', p."updatedAt"
FROM "PreventativeMaintenanceEntry" p JOIN "NotificationReminderList" s ON s."complianceKind"='BOILER'
JOIN "NotificationReminderLocation" r ON r."listId"=s.id AND r."locationId"=p."locationId"
LEFT JOIN LATERAL (SELECT h.* FROM "ComplianceServiceEntry" h WHERE h."reminderLocationId"=r.id AND h."sourceAnnualEntryId"=p.id ORDER BY h."recordedAt" DESC,h.id DESC LIMIT 1) last ON true
WHERE (NULLIF(trim(p."boilerInspectionDatePrimary"),'') IS NOT NULL OR NULLIF(trim(p."boilerInspectionReminderMonths"),'') IS NOT NULL OR NULLIF(trim(p."boilerInspectionCompany"),'') IS NOT NULL OR NULLIF(trim(p."boilerInspectionCost"),'') IS NOT NULL OR NULLIF(trim(p."boilerInspectionDateSecondary"),'') IS NOT NULL OR last.id IS NOT NULL)
AND (last.id IS NULL OR ROW(last."serviceDate",last."intervalText",last."companyName",last.cost,last."tankSize",last.gallons,last."additionalDate") IS DISTINCT FROM ROW(COALESCE(NULLIF(trim(p."boilerInspectionDatePrimary"),''),''),NULLIF(trim(p."boilerInspectionReminderMonths"),''),NULLIF(trim(p."boilerInspectionCompany"),''),NULLIF(trim(p."boilerInspectionCost"),''),NULL::TEXT,NULL::TEXT,NULLIF(trim(p."boilerInspectionDateSecondary"),'')));

-- Revisions to the same annual section form a stable relational correction chain.
WITH chain AS (SELECT id, lag(id) OVER (PARTITION BY "reminderLocationId","sourceAnnualEntryId" ORDER BY "recordedAt", CASE WHEN source='BASELINE' THEN 1 ELSE 0 END,id) AS previous FROM "ComplianceServiceEntry" WHERE "sourceAnnualEntryId" IS NOT NULL)
UPDATE "ComplianceServiceEntry" h SET "supersedesEntryId"=chain.previous FROM chain WHERE h.id=chain.id AND chain.previous IS NOT NULL;

-- Recover reliable custom service revisions using their stable reminder-location identity.
INSERT INTO "ComplianceServiceEntry" ("id","reminderLocationId","sourceAuditLogId","recordedByUserId","companyId","companyName","serviceDate","recordYear","intervalMonths","intervalOverrideMonths","intervalText","source","recordedAt")
SELECT 'history-custom-audit-' || md5(a.id),r.id,a.id,a."actorUserId",c.id,c.name,
 COALESCE(a.metadata->'after'->>'referenceOn',''),
 CASE WHEN a.metadata->'after'->>'referenceOn' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN substring(a.metadata->'after'->>'referenceOn' FROM 1 FOR 4)::INTEGER ELSE extract(year FROM a."createdAt")::INTEGER END,
 COALESCE(months.override,defaults.months,s."defaultIntervalMonths"),months.override,NULLIF(a.metadata->'after'->>'intervalMonths',''),'AUDIT',a."createdAt"
FROM "AuditLog" a
JOIN "NotificationReminderLocation" r ON a."entityType"='NotificationReminderLocation' AND a."entityId"=r.id
JOIN "NotificationReminderList" s ON s.id=r."listId" AND s."complianceKind" IS NULL
LEFT JOIN "ReminderCompany" c ON c.id=a.metadata->'after'->>'companyId'
CROSS JOIN LATERAL (SELECT CASE WHEN a.metadata->'after'->>'intervalMonths' ~ '^[0-9]{1,3}$' THEN CASE WHEN (a.metadata->'after'->>'intervalMonths')::INTEGER BETWEEN 1 AND 120 THEN (a.metadata->'after'->>'intervalMonths')::INTEGER END END AS override) months
LEFT JOIN LATERAL (
 SELECT CASE WHEN history.metadata->'after'->>'defaultIntervalMonths' ~ '^[0-9]{1,3}$' THEN CASE WHEN (history.metadata->'after'->>'defaultIntervalMonths')::INTEGER BETWEEN 1 AND 120 THEN (history.metadata->'after'->>'defaultIntervalMonths')::INTEGER END END AS months
 FROM "AuditLog" history WHERE history.module='NOTIFICATION_REMINDERS' AND history."entityType"='NotificationReminderList' AND history."entityId"=s.id AND history.action IN ('CREATE_LIST','UPDATE_LIST') AND history."createdAt"<=a."createdAt" ORDER BY history."createdAt" DESC,history.id DESC LIMIT 1
) defaults ON true
WHERE a.module='NOTIFICATION_REMINDERS' AND a.action='SAVE_LOCATION' AND jsonb_typeof(a.metadata->'after')='object'
 AND (NULLIF(a.metadata->'after'->>'referenceOn','') IS NOT NULL OR NULLIF(a.metadata->'before'->>'referenceOn','') IS NOT NULL)
 AND (a.metadata->'before'->>'referenceOn' IS DISTINCT FROM a.metadata->'after'->>'referenceOn' OR a.metadata->'before'->>'intervalMonths' IS DISTINCT FROM a.metadata->'after'->>'intervalMonths' OR a.metadata->'before'->>'companyId' IS DISTINCT FROM a.metadata->'after'->>'companyId')
ON CONFLICT DO NOTHING;

-- Preserve current custom facts only when distinct from the most recent reliable revision.
INSERT INTO "ComplianceServiceEntry" ("id","reminderLocationId","recordedByUserId","companyId","companyName","serviceDate","recordYear","intervalMonths","intervalOverrideMonths","intervalText","source","recordedAt")
SELECT 'history-custom-' || md5(r.id),r.id,s."createdByUserId",r."companyId",c.name,COALESCE(to_char(r."referenceOn",'YYYY-MM-DD'),''),COALESCE(extract(year FROM r."referenceOn"),extract(year FROM r."updatedAt"))::INTEGER,COALESCE(r."intervalMonths",s."defaultIntervalMonths"),r."intervalMonths",r."intervalMonths"::TEXT,'BASELINE',r."updatedAt"
FROM "NotificationReminderLocation" r JOIN "NotificationReminderList" s ON s.id=r."listId" LEFT JOIN "ReminderCompany" c ON c.id=r."companyId"
LEFT JOIN LATERAL (SELECT h.* FROM "ComplianceServiceEntry" h WHERE h."reminderLocationId"=r.id ORDER BY h."recordedAt" DESC,h.id DESC LIMIT 1) last ON true
WHERE s."complianceKind" IS NULL AND (r."referenceOn" IS NOT NULL OR last.id IS NOT NULL)
 AND (last.id IS NULL OR ROW(last."serviceDate",last."intervalOverrideMonths",last."companyId") IS DISTINCT FROM ROW(COALESCE(to_char(r."referenceOn",'YYYY-MM-DD'),''),r."intervalMonths",r."companyId"));
WITH chain AS (
 SELECT h.id,lag(h.id) OVER (PARTITION BY h."reminderLocationId" ORDER BY h."recordedAt",CASE WHEN h.source='BASELINE' THEN 1 ELSE 0 END,h.id) AS previous
 FROM "ComplianceServiceEntry" h JOIN "NotificationReminderLocation" r ON r.id=h."reminderLocationId" JOIN "NotificationReminderList" s ON s.id=r."listId" WHERE s."complianceKind" IS NULL
)
UPDATE "ComplianceServiceEntry" h SET "supersedesEntryId"=chain.previous FROM chain WHERE h.id=chain.id AND chain.previous IS NOT NULL;
COMMIT;
