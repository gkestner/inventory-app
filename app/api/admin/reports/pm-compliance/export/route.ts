import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { ADMIN_VIEW_PREVENTATIVE_MAINTENANCE } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

type PmRow = {
  id: string;
  location: { name: string };
  updatedAt: Date;
  updatedByUser: { name: string | null; email: string | null } | null;
  ovenCleaning: string | null;
  exhaustFanMotor: string | null;
  tanklessWaterHeater: string | null;
  iceMaker: string | null;
  greaseTrapGallons: string | null;
  greaseTrapTankSize: string | null;
  greaseTrapDatePumped: string | null;
  greaseTrapCompany: string | null;
  greaseTrapCost: string | null;
  backflowDateChecked: string | null;
  backflowCompany: string | null;
  backflowAmount: string | null;
  boilerInspectionDatePrimary: string | null;
  boilerInspectionCompany: string | null;
  boilerInspectionDateSecondary: string | null;
};

type Db = {
  preventativeMaintenanceEntry: {
    findMany: (args: unknown) => Promise<PmRow[]>;
  };
};

const db = prisma as unknown as Db;

const PM_FIELDS = [
  "ovenCleaning",
  "exhaustFanMotor",
  "tanklessWaterHeater",
  "iceMaker",
  "greaseTrapGallons",
  "greaseTrapTankSize",
  "greaseTrapDatePumped",
  "greaseTrapCompany",
  "greaseTrapCost",
  "backflowDateChecked",
  "backflowCompany",
  "backflowAmount",
  "boilerInspectionDatePrimary",
  "boilerInspectionCompany",
  "boilerInspectionDateSecondary",
] as const;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseYear(v: string | null): number {
  const now = new Date().getFullYear();
  const n = Number(String(v ?? "").trim());
  if (!Number.isInteger(n) || n < 2020 || n > now + 1) return now;
  return n;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [ADMIN_VIEW_PREVENTATIVE_MAINTENANCE])) {
    return new Response("Forbidden", { status: 403 });
  }

  const year = parseYear(new URL(req.url).searchParams.get("year"));

  const rows = await db.preventativeMaintenanceEntry.findMany({
    where: { year },
    orderBy: { location: { name: "asc" } },
    select: {
      id: true,
      location: { select: { name: true } },
      updatedAt: true,
      updatedByUser: { select: { name: true, email: true } },
      ovenCleaning: true,
      exhaustFanMotor: true,
      tanklessWaterHeater: true,
      iceMaker: true,
      greaseTrapGallons: true,
      greaseTrapTankSize: true,
      greaseTrapDatePumped: true,
      greaseTrapCompany: true,
      greaseTrapCost: true,
      backflowDateChecked: true,
      backflowCompany: true,
      backflowAmount: true,
      boilerInspectionDatePrimary: true,
      boilerInspectionCompany: true,
      boilerInspectionDateSecondary: true,
    },
  });

  const header = ["id", "location", "year", "completionPct", "filledCount", "updatedAt", "updatedBy", ...PM_FIELDS];
  const lines: string[] = [header.join(",")];

  for (const r of rows) {
    let filled = 0;
    for (const key of PM_FIELDS) {
      if (String(r[key] ?? "").trim()) filled += 1;
    }
    const completionPct = ((filled / PM_FIELDS.length) * 100).toFixed(1);
    const updatedBy = (r.updatedByUser?.name ?? "").trim() || (r.updatedByUser?.email ?? "").trim() || "Unknown";

    lines.push(
      [
        r.id,
        r.location.name,
        year,
        completionPct,
        filled,
        r.updatedAt.toISOString(),
        updatedBy,
        ...PM_FIELDS.map((k) => r[k] ?? ""),
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  const csv = lines.join("\n");
  const filename = `pm-compliance_${year}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${filename}\"`,
      "Cache-Control": "no-store",
    },
  });
}
