import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { ADMIN_VIEW_REPORT_SLA_BREACHES } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

type RequestRow = {
  id: string;
  title: string;
  status: "OPEN" | "RESOLVED" | "ARCHIVED";
  createdAt: Date;
  resolvedAt: Date | null;
  archivedAt: Date | null;
  location: { name: string };
  assignedMaintenanceUser: { name: string | null; email: string | null } | null;
  requestedByUser: { name: string | null; email: string | null };
};

type Db = {
  maintenanceRequest: {
    findMany: (args: unknown) => Promise<RequestRow[]>;
  };
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

function hoursBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / (1000 * 60 * 60));
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [ADMIN_VIEW_REPORT_SLA_BREACHES])) {
    return new Response("Forbidden", { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const days = Math.min(365, parseNum(sp.get("days"), 30));
  const responseHours = parseNum(sp.get("responseHours"), 4);
  const closeHours = parseNum(sp.get("closeHours"), 48);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db.maintenanceRequest.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      archivedAt: true,
      location: { select: { name: true } },
      assignedMaintenanceUser: { select: { name: true, email: true } },
      requestedByUser: { select: { name: true, email: true } },
    },
  });

  const now = new Date();
  const header = [
    "id",
    "breachType",
    "ageHours",
    "status",
    "location",
    "assigned",
    "title",
    "requestedBy",
    "createdAt",
    "resolvedAt",
    "archivedAt",
  ];

  const lines: string[] = [header.join(",")];
  for (const r of rows) {
    const end = r.resolvedAt ?? r.archivedAt ?? now;
    const ageHours = hoursBetween(r.createdAt, end);
    const isOpen = r.status === "OPEN";
    const responseBreached = isOpen && ageHours > responseHours;
    const closeBreached = !isOpen && ageHours > closeHours;
    if (!responseBreached && !closeBreached) continue;

    const assigned = (r.assignedMaintenanceUser?.name ?? "").trim() || (r.assignedMaintenanceUser?.email ?? "").trim() || "Unassigned";
    const requester = (r.requestedByUser?.name ?? "").trim() || (r.requestedByUser?.email ?? "").trim() || "Unknown";

    lines.push(
      [
        r.id,
        responseBreached ? "RESPONSE" : "CLOSE",
        ageHours.toFixed(2),
        r.status,
        r.location.name,
        assigned,
        r.title,
        requester,
        r.createdAt.toISOString(),
        r.resolvedAt?.toISOString() ?? "",
        r.archivedAt?.toISOString() ?? "",
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  const csv = lines.join("\n");
  const filename = `sla-breaches_${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${filename}\"`,
      "Cache-Control": "no-store",
    },
  });
}
