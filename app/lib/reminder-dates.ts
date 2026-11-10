export const DEFAULT_REMINDER_MONTHS = 11;
const DAY_MS = 86_400_000;

/** A blank interval uses the default; an explicit invalid interval remains invalid. */
export function parseReminderMonths(raw: unknown, fallback = DEFAULT_REMINDER_MONTHS): number | null {
  const value = String(raw ?? "").trim();
  const months = value ? Number(value) : fallback;
  return Number.isInteger(months) && months >= 1 && months <= 120 ? months : null;
}

function calendarDate(year: number, month: number, day: number): Date | null {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return year >= 1000 && year <= 9999 && date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

/** Calendar dates have no server-local timezone or time of day. Legacy US dates are supported. */
export function parseReminderDate(raw: unknown): Date | null {
  if (raw instanceof Date) {
    if (!Number.isFinite(raw.getTime())) return null;
    return calendarDate(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());
  }
  const value = String(raw ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);
  if (iso) {
    if (value.includes("T") && !Number.isFinite(Date.parse(value))) return null;
    return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const legacy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  return legacy ? calendarDate(Number(legacy[3]), Number(legacy[1]), Number(legacy[2])) : null;
}

/** Clamp month-end (January 31 + one month = February 28/29) without rolling into March. */
export function addReminderMonths(base: Date, months: number): Date {
  if (!Number.isFinite(base.getTime()) || !Number.isInteger(months)) throw new Error("Invalid reminder date or interval.");
  const target = new Date(base);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const monthEnd = new Date(target);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
  target.setUTCDate(Math.min(base.getUTCDate(), monthEnd.getUTCDate()));
  target.setUTCHours(0, 0, 0, 0);
  return target;
}

export function formatReminderDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's New York calendar date, represented at UTC midnight for safe comparisons. */
export function reminderToday(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return calendarDate(value("year"), value("month"), value("day"))!;
}

/** Find the first future recurrence using the original reference date, preventing month-end drift. */
export function nextReminderAfter(reference: Date, months: number, after: Date): Date {
  if (!Number.isInteger(months) || months < 1 || !Number.isFinite(after.getTime())) {
    throw new Error("Invalid reminder recurrence.");
  }
  const elapsedMonths = (after.getUTCFullYear() - reference.getUTCFullYear()) * 12 +
    after.getUTCMonth() - reference.getUTCMonth();
  let occurrence = Math.max(1, Math.floor(elapsedMonths / months));
  let next = addReminderMonths(reference, occurrence * months);
  while (next <= after) next = addReminderMonths(reference, ++occurrence * months);
  return next;
}

export function reminderNextDue(dateRaw: unknown, monthsRaw: unknown, fallbackMonths = DEFAULT_REMINDER_MONTHS): Date | null {
  const date = parseReminderDate(dateRaw);
  const months = parseReminderMonths(monthsRaw, fallbackMonths);
  return date && months ? addReminderMonths(date, months) : null;
}

export function reminderDueSummary(dateRaw: unknown, monthsRaw: unknown, today = reminderToday(), fallbackMonths = DEFAULT_REMINDER_MONTHS): string {
  const due = reminderNextDue(dateRaw, monthsRaw, fallbackMonths);
  if (!due) return "-";
  const days = Math.round((due.getTime() - today.getTime()) / DAY_MS);
  return `${formatReminderDate(due)} (${days < 0 ? "Overdue" : days <= 30 ? "Due Soon" : "On Track"})`;
}
