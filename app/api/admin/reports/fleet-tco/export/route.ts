import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { ADMIN_VIEW_COMPANY_VEHICLES } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

type VehicleRow = {
  id: string;
  name: string;
  vinNumber: string | null;
  assignedUser: { name: string | null; email: string | null } | null;
  serviceLogs: Array<{ serviceAt: Date; odometer: number | null; cost: unknown }>;
  reminders: Array<{ lastCompletedAt: Date | null }>;
};

type Db = {
  companyVehicle: {
    findMany: (args: unknown) => Promise<VehicleRow[]>;
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

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [ADMIN_VIEW_COMPANY_VEHICLES])) {
    return new Response("Forbidden", { status: 403 });
  }

  const days = Math.min(730, parseNum(new URL(req.url).searchParams.get("days"), 180));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const vehicles = await db.companyVehicle.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      vinNumber: true,
      assignedUser: { select: { name: true, email: true } },
      serviceLogs: {
        where: { serviceAt: { gte: since } },
        select: { serviceAt: true, odometer: true, cost: true },
      },
      reminders: {
        where: { active: true },
        select: { lastCompletedAt: true },
      },
    },
  });

  const lines: string[] = [["vehicleId", "vehicle", "vin", "assigned", "serviceLogs", "totalCost", "milesDelta", "costPerMile", "remindersCompleted", "remindersActive"].join(",")];

  for (const v of vehicles) {
    const costs = v.serviceLogs.reduce((sum, r) => sum + Number(r.cost ?? 0), 0);
    const mileage = v.serviceLogs.map((r) => r.odometer).filter((m): m is number => typeof m === "number");
    const minMileage = mileage.length > 0 ? Math.min(...mileage) : null;
    const maxMileage = mileage.length > 0 ? Math.max(...mileage) : null;
    const delta = minMileage != null && maxMileage != null && maxMileage >= minMileage ? maxMileage - minMileage : 0;
    const costPerMile = delta > 0 ? costs / delta : null;
    const completedReminders = v.reminders.filter((r) => r.lastCompletedAt && r.lastCompletedAt >= since).length;
    const assigned = (v.assignedUser?.name ?? "").trim() || (v.assignedUser?.email ?? "").trim() || "Unassigned";

    lines.push(
      [
        v.id,
        v.name,
        v.vinNumber ?? "",
        assigned,
        v.serviceLogs.length,
        costs.toFixed(2),
        delta,
        costPerMile == null ? "" : costPerMile.toFixed(3),
        completedReminders,
        v.reminders.length,
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  const csv = lines.join("\n");
  const filename = `fleet-tco_${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${filename}\"`,
      "Cache-Control": "no-store",
    },
  });
}
