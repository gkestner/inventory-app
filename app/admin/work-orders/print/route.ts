import { getServerSession } from "next-auth";
import { Permission, Prisma, WorkOrderStatus } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

const TZ = "America/New_York";

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

function fmtLocal(d: Date | null): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(d));
}

function fmtDate(d: Date | null): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(d));
}

function fmtTime(d: Date | null): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(d));
}

function hoursBetweenNumber(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms / (1000 * 60 * 60);
}

function fmtFixed2(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "-";
  return (Math.round(n * 100) / 100).toFixed(2);
}

function statusLabel(status: WorkOrderStatus): string {
  if (status === "DRAFT") return "IN PROGRESS";
  if (status === "SUBMITTED") return "PENDING";
  if (status === "FINALIZED") return "GENERATED";
  return status;
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
    .slice(0, 3000);

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
            { workOrderNumber: { contains: q, mode: "insensitive" } },
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
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const ids = parseIds(url.searchParams.get("ids"));

  const where: Prisma.WorkOrderWhereInput =
    ids.length > 0
      ? { id: { in: ids } }
      : buildWhere(url);

  const rows = await prisma.workOrder.findMany({
    where,
    orderBy: [{ createdByUserId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: 3000,
    select: {
      id: true,
      status: true,
      workOrderNumber: true,
      notes: true,
      startTime: true,
      endTime: true,
      startingMileage: true,
      endingMileage: true,
      createdAt: true,
      updatedAt: true,
      location: { select: { name: true } },
      createdByUser: { select: { id: true, name: true, email: true } },
      equipmentAreas: { select: { area: true }, orderBy: { area: "asc" } },
    },
  });

  const byId = new Map(rows.map((r) => [r.id, r]));
  const orderedRows =
    ids.length > 0
      ? ids
          .map((id) => byId.get(id))
          .filter((r): r is (typeof rows)[number] => Boolean(r))
          .sort((left, right) => {
            const leftUser = `${left.createdByUser?.name ?? ""}|${left.createdByUser?.email ?? ""}`.toLowerCase();
            const rightUser = `${right.createdByUser?.name ?? ""}|${right.createdByUser?.email ?? ""}`.toLowerCase();
            if (leftUser !== rightUser) return leftUser.localeCompare(rightUser);
            return left.createdAt.getTime() - right.createdAt.getTime();
          })
      : rows;

  let lastUserKey = "";
  const rowHtml = orderedRows
    .map((r) => {
      const miles =
        typeof r.startingMileage === "number" && typeof r.endingMileage === "number"
          ? Math.max(0, r.endingMileage - r.startingMileage)
          : null;
      const hours = hoursBetweenNumber(r.startTime, r.endTime);
      const userLabel = r.createdByUser ? `${r.createdByUser.name} (${r.createdByUser.email})` : "-";
      const userKey = `${r.createdByUser?.id ?? "none"}:${r.createdByUser?.email ?? ""}`;
      const groupHeader =
        userKey !== lastUserKey
          ? `<div class="group-title">User: ${escapeHtml(userLabel)}</div>`
          : "";
      lastUserKey = userKey;

      return `${groupHeader}<section class="card keep">
  <div class="head">
    <div>
      <div class="title">Work Order ${escapeHtml(r.workOrderNumber ?? r.id)}</div>
      <div class="meta">Status: <b>${escapeHtml(statusLabel(r.status))}</b> | Location: <b>${escapeHtml(r.location?.name ?? "-")}</b></div>
      <div class="meta">User: <b>${escapeHtml(userLabel)}</b></div>
      <div class="meta">Internal ID: <b>${escapeHtml(r.id)}</b></div>
    </div>
    <div class="meta right">Created: ${escapeHtml(fmtLocal(r.createdAt))}<br/>Updated: ${escapeHtml(fmtLocal(r.updatedAt))}</div>
  </div>

  <table>
    <colgroup>
      <col style="width: 14%" />
      <col style="width: 14%" />
      <col style="width: 8%" />
      <col style="width: 9%" />
      <col style="width: 9%" />
      <col style="width: 7%" />
      <col style="width: 39%" />
    </colgroup>
    <thead>
      <tr><th>Start</th><th>End</th><th>Hours</th><th>Start Mi</th><th>End Mi</th><th>Miles</th><th>Equipment Areas</th></tr>
    </thead>
    <tbody>
      <tr>
        <td><div>${escapeHtml(fmtDate(r.startTime))}</div><div class="time">${escapeHtml(fmtTime(r.startTime))}</div></td>
        <td><div>${escapeHtml(fmtDate(r.endTime))}</div><div class="time">${escapeHtml(fmtTime(r.endTime))}</div></td>
        <td>${escapeHtml(fmtFixed2(hours))}</td>
        <td>${escapeHtml(r.startingMileage === null ? "-" : String(r.startingMileage))}</td>
        <td>${escapeHtml(r.endingMileage === null ? "-" : String(r.endingMileage))}</td>
        <td>${escapeHtml(miles === null ? "-" : String(miles))}</td>
        <td class="wrap">${escapeHtml(r.equipmentAreas.map((a) => a.area).join(", ") || "-")}</td>
      </tr>
    </tbody>
  </table>

  <div class="notes"><b>Notes:</b> ${escapeHtml((r.notes ?? "").trim() || "-")}</div>
</section>`;
    })
    .join("\n");

  const criteria = ids.length > 0
    ? `${ids.length} selected work order(s)`
    : [
        url.searchParams.get("q") ? `Search: ${url.searchParams.get("q")}` : "",
        url.searchParams.get("status") ? `Status: ${url.searchParams.get("status")}` : "",
        url.searchParams.get("from") ? `From: ${url.searchParams.get("from")}` : "",
        url.searchParams.get("to") ? `To: ${url.searchParams.get("to")}` : "",
        url.searchParams.get("userId") && url.searchParams.get("userId") !== "ALL" ? "Filtered user" : "",
      ]
        .filter(Boolean)
        .join(" | ") || "All records";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Work Orders Print</title>
  <style>
    @page { margin: 10mm; }
    body { margin: 0; font-family: Segoe UI, Arial, sans-serif; color: #000; background: #fff; }
    .wrap { max-width: 1080px; margin: 0 auto; padding: 10px; }
    .top { border: 1px solid #777; padding: 10px; margin-bottom: 10px; }
    .top-title { font-size: 22px; font-weight: 900; margin-bottom: 6px; }
    .meta { font-size: 12px; color: #222; }
    .right { text-align: right; }
    .group-title { font-size: 14px; font-weight: 900; margin: 18px 0 8px; }
    .group-title:first-of-type { margin-top: 0; }
    .card { border: 1px solid #999; padding: 10px; margin-bottom: 10px; }
    .keep { break-inside: avoid-page; page-break-inside: avoid; break-after: page; page-break-after: always; min-height: calc(100vh - 30mm); }
    .keep:last-of-type { break-after: auto; page-break-after: auto; }
    .head { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
    .title { font-size: 16px; font-weight: 900; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #bbb; padding: 4px 5px; font-size: 10px; text-align: left; vertical-align: top; white-space: normal; word-break: break-word; overflow-wrap: anywhere; }
    th { white-space: nowrap; font-size: 10px; }
    td:nth-child(3), td:nth-child(4), td:nth-child(5), td:nth-child(6) { white-space: nowrap; }
    .time { white-space: nowrap; }
    td.wrap { white-space: normal; }
    .notes { margin-top: 8px; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
    .empty { border: 1px solid #999; padding: 10px; font-size: 13px; }
  </style>
</head>
<body>
  <script>window.addEventListener('load', function () { try { window.print(); } catch (e) {} });</script>
  <div class="wrap">
    <div class="top">
      <div class="top-title">Admin Work Orders</div>
      <div class="meta">Criteria: <b>${escapeHtml(criteria)}</b></div>
      <div class="meta">Records: <b>${orderedRows.length}</b></div>
    </div>
    ${orderedRows.length > 0 ? rowHtml : '<div class="empty">No work orders found for the selected filters.</div>'}
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
