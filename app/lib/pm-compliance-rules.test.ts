import assert from "node:assert/strict";
import { test } from "node:test";
import { latestComplianceRecords } from "./compliance-history-fields";
import { formatReminderDate, reminderSchedule } from "./reminder-dates";

function row(id: string, reminderLocationId: string, serviceDate: string, intervalText: string | null = null) {
  return { id, reminderLocationId, serviceDate, intervalText, recordedAt: new Date("2026-11-11T12:00:00Z") };
}

test("latest service per location and type supersedes stale prior annual entries", () => {
  const services = latestComplianceRecords([
    row("old", "first-grease", "1/31/2025"),
    row("backflow", "first-backflow", "2025-03-01", "6"),
    row("new", "first-grease", "2026-10-31"),
    row("second", "second-grease", "2025-05-01", "12"),
  ]);
  assert.equal(services.length, 3);
  const grease = services.find(({ reminderLocationId }) => reminderLocationId === "first-grease")!;
  assert.equal(grease.id, "new");
  assert.equal(formatReminderDate(reminderSchedule(grease.serviceDate, grease.intervalText)!.nextDueOn), "2027-09-30");
  assert.equal(services.find(({ id }) => id === "backflow")?.intervalText, "6");
  assert.equal(services.find(({ id }) => id === "second")?.intervalText, "12");
});

test("invalid explicit interval on most recent service does not revive stale reminders", () => {
  const [latest] = latestComplianceRecords([row("old", "grease", "2025-01-01", "12"), row("new", "grease", "2026-01-01", "invalid")]);
  assert.equal(reminderSchedule(latest.serviceDate, latest.intervalText), null);
});
