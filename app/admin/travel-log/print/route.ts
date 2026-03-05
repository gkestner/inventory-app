import { getServerSession } from "next-auth";
import { Permission, Prisma, WorkOrderStatus } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

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
  const dow = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(dUtc);

  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[dow] ?? 0;
}

function fmtDate(d: Date | null): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York" }).format(d);
}

function fmtTime(d: Date | null): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

function hoursBetweenNumber(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms / (1000 * 60 * 60);
}

function fmtFixed2(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return (Math.round(n * 100) / 100).toFixed(2);
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) return false;
  const perms = await loadUserPermissions(session);
  return perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_WORK_ORDERS, Permission.ADMIN_EDIT_WORK_ORDERS]);
}

export async function GET(req: Request) {
  if (!(await requireAdmin())) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const fromParam = parseYMD(url.searchParams.get("from"));
  const toParam = parseYMD(url.searchParams.get("to"));

  const todayYMD = getNYTodayYMD();
  const todayMidnightUtc = nyMidnightUtc(todayYMD);
  const dowMon0 = getNYDayOfWeekMon0(todayMidnightUtc);
  const defaultFromUtc = addDaysUtc(todayMidnightUtc, -dowMon0);
  const defaultToUtc = addDaysUtc(defaultFromUtc, 6);

  const fromUtc = fromParam ? nyMidnightUtc(fromParam) : defaultFromUtc;
  const toUtc = toParam ? nyMidnightUtc(toParam) : defaultToUtc;
  const toExclusiveUtc = addDaysUtc(toUtc, 1);

  const fromLabel = fromParam?.raw ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(fromUtc);
  const toLabel = toParam?.raw ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(toUtc);

  const locationId = (url.searchParams.get("locationId") || "ALL").trim();
  const userId = (url.searchParams.get("userId") || "ALL").trim();
  const q = (url.searchParams.get("q") || "").trim();

  const where: Prisma.WorkOrderWhereInput = {
    status: WorkOrderStatus.SUBMITTED,
    startTime: { gte: fromUtc, lt: toExclusiveUtc },
    ...(locationId && locationId !== "ALL" ? { locationId } : {}),
    ...(userId && userId !== "ALL" ? { createdByUserId: userId } : {}),
    ...(q
      ? {
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { notes: { contains: q, mode: "insensitive" } },
            { location: { name: { contains: q, mode: "insensitive" } } },
            { createdByUser: { name: { contains: q, mode: "insensitive" } } },
            { createdByUser: { email: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const rows = await prisma.workOrder.findMany({
    where,
    orderBy: [{ createdByUserId: "asc" }, { startTime: "desc" }],
    select: {
      id: true,
      startTime: true,
      endTime: true,
      startingMileage: true,
      endingMileage: true,
      notes: true,
      location: { select: { name: true } },
      createdByUser: { select: { id: true, name: true, email: true } },
    },
  });

  const grouped = new Map<string, { name: string; email: string; rows: typeof rows; hours: number; miles: number }>();
  let grandHours = 0;
  let grandMiles = 0;

  for (const r of rows) {
    const key = r.createdByUser?.id ?? "unknown";
    const g =
      grouped.get(key) ??
      ({
        name: r.createdByUser?.name ?? "Unknown User",
        email: r.createdByUser?.email ?? "",
        rows: [] as typeof rows,
        hours: 0,
        miles: 0,
      } as const);

    (g.rows as typeof rows).push(r);

    const h = hoursBetweenNumber(r.startTime, r.endTime);
    if (h !== null) {
      (g as { hours: number }).hours += h;
      grandHours += h;
    }

    if (typeof r.startingMileage === "number" && typeof r.endingMileage === "number") {
      const delta = r.endingMileage - r.startingMileage;
      if (Number.isFinite(delta) && delta >= 0) {
        (g as { miles: number }).miles += delta;
        grandMiles += delta;
      }
    }

    grouped.set(key, g as { name: string; email: string; rows: typeof rows; hours: number; miles: number });
  }

  const groups = Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name));

  const sectionsHtml =
    groups.length === 0
      ? '<div class="card"><div class="empty">No entries in this filter range.</div></div>'
      : groups
          .map((g) => {
            const rowsHtml = g.rows
              .map((r) => {
                const miles =
                  typeof r.startingMileage === "number" && typeof r.endingMileage === "number"
                    ? Math.max(0, r.endingMileage - r.startingMileage)
                    : null;
                const hrs = hoursBetweenNumber(r.startTime, r.endTime);
                return `<tr>
<td>${escapeHtml(fmtDate(r.startTime))}</td>
<td>${escapeHtml(r.location?.name ?? "-")}</td>
<td>${escapeHtml(fmtTime(r.startTime))}</td>
<td>${escapeHtml(fmtTime(r.endTime))}</td>
<td>${escapeHtml(hrs === null ? "-" : fmtFixed2(hrs))}</td>
<td>${escapeHtml(r.startingMileage === null ? "-" : String(r.startingMileage))}</td>
<td>${escapeHtml(r.endingMileage === null ? "-" : String(r.endingMileage))}</td>
<td>${escapeHtml(miles === null ? "-" : String(miles))}</td>
<td class="wrap">${escapeHtml((r.notes ?? "").trim() || "-")}</td>
</tr>`;
              })
              .join("");

            return `<section class="card keep">
<div class="section-head">
  <div>
    <div class="name">${escapeHtml(g.name)}</div>
    <div class="email">${escapeHtml(g.email)}</div>
  </div>
  <div class="totals">Entries: <b>${g.rows.length}</b> | Hours: <b>${escapeHtml(fmtFixed2(g.hours))}</b> | Miles: <b>${escapeHtml(
              fmtFixed2(g.miles)
            )}</b></div>
</div>
<table>
  <thead><tr><th>Date</th><th>Location</th><th>Departure</th><th>Return</th><th>Hours</th><th>Start Mi</th><th>End Mi</th><th>Miles</th><th>Notes</th></tr></thead>
  <tbody>${rowsHtml}</tbody>
</table>
</section>`;
          })
          .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Travel Log</title>
  <style>
    @page { margin: 10mm; }
    body { margin: 0; font-family: Segoe UI, Arial, sans-serif; color: #000; background: #fff; }
    .wrap { max-width: 1080px; margin: 0 auto; padding: 10px; }
    .top { border: 1px solid #777; padding: 10px; margin-bottom: 10px; }
    .title { font-size: 22px; font-weight: 900; margin-bottom: 6px; }
    .meta { font-size: 12px; color: #222; }
    .card { border: 1px solid #999; padding: 10px; margin-bottom: 10px; }
    .keep { break-inside: avoid-page; page-break-inside: avoid; }
    .section-head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-end; margin-bottom: 6px; }
    .name { font-size: 17px; font-weight: 900; }
    .email { font-size: 12px; color: #333; }
    .totals { font-size: 12px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #bbb; padding: 5px; font-size: 11px; text-align: left; vertical-align: top; white-space: nowrap; }
    td.wrap { white-space: normal; word-break: break-word; }
    .empty { font-size: 13px; }
  </style>
</head>
<body>
  <script>window.addEventListener('load', function () { try { window.print(); } catch (e) {} });</script>
  <div class="wrap">
    <div class="top">
      <div class="title">Admin Travel Logs</div>
      <div class="meta">Range: <b>${escapeHtml(fromLabel)} to ${escapeHtml(toLabel)}</b></div>
      <div class="meta">Users: <b>${groups.length}</b> | Entries: <b>${rows.length}</b> | Total Hours: <b>${escapeHtml(
        fmtFixed2(grandHours)
      )}</b> | Total Miles: <b>${escapeHtml(fmtFixed2(grandMiles))}</b></div>
    </div>
    ${sectionsHtml}
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
