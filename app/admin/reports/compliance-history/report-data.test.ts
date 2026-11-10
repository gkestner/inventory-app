import assert from "node:assert/strict";
import test from "node:test";
import type { ComplianceHistoryRecord } from "@/app/lib/compliance-history-fields";
import { complianceHistoryQuery, complianceHistoryWorkbook, parseComplianceHistoryFilters } from "./report-data";

test("history defaults span all years and both location/section filters retain stable IDs", () => {
  assert.deepEqual(parseComplianceHistoryFilters(new URLSearchParams()), {
    locationId: undefined, sectionId: undefined, year: undefined, page: 1,
  });
  const filters = parseComplianceHistoryFilters(new URLSearchParams({ locationId: "loc-office", sectionId: "compliance-boiler", year: "2025", page: "3" }));
  assert.deepEqual(filters, { locationId: "loc-office", sectionId: "compliance-boiler", year: 2025, page: 3 });
  assert.equal(complianceHistoryQuery(filters, 4), "locationId=loc-office&sectionId=compliance-boiler&year=2025&page=4");
  assert.equal(complianceHistoryQuery(filters), "locationId=loc-office&sectionId=compliance-boiler&year=2025");
});

test("invalid years/pages cannot force an invalid query or restrict all-time history", () => {
  for (const raw of ["-1", "2025.5", "Infinity", "abc", "2101"]) {
    assert.equal(parseComplianceHistoryFilters(new URLSearchParams({ year: raw })).year, undefined);
  }
  for (const raw of ["0", "-1", "1.5", "Infinity", "9007199254740991"]) {
    assert.equal(parseComplianceHistoryFilters(new URLSearchParams({ page: raw })).page, 1);
  }
});

const record: ComplianceHistoryRecord = {
  id: "service-1", reminderLocationId: "row-1", sectionId: "compliance-boiler", sectionName: "Boiler", complianceKind: "BOILER",
  locationId: "loc-1", locationName: "Store One", locationNumber: "01", recordYear: 2026, serviceDate: "2026-11-10",
  intervalMonths: 11, intervalOverrideMonths: null, intervalText: null, companyName: "Company & Sons",
  cost: "$123.45", tankSize: null, gallons: null, additionalDate: "2026-11-11", notes: "First line\nSecond line",
  recordedAt: new Date("2026-11-10T18:00:00Z"), recordedByName: "Maintenance", source: "DASHBOARD",
};

test("all-location exports retain boiler cost/secondary date, grease gallons, notes, and record identity", () => {
  const grease = { ...record, id: "service-2", sectionName: "Grease Trap", complianceKind: "GREASE_TRAP" as const, tankSize: "1,000", gallons: "925 gallons / checked", additionalDate: null, intervalMonths: 6 };
  const workbook = complianceHistoryWorkbook([record, grease], { page: 9 }, { location: "All locations", section: "All sections" });
  assert.equal(workbook.rows.length, 2);
  assert.equal(workbook.rows[0].cost, "$123.45");
  assert.equal(workbook.rows[0].additionalDate, "2026-11-11");
  assert.equal(workbook.rows[0].notes, "First line\nSecond line");
  assert.equal(workbook.rows[0].id, "service-1");
  assert.equal(workbook.rows[1].tankSize, "1,000");
  assert.equal(workbook.rows[1].gallons, "925 gallons / checked");
  assert.equal(workbook.rows[1].interval, 6);
  for (const key of ["serviceDate", "interval", "cost", "tankSize", "gallons", "additionalDate", "notes", "recordedAt", "recordedByName", "id"]) {
    assert.ok(workbook.columns.some((column) => column.key === key), `Export is missing ${key}`);
  }
});

test("legacy reminder text is retained rather than replaced with a guessed number", () => {
  const workbook = complianceHistoryWorkbook([{ ...record, intervalText: "every spring" }], { page: 1 }, { location: "Store One", section: "Boiler" });
  assert.equal(workbook.rows[0].interval, "every spring");
});
