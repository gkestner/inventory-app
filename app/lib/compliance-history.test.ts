import assert from "node:assert/strict";
import test from "node:test";
import type { ComplianceServiceEntry, NotificationReminderList, NotificationReminderLocation, Prisma } from "@prisma/client";
import { complianceValuesFromAnnual, latestComplianceRecords, parsedComplianceSubmission, type ComplianceServiceValues } from "./compliance-history-fields";
import { appendAnnualComplianceHistory } from "./compliance-history";
import { recordComplianceServiceEntry } from "./compliance-history-writer";
import { mergePreventativeMaintenanceValues, savePreventativeMaintenanceEntryWithAudit } from "./preventative-maintenance";
import { latestPmServices } from "./pm-compliance-rules";

const now = new Date("2026-11-10T20:00:00Z");
const section = (kind: NotificationReminderList["complianceKind"] = "GREASE_TRAP") => ({id: kind ?? "custom", name: kind ?? "Custom", complianceKind: kind, defaultIntervalMonths: 11, active: true} as NotificationReminderList);
const routing = (list = section()) => ({id: `row-${list.id}`, listId: list.id, locationId: "loc", intervalMonths: null, referenceOn: null, nextDueOn: null, companyId: null, hidden: false, useLocationRecipients: false} as NotificationReminderLocation);
const values = (serviceDate = "2026-10-01"): ComplianceServiceValues => ({serviceDate, intervalMonths: 11, intervalOverrideMonths: null, intervalText: null, companyName: "Service Co", cost: "125.00", tankSize: "1000", gallons: "900", additionalDate: null, notes: "Pumped and inspected"});
const baseArgs = (list = section()) => ({section: list, routing: routing(list), actorUserId: "actor", year: 2026, submissionToken: "first-submission-token", values: values()});

function fixture(list = section()) {
  const entries: ComplianceServiceEntry[] = [];
  const annual = {id: "annual", locationId: "loc", year: 2026, ...mergePreventativeMaintenanceValues(null, {}), greaseTrapCompanyId: null, backflowCompanyId: null, boilerInspectionCompanyId: null};
  const row = routing(list);
  const audits: Record<string, unknown>[] = [];
  let annualWrites = 0;
  const active = () => entries.filter(entry => !entries.some(next => next.supersedesEntryId === entry.id));
  const tx = {
    $queryRaw: async () => [], $queryRawUnsafe: async () => [],
    location: {findUnique: async () => ({id: "loc", name: "Downtown"})},
    reminderCompany: {upsert: async () => ({id: "company", name: "Service Co"})},
    notificationReminderList: {findMany: async () => [list]},
    notificationReminderLocation: {
      upsert: async () => ({...row}),
      update: async ({data}: {data: Partial<NotificationReminderLocation>}) => Object.assign(row, data),
    },
    preventativeMaintenanceEntry: {
      findUnique: async () => ({...annual}),
      upsert: async ({update}: {update: Partial<typeof annual>}) => {annualWrites++; Object.assign(annual, update); return {...annual};},
    },
    auditLog: {create: async ({data}: {data: Record<string, unknown>}) => {const saved = {...data, id: `audit-${audits.length+1}`}; audits.push(saved); return saved;}},
    complianceServiceEntry: {
      findUnique: async ({where}: {where: {submissionToken: string}}) => entries.find(entry => entry.submissionToken === where.submissionToken) ?? null,
      findFirst: async ({where}: {where: {reminderLocationId: string; sourceAnnualEntryId: string}}) => active().filter(entry => entry.reminderLocationId === where.reminderLocationId && entry.sourceAnnualEntryId === where.sourceAnnualEntryId).sort((a,b) => b.recordedAt.getTime() - a.recordedAt.getTime())[0] ?? null,
      findMany: async ({where}: {where: {reminderLocationId: string}}) => active().filter(entry => entry.reminderLocationId === where.reminderLocationId),
      create: async ({data}: {data: Partial<ComplianceServiceEntry>}) => {
        const saved = {id: `entry-${entries.length+1}`, recordedAt: new Date(now.getTime()+entries.length*1000), sourceAnnualEntryId: null, sourceAuditLogId: null, supersedesEntryId: null, submissionToken: null, ...data} as ComplianceServiceEntry;
        entries.push(saved); return {...saved};
      },
    },
  };
  return {tx: tx as unknown as Prisma.TransactionClient, entries, annual, row, audits, annualWrites: () => annualWrites};
}

