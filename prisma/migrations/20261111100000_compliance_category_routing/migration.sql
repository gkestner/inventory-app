BEGIN;

ALTER TABLE "NotificationReminderList"
  ADD COLUMN "includeCategoryRecipients" BOOLEAN NOT NULL DEFAULT false;

-- The dashboard and every insert path share the same numeric location rule.
-- Strip leading zeroes before comparing, so even long identifiers cannot overflow.
CREATE FUNCTION compliance_location_defaults_hidden(location_number TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN number !~ '^[0-9]+$' THEN false
    WHEN length(digits) > 2 THEN true
    WHEN length(digits) = 2 THEN digits::INTEGER >= 65
    ELSE false END
  FROM (SELECT regexp_replace(coalesce(location_number, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g') AS number) raw
  CROSS JOIN LATERAL (SELECT ltrim(number, '0') AS digits) normalized;
$$;

CREATE FUNCTION apply_compliance_location_default()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.hidden := NEW.hidden OR coalesce((
    SELECT compliance_location_defaults_hidden(l."locationNumber")
    FROM "Location" l WHERE l.id = NEW."locationId"
  ), false);
  RETURN NEW;
END;
$$;

CREATE TRIGGER compliance_location_hidden_on_insert
  BEFORE INSERT ON "NotificationReminderLocation"
  FOR EACH ROW EXECUTE FUNCTION apply_compliance_location_default();

-- Apply the default once to existing rows. A manager's explicit resume remains
-- an override; later ordinary saves do not change visibility.
WITH paused AS (
  UPDATE "NotificationReminderLocation" r
  SET hidden = true, "updatedAt" = CURRENT_TIMESTAMP
  FROM "Location" l
  WHERE r."locationId" = l.id AND NOT r.hidden
    AND compliance_location_defaults_hidden(l."locationNumber")
    AND NOT EXISTS (
      SELECT 1 FROM "AuditLog" a WHERE a.module = 'NOTIFICATION_REMINDERS'
        AND a."entityType" = 'NotificationReminderLocation' AND a."entityId" = r.id
        AND a.action = 'SHOW_LOCATION'
    )
  RETURNING r.id, r."listId", r."locationId", l."locationNumber"
), audited AS (
  INSERT INTO "AuditLog" (id, module, action, "entityType", "entityId", metadata)
  SELECT 'compliance-default-pause-v17-' || md5(p.id), 'NOTIFICATION_REMINDERS',
    'DEFAULT_HIDE_LOCATION_NUMBER', 'NotificationReminderLocation', p.id,
    jsonb_build_object('listId', p."listId", 'locationId', p."locationId", 'locationNumber', p."locationNumber",
      'before', jsonb_build_object('hidden', false), 'after', jsonb_build_object('hidden', true))
  FROM paused p
  RETURNING "entityId"
)
UPDATE "NotificationEmailDelivery" d
SET status = 'SKIPPED', "claimToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL, "updatedAt" = CURRENT_TIMESTAMP
FROM "Notification" n
LEFT JOIN "NotificationReminderOccurrence" o ON o.id = n."reminderOccurrenceId"
WHERE d."notificationId" = n.id AND d.kind = 'PRIMARY' AND d.status = 'PENDING'
  AND EXISTS (SELECT 1 FROM audited a WHERE a."entityId" IN (n."complianceReminderLocationId", o."reminderLocationId"));

COMMIT;
