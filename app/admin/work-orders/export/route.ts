import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Permission, Prisma, WorkOrderStatus } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

const TZ = "America/New_York";

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
    timeZone: TZ,
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

function fmtDate(d: Date | null): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

function fmtTime(d: Date | null): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
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

function decodeOnce(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function parseIds(raw: string | null): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  const decoded = decodeOnce(s);
  const out = decoded
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 5000);
  return Array.from(new Set(out));
}

async function requireAdminWorkOrders() {
  const session = await getServerSession(authOptions);
  if (!session) return false;

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return true;
  return hasAnyPermission(perms, [Permission.ADMIN_VIEW_WORK_ORDERS, Permission.ADMIN_EDIT_WORK_ORDERS]);
}

function buildWhere(url: URL): Prisma.WorkOrderWhereInput {
  const q = (url.searchParams.get("q") || "").trim();
  const userId = (url.searchParams.get("userId") || "ALL").trim();
  const statusRaw = (url.searchParams.get("status") || "ALL").trim().toUpperCase();
  const fromParam = parseYMD(url.searchParams.get("from"));
  const toParam = parseYMD(url.searchParams.get("to"));

  const fromUtc = fromParam ? nyMidnightUtc(fromParam) : null;
  const toExclusiveUtc = toParam ? addDaysUtc(nyMidnightUtc(toParam), 1) : null;

  const statusFilter = statusRaw === "DRAFT" || statusRaw === "SUBMITTED" || statusRaw === "FINALIZED" ? statusRaw : "ALL";
  const statusMatchesQ = ["DRAFT", "SUBMITTED", "FINALIZED"].filter((s) => s.includes(q.toUpperCase()));

  return {
    ...(statusFilter !== "ALL" ? { status: statusFilter as WorkOrderStatus } : {}),
    ...(fromUtc || toExclusiveUtc
      ? {
          createdAt: {
            ...(fromUtc ? { gte: fromUtc } : {}),
            ...(toExclusiveUtc ? { lt: toExclusiveUtc } : {}),
          },
        }
      : {}),
    ...(userId !== "ALL" ? { createdByUserId: userId } : {}),
    ...(q
      ? {
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { notes: { contains: q, mode: "insensitive" } },
            { location: { name: { contains: q, mode: "insensitive" } } },
            { createdByUser: { name: { contains: q, mode: "insensitive" } } },
            { createdByUser: { email: { contains: q, mode: "insensitive" } } },
            ...(statusMatchesQ.length > 0
              ? [{ status: { in: statusMatchesQ as WorkOrderStatus[] } }]
              : []),
          ],
        }
      : {}),
  };
}

export async function GET(req: Request) {
  if (!(await requireAdminWorkOrders())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const ids = parseIds(url.searchParams.get("ids"));

  const where: Prisma.WorkOrderWhereInput =
    ids.length > 0
      ? { id: { in: ids } }
      : buildWhere(url);

  const rows = await prisma.workOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: {
      id: true,
      status: true,
      notes: true,
      startTime: true,
      endTime: true,
      startingMileage: true,
      endingMileage: true,
      createdAt: true,
      updatedAt: true,
      location: { select: { name: true } },
      createdByUser: { select: { name: true, email: true } },
      equipmentAreas: { select: { area: true }, orderBy: { area: "asc" } },
    },
  });

  const byId = new Map(rows.map((r) => [r.id, r]));
  const orderedRows =
    ids.length > 0
      ? ids
          .map((id) => byId.get(id))
          .filter((r): r is (typeof rows)[number] => Boolean(r))
      : rows;

  const header = [
    "workOrderId",
    "quickbooksDate",
    "quickbooksRefNumber",
    "quickbooksMemo",
    "quickbooksName",
    "quickbooksClass",
    "status",
    "location",
    "technicianName",
    "technicianEmail",
    "createdAt",
    "updatedAt",
    "startDate",
    "startTime",
    "endDate",
    "endTime",
    "hours",
    "startingMileage",
    "endingMileage",
    "miles",
    "equipmentAreas",
    "notes",
  ];

  const lines = [header.join(",")];

  for (const r of orderedRows) {
    const miles =
      typeof r.startingMileage === "number" && typeof r.endingMileage === "number"
        ? Math.max(0, r.endingMileage - r.startingMileage)
        : null;
    const hours = hoursBetweenNumber(r.startTime, r.endTime);

    const quickbooksMemo = `${r.location?.name ?? ""} | ${r.notes?.trim() || "Work order"}`.slice(0, 4096);

    lines.push(
      [
        csvEscape(r.id),
        csvEscape(fmtDate(r.startTime ?? r.createdAt)),
        csvEscape(r.id),
        csvEscape(quickbooksMemo),
        csvEscape(r.createdByUser?.name ?? ""),
        csvEscape(r.location?.name ?? ""),
        csvEscape(String(r.status)),
        csvEscape(r.location?.name ?? ""),
        csvEscape(r.createdByUser?.name ?? ""),
        csvEscape(r.createdByUser?.email ?? ""),
        csvEscape(r.createdAt.toISOString()),
        csvEscape(r.updatedAt.toISOString()),
        csvEscape(fmtDate(r.startTime)),
        csvEscape(fmtTime(r.startTime)),
        csvEscape(fmtDate(r.endTime)),
        csvEscape(fmtTime(r.endTime)),
        csvEscape(fmtFixed2(hours)),
        csvEscape(r.startingMileage === null ? "" : String(r.startingMileage)),
        csvEscape(r.endingMileage === null ? "" : String(r.endingMileage)),
        csvEscape(miles === null ? "" : String(miles)),
        csvEscape(r.equipmentAreas.map((a) => a.area).join(";")),
        csvEscape((r.notes ?? "").trim()),
      ].join(",")
    );
  }

  const csv = lines.join("\n");
  const filename = `admin-work-orders-quickbooks-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
