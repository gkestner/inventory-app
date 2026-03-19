import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Permission, Prisma, WorkOrderStatus } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

function csvEscape(v: string): string {
  const needs = /[",\n\r]/.test(v);
  const s = v.replace(/"/g, '""');
  return needs ? `"${s}"` : s;
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
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York" }).format(d);
}

function fmtTime(d: Date | null): string {
  if (!d) return "";
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

function fmtFixed2(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "";
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const locationId = (url.searchParams.get("locationId") || "ALL").trim();
  const userId = (url.searchParams.get("userId") || "ALL").trim();
  const q = (url.searchParams.get("q") || "").trim();

  const where: Prisma.WorkOrderWhereInput = {
    status: { in: [WorkOrderStatus.SUBMITTED, WorkOrderStatus.FINALIZED] },
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
      createdByUser: { select: { name: true, email: true } },
    },
  });

  const header = [
    "workOrderId",
    "userName",
    "userEmail",
    "date",
    "location",
    "departureTime",
    "returnTime",
    "hours",
    "startMileage",
    "endMileage",
    "miles",
    "notes",
  ];

  const lines = [header.join(",")];
  for (const r of rows) {
    const miles =
      typeof r.startingMileage === "number" && typeof r.endingMileage === "number"
        ? Math.max(0, r.endingMileage - r.startingMileage)
        : null;

    lines.push(
      [
        csvEscape(r.id),
        csvEscape(r.createdByUser?.name ?? ""),
        csvEscape(r.createdByUser?.email ?? ""),
        csvEscape(fmtDate(r.startTime)),
        csvEscape(r.location?.name ?? ""),
        csvEscape(fmtTime(r.startTime)),
        csvEscape(fmtTime(r.endTime)),
        csvEscape(fmtFixed2(hoursBetweenNumber(r.startTime, r.endTime))),
        csvEscape(r.startingMileage === null ? "" : String(r.startingMileage)),
        csvEscape(r.endingMileage === null ? "" : String(r.endingMileage)),
        csvEscape(miles === null ? "" : String(miles)),
        csvEscape((r.notes ?? "").trim()),
      ].join(",")
    );
  }

  const csv = lines.join("\n");
  const filename = `admin-travel-log-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