test("annual history preserves gallons, tank/cost, secondary boiler date and invalid interval text", () => {
  const grease = complianceValuesFromAnnual("GREASE_TRAP", {greaseTrapDatePumped: "1/2/2025", greaseTrapTankSize: "1000", greaseTrapGallons: "875 / cleaned", greaseTrapCost: "$90", greaseTrapCompany: "Legacy Co", greaseTrapReminderMonths: "bad"}, 11);
  assert.deepEqual({...grease, notes: undefined}, {serviceDate: "1/2/2025", intervalMonths: 11, intervalOverrideMonths: null, intervalText: "bad", companyName: "Legacy Co", cost: "$90", tankSize: "1000", gallons: "875 / cleaned", additionalDate: null, notes: undefined});
  assert.equal(complianceValuesFromAnnual("BOILER", {boilerInspectionDateSecondary: "12/1/2025", boilerInspectionCost: "320"}, 11).additionalDate, "12/1/2025");
  assert.equal(latestPmServices([{id: "legacy", locationId: "loc", year: 2025, location: {name: "Downtown"}, greaseTrapDatePumped: grease.serviceDate, greaseTrapReminderMonths: grease.intervalText, greaseTrapCompany: grease.companyName, backflowDateChecked: null, backflowReminderMonths: null, backflowCompany: null, boilerInspectionDatePrimary: null, boilerInspectionReminderMonths: null, boilerInspectionCompany: null}]).length, 0);
});

test("new entry validates calendar dates, integer intervals and bounded details", () => {
  const form = new FormData(); form.set("serviceDate", "2026-02-30");
  assert.match(parsedComplianceSubmission(form, 11).error!, /valid service date/);
  form.set("serviceDate", "2026-02-28"); form.set("intervalMonths", "2.5");
  assert.match(parsedComplianceSubmission(form, 11).error!, /whole numbers/);
  form.set("intervalMonths", ""); form.set("companyName", "  Service   Co ");
  assert.equal(parsedComplianceSubmission(form, 11).values?.intervalMonths, 11);
  assert.equal(parsedComplianceSubmission(form, 11).values?.intervalOverrideMonths, null);
  assert.equal(parsedComplianceSubmission(form, 11).values?.companyName, "Service Co");
  form.set("notes", "x".repeat(2001)); assert.match(parsedComplianceSubmission(form, 11).error!, /2000/);
});

test("latest service uses actual service date, deterministic ties and excludes corrected snapshots", () => {
  const r = (id: string, serviceDate: string, recordedAt = now, supersedesEntryId?: string) => ({id, reminderLocationId: "row", serviceDate, recordedAt, supersedesEntryId});
  assert.equal(latestComplianceRecords([r("recent", "2026-09-01"), r("backdated", "2025-01-01", new Date("2026-12-01"))])[0].id, "recent");
  assert.equal(latestComplianceRecords([r("old-wrong", "2027-01-01"), r("correction", "2026-09-01", now, "old-wrong")])[0].id, "correction");
  assert.equal(latestComplianceRecords([r("a", "not a date"), r("b", "not a date")])[0].id, "b");
});

test("multiple services in one year append independent records and keep an annual projection", async () => {
  const f = fixture(); const args = baseArgs();
  await recordComplianceServiceEntry(f.tx, args);
  await recordComplianceServiceEntry(f.tx, {...args, submissionToken: "second-submission-token", values: values("2026-11-05")});
  assert.equal(f.entries.length, 2); assert.equal(f.entries[0].serviceDate, "2026-10-01");
  assert.equal(f.entries[1].serviceDate, "2026-11-05"); assert.equal(f.annual.greaseTrapDatePumped, "2026-11-05");
  assert.equal(f.annual.greaseTrapGallons, "900"); assert.equal(f.annual.greaseTrapCost, "125.00");
  assert.equal(f.row.nextDueOn?.toISOString().slice(0,10), "2027-10-05");
  assert.equal(f.entries[0].sourceAnnualEntryId, f.entries[1].sourceAnnualEntryId);
});

test("backdated entry preserves newer annual data and reminder anchor", async () => {
  const f = fixture(); const args = baseArgs();
  await recordComplianceServiceEntry(f.tx, args);
  const before = {...f.annual}; const due = f.row.nextDueOn?.toISOString(); const writes = f.annualWrites();
  const result = await recordComplianceServiceEntry(f.tx, {...args, submissionToken: "backdated-submission-token", values: {...values("2026-03-01"), cost: "50"}});
  assert.equal(result.anchorChanged, false); assert.equal(f.entries.length, 2);
  assert.deepEqual(f.annual, before); assert.equal(f.annualWrites(), writes); assert.equal(f.row.nextDueOn?.toISOString(), due);
  assert.equal(f.entries[1].sourceAnnualEntryId, null);
});

