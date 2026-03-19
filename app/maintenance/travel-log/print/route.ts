// app/maintenance/travel-log/print/route.ts
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { Permission } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

function requireSession(session: SessionShape) {
  if (!session) redirect("/login");
  const email = session.user?.email ?? null;
  if (!email) redirect("/login");
}

function escapeHtml(v: string): string {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isYYYYMMDD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseYMD(s: string | null): { y: number; m: number; d: number; raw: string } | null {
  if (!s) return null;
  const t = s.trim();
  if (!isYYYYMMDD(t)) return null;
  const [yy, mm, dd] = t.split("-").map((x) => Number(x));
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;
  return { y: yy, m: mm, d: dd, raw: t };
}

function getNYOffsetMinutes(atUtc: Date): number {
  // Produces "GMT-5" or "GMT-4" depending on DST at that instant.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = fmt.formatToParts(atUtc);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = tz.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!m) return 0;

  const sign = m[1] === "-" ? -1 : 1;
  const hh = Number(m[2] ?? 0);
  const mm = Number(m[3] ?? 0);
  return sign * (hh * 60 + mm);
}

function nyMidnightUtc(ymd: { y: number; m: number; d: number }): Date {
  // Determine NY midnight for that date (in UTC), respecting DST.
  // We sample at noon UTC to get the offset for that calendar day reliably.
  const sampleNoonUtc = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, 12, 0, 0));
  const offsetMin = getNYOffsetMinutes(sampleNoonUtc);
  const utcMillis = Date.UTC(ymd.y, ymd.m - 1, ymd.d, 0, 0, 0) - offsetMin * 60_000;
  return new Date(utcMillis);
}

function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function getNYTodayYMD(): { y: number; m: number; d: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const y = Number(parts.find((p) => p.type === "year")?.value ?? NaN);
  const m = Number(parts.find((p) => p.type === "month")?.value ?? NaN);
  const d = Number(parts.find((p) => p.type === "day")?.value ?? NaN);

  return { y, m, d };
}

function getNYDayOfWeekMon0(dUtc: Date): number {
  // 0 = Monday ... 6 = Sunday, based on NY local date.
  const dow = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(dUtc);

  // "Mon", "Tue", ...
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[dow] ?? 0;
}

function fmtLocalDateOnly(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York" }).format(d);
}

