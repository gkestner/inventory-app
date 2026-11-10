import assert from "node:assert/strict";
import { test } from "node:test";
import { submittedComplianceValues } from "./compliance-fields";
import { mergePreventativeMaintenanceValues } from "./preventative-maintenance";
import { reminderRecipientIds } from "./reminder-recipients";
import { latestPmServices, type PmComplianceEntry } from "./pm-compliance-rules";

test("partial compliance save preserves other sections, tank gallons and legacy secondary boiler date", () => {
  const before = { ...mergePreventativeMaintenanceValues(null, {}), greaseTrapGallons: "300", backflowCompany: "Original company", boilerInspectionDateSecondary: "2025-09-17", ovenCleaning: "Done" };
  const form = new FormData(); form.set("greaseTrapDatePumped", "2026-11-09"); form.set("backflowCompany", "Unrelated malicious field");
  const parsed = submittedComplianceValues(form, "GREASE_TRAP");
  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.values, { greaseTrapDatePumped: "2026-11-09" });
  const after = mergePreventativeMaintenanceValues(before, parsed.values);
  assert.equal(after.greaseTrapGallons, "300");
  assert.equal(after.backflowCompany, "Original company");
  assert.equal(after.boilerInspectionDateSecondary, "2025-09-17");
  assert.equal(after.ovenCleaning, "Done");
});

test("explicit submitted blank clears only that field; invalid dates/intervals rejected", () => {
  const form = new FormData(); form.set("boilerInspectionDateSecondary", "");
  assert.deepEqual(submittedComplianceValues(form, "BOILER").values, { boilerInspectionDateSecondary: "" });
  form.set("boilerInspectionReminderMonths", "1.5");
  assert.match(submittedComplianceValues(form, "BOILER").error!, /whole numbers/);
  form.delete("boilerInspectionReminderMonths"); form.set("boilerInspectionDatePrimary", "2026-02-30");
  assert.match(submittedComplianceValues(form, "BOILER").error!, /valid service date/);
});

test("recipient routing supports many section recipients, location replacement and builtin fallback", () => {
  assert.deepEqual(reminderRecipientIds({ sectionIds: ["a", "b", "a"], fallbackIds: ["primary"] }), ["a", "b"]);
  assert.deepEqual(reminderRecipientIds({ sectionIds: ["a"], useLocationRecipients: true, locationIds: ["c", "d"] }), ["c", "d"]);
  assert.deepEqual(reminderRecipientIds({ sectionIds: [], fallbackIds: ["primary1", "primary2"] }), ["primary1", "primary2"]);
  assert.deepEqual(reminderRecipientIds({ sectionIds: ["a"], useLocationRecipients: true, locationIds: [] }), []);
});

test("builtin blank intervals inherit editable section default while explicit annual override survives", () => {
  const base: PmComplianceEntry = {
    id: "entry", locationId: "store", location: { name: "Store" }, year: 2026,
    greaseTrapDatePumped: "2026-01-01", greaseTrapReminderMonths: "", greaseTrapCompany: null,
    backflowDateChecked: "2026-01-01", backflowReminderMonths: "12", backflowCompany: null,
    boilerInspectionDatePrimary: null, boilerInspectionReminderMonths: null, boilerInspectionCompany: null,
  };
  const rows = latestPmServices([base], { GREASE_TRAP: 6, BACKFLOW: 8 });
  assert.equal(rows.find((row) => row.rule.key === "GREASE_TRAP")?.intervalMonths, 6);
  assert.equal(rows.find((row) => row.rule.key === "BACKFLOW")?.intervalMonths, 12);
});
