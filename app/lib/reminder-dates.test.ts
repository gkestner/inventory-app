import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addReminderMonths, DEFAULT_REMINDER_MONTHS, formatReminderDate, nextReminderAfter,
  parseReminderDate, parseReminderMonths, reminderDueSummary, reminderNextDue, reminderToday,
} from "./reminder-dates";

const date = (value: string) => parseReminderDate(value)!;

test("blank reminder intervals default to 11 months while valid overrides survive", () => {
  assert.equal(DEFAULT_REMINDER_MONTHS, 11);
  for (const raw of [null, undefined, "", "   "]) assert.equal(parseReminderMonths(raw), 11);
  for (const months of [1, 6, 12, 120]) assert.equal(parseReminderMonths(String(months)), months);
  for (const raw of ["0", "-1", "121", "1.5", "no"]) assert.equal(parseReminderMonths(raw), null);
  assert.equal(parseReminderMonths("", 6), 6);
});

test("calendar parsing validates impossible dates and supports legacy US input", () => {
  assert.equal(formatReminderDate(date("2/29/2024")), "2024-02-29");
  assert.equal(formatReminderDate(date("2026-11-09T23:30:00-05:00")), "2026-11-09");
  for (const raw of ["2025-02-29", "2026-02-30", "13/1/2026", "", "invalid", "2026-00-01"]) {
    assert.equal(parseReminderDate(raw), null);
  }
});

test("month arithmetic clamps calendar month ends and preserves leap years", () => {
  assert.equal(formatReminderDate(addReminderMonths(date("2026-01-31"), 1)), "2026-02-28");
  assert.equal(formatReminderDate(addReminderMonths(date("2023-03-31"), 11)), "2024-02-29");
  assert.equal(formatReminderDate(reminderNextDue("2026-01-31", "")!), "2026-12-31");
  assert.equal(reminderNextDue("2026-01-31", "invalid"), null);
});

test("recurrence stays anchored to original date after month-end clamp", () => {
  assert.equal(formatReminderDate(nextReminderAfter(date("2026-01-31"), 1, date("2026-02-28"))), "2026-03-31");
  assert.equal(formatReminderDate(nextReminderAfter(date("2024-02-29"), 12, date("2027-02-28"))), "2028-02-29");
  assert.equal(formatReminderDate(nextReminderAfter(date("2020-01-31"), 11, date("2026-11-09"))), "2027-05-31");
});

test("today follows New York across midnight and daylight saving transitions", () => {
  assert.equal(formatReminderDate(reminderToday(new Date("2026-11-09T02:00:00Z"))), "2026-11-08");
  assert.equal(formatReminderDate(reminderToday(new Date("2026-03-09T03:30:00Z"))), "2026-03-08");
  assert.equal(reminderDueSummary("2026-01-09", "", date("2026-11-09")), "2026-12-09 (Due Soon)");
  assert.equal(reminderDueSummary("2025-01-09", "", date("2026-11-09")), "2025-12-09 (Overdue)");
});