function fmtLocalTime(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

function hoursBetween(start: Date | null, end: Date | null): string {
  if (!start || !end) return "—";
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const hrs = ms / (1000 * 60 * 60);
  return (Math.round(hrs * 100) / 100).toFixed(2);
}

function hoursBetweenNumber(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms / (1000 * 60 * 60);
}

function safeLocationId(v: string | null): string {
  const s = (v ?? "").trim();
  if (!s) return "ALL";
  if (s.toUpperCase() === "ALL") return "ALL";
  // allow cuid / uuid-ish / slug-ish
  if (!/^[a-z0-9_-]{6,80}$/i.test(s)) return "ALL";
  return s;
}

function fmtFixed2(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return (Math.round(n * 100) / 100).toFixed(2);
}

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions)) as SessionShape;
  requireSession(session);

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.VIEW_WORK_ORDERS])) {
    return new Response("Forbidden", { status: 403 });
  }

  const email = (session?.user?.email ?? "").toLowerCase().trim();

  const me = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      active: true,
      location: { select: { id: true, name: true } },
      allowedLocations: {
        orderBy: { sortOrder: "asc" },
        select: { location: { select: { id: true, name: true } } },
      },
    },
  });

  if (!me || !me.active) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);

  const fromParam = parseYMD(url.searchParams.get("from"));
  const toParam = parseYMD(url.searchParams.get("to"));
  const locationId = safeLocationId(url.searchParams.get("locationId"));

  // Allowed locations (dedup, primary first)
  const allowed: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();

  if (me.location) {
    seen.add(me.location.id);
    allowed.push({ id: me.location.id, name: me.location.name });
  }
  for (const ul of me.allowedLocations) {
    const loc = ul.location;
    if (!loc) continue;
    if (seen.has(loc.id)) continue;
    seen.add(loc.id);
    allowed.push({ id: loc.id, name: loc.name });
  }

  // Enforce location filter is within allowed set (no leaking other locations)
  if (locationId !== "ALL" && !seen.has(locationId)) {
    return new Response("Forbidden", { status: 403 });
  }

  // Default: "This Week" Monday–Sunday (NY local), if query params absent.
  const todayYMD = getNYTodayYMD();
  const todayMidnightUtc = nyMidnightUtc(todayYMD);
  const dowMon0 = getNYDayOfWeekMon0(todayMidnightUtc); // 0..6

  const defaultFromUtc = addDaysUtc(todayMidnightUtc, -dowMon0); // Monday 00:00
  const defaultToUtc = addDaysUtc(defaultFromUtc, 6); // Sunday 00:00

  const fromUtc = fromParam ? nyMidnightUtc(fromParam) : defaultFromUtc;
  const toUtc = toParam ? nyMidnightUtc(toParam) : defaultToUtc;
  const toExclusiveUtc = addDaysUtc(toUtc, 1);

  const fromLabel = fromParam?.raw ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(fromUtc);
  const toLabel = toParam?.raw ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(toUtc);
  const rangeLabel = `${fromLabel} to ${toLabel}`;

  const selectedLocationName =
    locationId === "ALL" ? "All locations" : allowed.find((l) => l.id === locationId)?.name ?? "Selected location";

  const where: {
    createdByUserId: string;
    status: { in: ["SUBMITTED", "FINALIZED"] };
    startTime: { gte: Date; lt: Date };
    locationId?: string;
  } = {
    createdByUserId: me.id,
    status: { in: ["SUBMITTED", "FINALIZED"] },
    // Travel Log semantics are Departure/Arrival (Start/End) -> range should follow startTime
    startTime: { gte: fromUtc, lt: toExclusiveUtc },
  };
  if (locationId !== "ALL") where.locationId = locationId;

  const rows = await prisma.workOrder.findMany({
    where,
    orderBy: { startTime: "asc" },
    take: 500,
    select: {
      id: true,
      createdAt: true,
      location: { select: { name: true } },
      startTime: true,
      endTime: true,
      startingMileage: true,
      endingMileage: true,
      notes: true,
    },
  });

  // Totals (hours + miles)
  let totalHours = 0;
  let totalMiles = 0;
  let milesCounted = 0;

  for (const r of rows) {
    const h = hoursBetweenNumber(r.startTime, r.endTime);
    if (h !== null) totalHours += h;

    if (typeof r.startingMileage === "number" && typeof r.endingMileage === "number") {
      const delta = r.endingMileage - r.startingMileage;
      if (Number.isFinite(delta) && delta >= 0) {
        totalMiles += delta;
        milesCounted += 1;
      }
    }
  }

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Travel Log</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    @page { margin: 10mm; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #000; background: #fff; }
    .wrap { padding: 10px; max-width: 850px; margin: 0 auto; }
    .sheet { border: 1px solid rgba(0,0,0,0.55); }
    .title { background: #e9e9e9; border-bottom: 1px solid rgba(0,0,0,0.55); padding: 8px 10px; text-align: center; font-weight: 900; font-size: 22px; }
    .daterange { text-align: center; padding: 6px 10px; border-bottom: 1px solid rgba(0,0,0,0.35); font-size: 12px; font-weight: 900; }
    .meta { padding: 6px 10px; font-size: 12px; border-bottom: 1px solid rgba(0,0,0,0.25); }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th { text-align: center; padding: 6px; border: 1px solid rgba(0,0,0,0.75); font-size: 11px; font-weight: 900; background: #f2f2f2; white-space: nowrap; }
    td { padding: 6px; border: 1px solid rgba(0,0,0,0.45); font-size: 11px; vertical-align: top; white-space: nowrap; }
    td.wrap { white-space: normal; word-break: break-word; }
    tfoot td { font-weight: 900; }
    .foot { padding: 8px 10px; font-size: 11px; opacity: 0.85; }

    /* Portrait-friendly column widths */
    col.c1{width:10%}  /* Date */
    col.c2{width:16%}  /* Location */
    col.c3{width:11%}  /* Departure Time */
    col.c4{width:11%}  /* Departure Mi */
    col.c5{width:11%}  /* Arrival Time */
    col.c6{width:11%}  /* Arrival Mi */
    col.c7{width:8%}   /* Hours */
    col.c8{width:22%}  /* Notes */
  </style>
</head>
<body>
  <script>
    window.addEventListener("load", function () { try { window.print(); } catch (e) {} });
  </script>

  <div class="wrap">
    <div class="sheet">
      <div class="title">Travel Log</div>
      <div class="daterange">Date: ${escapeHtml(rangeLabel)}</div>
      <div class="meta"><b>Name:</b> ${escapeHtml(me.name)} &nbsp;&nbsp; <b>Location:</b> ${escapeHtml(
        selectedLocationName
      )}</div>

      <table>
        <colgroup>
          <col class="c1"><col class="c2"><col class="c3"><col class="c4">
          <col class="c5"><col class="c6"><col class="c7"><col class="c8">
        </colgroup>
        <thead>
          <tr>
            <th>Date</th>
            <th>Location</th>
            <th>Departure</th>
            <th>Departure Mi</th>
            <th>Arrival</th>
            <th>Arrival Mi</th>
            <th>Hours</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length === 0
              ? `<tr><td colspan="8" style="text-align:left;">No entries in this date range.</td></tr>`
              : rows
                  .map((wo) => {
                    // Semantics:
                    // Departure = startTime + startingMileage
                    // Arrival   = endTime + endingMileage
                    const date = wo.startTime ?? wo.createdAt;
                    const notes = wo.notes?.trim() ? wo.notes.trim() : "—";
                    const locName = wo.location?.name ?? "—";

                    const depTime = fmtLocalTime(wo.startTime);
                    const arrTime = fmtLocalTime(wo.endTime);

                    const depMi = wo.startingMileage ?? null;
                    const arrMi = wo.endingMileage ?? null;

                    return `<tr>
  <td>${escapeHtml(fmtLocalDateOnly(date))}</td>
  <td class="wrap">${escapeHtml(locName)}</td>
  <td>${escapeHtml(depTime)}</td>
  <td>${escapeHtml(depMi === null ? "—" : String(depMi))}</td>
  <td>${escapeHtml(arrTime)}</td>
  <td>${escapeHtml(arrMi === null ? "—" : String(arrMi))}</td>
  <td>${escapeHtml(hoursBetween(wo.startTime, wo.endTime))}</td>
  <td class="wrap">${escapeHtml(notes)}</td>
</tr>`;
                  })
                  .join("")
          }
        </tbody>
        ${
          rows.length > 0
            ? `<tfoot>
<tr>
  <td colspan="6">Totals</td>
  <td style="text-align:center;">${escapeHtml(fmtFixed2(totalHours))}</td>
  <td>Total Miles: ${escapeHtml(milesCounted > 0 ? String(totalMiles) : "—")}${
                milesCounted === 0 ? ` <span style="opacity:0.75;">(no mileage pairs)</span>` : ``
              }</td>
</tr>
</tfoot>`
            : ``
        }
      </table>

      <div class="foot">
        Derived from <b>PENDING</b> and <b>GENERATED</b> work orders. Departure = <b>Start</b>, Arrival = <b>End</b>. Totals count miles only when both mileages exist and the delta is &ge; 0.
      </div>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
