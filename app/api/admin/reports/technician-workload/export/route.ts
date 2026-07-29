import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

type RequestRow = {
  status: "OPEN" | "RESOLVED" | "ARCHIVED";
  resolvedAt: Date | null;
  archivedAt: Date | null;
  assignedMaintenanceUser: { name: string | null; email: string | null } | null;
};

type WorkOrderRow = {
  status: "DRAFT" | "SUBMITTED" | "FINALIZED";
  createdByUser: { name: string | null; email: string | null };
};

type Db = {
  maintenanceRequest: { findMany: (args: unknown) => Promise<RequestRow[]> };
  workOrder: { findMany: (args: unknown) => Promise<WorkOrderRow[]> };
};

const db = prisma as unknown as Db;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseNum(v: string | null, fallback: number): number {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD])) {
    return new Response("Forbidden", { status: 403 });
  }

  const days = Math.min(365, parseNum(new URL(req.url).searchParams.get("days"), 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [requestRows, workOrderRows] = await Promise.all([
    db.maintenanceRequest.findMany({
      where: { createdAt: { gte: since } },
      take: 5000,
      select: {
        status: true,
        resolvedAt: true,
        archivedAt: true,
        assignedMaintenanceUser: { select: { name: true, email: true } },
      },
    }),
    db.workOrder.findMany({
      where: { createdAt: { gte: since } },
      take: 5000,
      select: {
        status: true,
        createdByUser: { select: { name: true, email: true } },
      },
    }),
  ]);

  const bucket = new Map<string, { reqOpen: number; reqClosed: number; woOpen: number; woClosed: number }>();
  function getBucket(name: string) {
    const existing = bucket.get(name);
    if (existing) return existing;
    const created = { reqOpen: 0, reqClosed: 0, woOpen: 0, woClosed: 0 };
    bucket.set(name, created);
    return created;
  }

  for (const r of requestRows) {
    const tech = (r.assignedMaintenanceUser?.name ?? "").trim() || (r.assignedMaintenanceUser?.email ?? "").trim() || "Unassigned";
    const b = getBucket(tech);
    const closed = !!(r.resolvedAt || r.archivedAt || r.status !== "OPEN");
    if (closed) b.reqClosed += 1;
    else b.reqOpen += 1;
  }

  for (const r of workOrderRows) {
    const tech = (r.createdByUser?.name ?? "").trim() || (r.createdByUser?.email ?? "").trim() || "Unknown";
    const b = getBucket(tech);
    const closed = r.status === "SUBMITTED" || r.status === "FINALIZED";
    if (closed) b.woClosed += 1;
    else b.woOpen += 1;
  }

  const lines: string[] = [["technician", "requestOpen", "requestClosed", "workOrderOpen", "workOrderClosed", "openTotal", "closedTotal"].join(",")];
  const rows = Array.from(bucket.entries()).sort((a, b) => {
    const aOpen = a[1].reqOpen + a[1].woOpen;
    const bOpen = b[1].reqOpen + b[1].woOpen;
    return bOpen - aOpen;
  });

  for (const [name, r] of rows) {
    lines.push(
      [
        name,
        r.reqOpen,
        r.reqClosed,
        r.woOpen,
        r.woClosed,
        r.reqOpen + r.woOpen,
        r.reqClosed + r.woClosed,
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  const csv = lines.join("\n");
  const filename = `technician-workload_${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${filename}\"`,
      "Cache-Control": "no-store",
    },
  });
}