test("custom service history is durable and backdated additions preserve its advanced schedule", async () => {
  const list = section(null); const f = fixture(list); const args = baseArgs(list);
  await recordComplianceServiceEntry(f.tx, args);
  f.row.nextDueOn = new Date("2028-08-01T00:00:00Z");
  await recordComplianceServiceEntry(f.tx, {...args, submissionToken: "older-custom-submission", values: values("2025-01-01")});
  assert.equal(f.entries.length, 2); assert.equal(f.annualWrites(), 0);
  assert.equal(f.row.referenceOn?.toISOString().slice(0,10), "2026-10-01");
  assert.equal(f.row.nextDueOn.toISOString().slice(0,10), "2028-08-01");
});

test("duplicate submission is idempotent and conflicting identity or payload is rejected", async () => {
  const f = fixture(); const args = baseArgs();
  await recordComplianceServiceEntry(f.tx, args);
  const writes = f.annualWrites(), auditCount = f.audits.length;
  const result = await recordComplianceServiceEntry(f.tx, args);
  assert.equal(result.created, false); assert.equal(f.entries.length, 1); assert.equal(f.annualWrites(), writes); assert.equal(f.audits.length, auditCount);
  await assert.rejects(recordComplianceServiceEntry(f.tx, {...args, actorUserId: "another"}), /different details/);
  await assert.rejects(recordComplianceServiceEntry(f.tx, {...args, values: {...args.values, cost: "999"}}), /different details/);
});

test("general PM edits do not create fake service entries; gallons edits retain complete prior facts", async () => {
  const f = fixture(); Object.assign(f.annual, {greaseTrapDatePumped: "2026-05-01", greaseTrapCompany: "Service Co", greaseTrapCost: "200", greaseTrapTankSize: "1000", greaseTrapGallons: "900"});
  await savePreventativeMaintenanceEntryWithAudit({locationId: "loc", year: 2026, values: {ovenCleaning: "done"}, actorUserId: "actor", source: "MAINTENANCE"}, {tx: f.tx});
  assert.equal(f.entries.length, 0);
  await savePreventativeMaintenanceEntryWithAudit({locationId: "loc", year: 2026, values: {greaseTrapGallons: "850"}, actorUserId: "actor", source: "MAINTENANCE"}, {tx: f.tx});
  assert.equal(f.entries.length, 1); assert.equal(f.entries[0].gallons, "850");
  assert.equal(f.entries[0].cost, "200"); assert.equal(f.entries[0].tankSize, "1000");
  assert.equal(f.entries[0].source, "ANNUAL_EDIT"); assert.equal(f.entries[0].sourceAuditLogId, "audit-2");
  assert.equal(f.annual.ovenCleaning, "done");
});

test("unchanged/routing-only snapshots do not append services; corrections keep stable links", async () => {
  const f = fixture(); const args = {saved: {...f.annual}, locationId: "loc", year: 2026, actorUserId: "actor", changedFields: [] as string[], sourceAuditLogId: "audit-source"};
  await appendAnnualComplianceHistory(f.tx, args); assert.equal(f.entries.length, 0);
  args.saved.greaseTrapDatePumped = "2026-08-01"; args.changedFields = ["greaseTrapDatePumped"];
  await appendAnnualComplianceHistory(f.tx, args);
  args.saved.greaseTrapDatePumped = "2026-07-01";
  await appendAnnualComplianceHistory(f.tx, {...args, sourceAuditLogId: "audit-correction"});
  assert.equal(f.entries.length, 2); assert.equal(f.entries[1].supersedesEntryId, f.entries[0].id);
  assert.equal(latestComplianceRecords(f.entries)[0].serviceDate, "2026-07-01");
  assert.equal(f.entries[1].sourceAnnualEntryId, "annual");
});

test("PM checklist correction preserves notes that its annual form cannot edit", async () => {
  const f = fixture();
  await recordComplianceServiceEntry(f.tx, baseArgs());
  await savePreventativeMaintenanceEntryWithAudit({locationId: "loc", year: 2026, values: {greaseTrapGallons: "825"}, actorUserId: "actor", source: "MAINTENANCE"}, {tx: f.tx});
  assert.equal(f.entries.length, 2);
  const latest = latestComplianceRecords(f.entries)[0];
  assert.equal(latest.gallons, "825");
  assert.equal(latest.notes, "Pumped and inspected");
  assert.equal(latest.cost, "125.00");
  assert.equal(f.entries[0].notes, "Pumped and inspected");
});
