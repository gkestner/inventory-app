// Report dates are calendar days in the stores' Eastern time zone. Use an
// exclusive next-day boundary so records in the last millisecond are included.
const REPORT_TIME_ZONE = "America/New_York";

function easternMidnight(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  const midnightUtc = new Date(Date.UTC(year, month - 1, day));
  if (midnightUtc.getUTCFullYear() !== year || midnightUtc.getUTCMonth() + 1 !== month || midnightUtc.getUTCDate() !== day) return null;

  // At UTC midnight, New York is still on the previous evening. Its offset is
  // the offset that applies at the requested local midnight, including DST days.
  const offsetName = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TIME_ZONE,
    timeZoneName: "shortOffset",
  }).formatToParts(midnightUtc).find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetName);
  if (!match) throw new Error("Unable to resolve report time zone offset.");
  const minutes = (Number(match[2]) * 60 + Number(match[3] ?? 0)) * (match[1] === "+" ? 1 : -1);
  return new Date(midnightUtc.getTime() - minutes * 60_000);
}

export function reportDateRange(fromRaw: string, toRaw: string) {
  const from = fromRaw ? easternMidnight(fromRaw) : null;
  const toDay = toRaw ? easternMidnight(toRaw) : null;
  const nextDay = toDay ? new Date(`${toRaw}T00:00:00Z`) : null;
  nextDay?.setUTCDate(nextDay.getUTCDate() + 1);
  const toExclusive = nextDay ? easternMidnight(nextDay.toISOString().slice(0, 10)) : null;
  return {
    from,
    toExclusive,
    error: Boolean((fromRaw && !from) || (toRaw && !toDay) || (from && toDay && from > toDay)),
  };
}
