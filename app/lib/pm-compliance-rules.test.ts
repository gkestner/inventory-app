import assert from "node:assert/strict";
import { test } from "node:test";
import { latestPmServices, type PmComplianceEntry } from "./pm-compliance-rules";
import { formatReminderDate } from "./reminder-dates";

function row(overrides: Partial<PmComplianceEntry>): PmComplianceEntry {
  return {
    id: "entry", locationId: "location-1", year: 2026, location: { name: "Store 1" },
    greaseTrapDatePumped: null, greaseTrapReminderMonths: null, greaseTrapCompany: null,
    backflowDateChecked: null, backflowReminderMonths: null, backflowCompany: null,
    boilerInspectionDatePrimary: null, boilerInspectionReminderMonths: null, boilerInspectionCompany: null,
    ...overrides,
  };
}

test("latest service per location and type supersedes stale prior annual entries", () => {
  const services = latestPmServices([
    row({ id: "old", year: 2025, greaseTrapDatePumped: "2025-01-31", backflowDateChecked: "2025-03-01", backflowReminderMonths: "6" }),
    row({ id: "new", greaseTrapDatePumped: "2026-10-31", greaseTrapCompany: "Service Co" }),
    row({ id: "second", locationId: "location-2", greaseTrapDatePumped: "2025-05-01", greaseTrapReminderMonths: "12" }),
  ]);
  assert.equal(services.length, 3);
  const grease = services.find((service) => service.row.locationId === "location-1" && service.rule.key === "GREASE_TRAP")!;
  assert.equal(grease.row.id, "new");
  assert.equal(grease.intervalMonths, 11);
  assert.equal(formatReminderDate(grease.nextDueAt), "2027-09-30");
  assert.equal(grease.row[grease.rule.companyField], "Service Co");
  assert.equal(services.find((service) => service.rule.key === "BACKFLOW")?.intervalMonths, 6);
  assert.equal(services.find((service) => service.row.locationId === "location-2")?.intervalMonths, 12);
});

test("invalid explicit interval on most recent service does not revive stale reminders", () => {
  assert.equal(latestPmServices([
    row({ year: 2025, greaseTrapDatePumped: "2025-01-01", greaseTrapReminderMonths: "12" }),
    row({ greaseTrapDatePumped: "2026-01-01", greaseTrapReminderMonths: "invalid" }),
  ]).length, 0);
});
