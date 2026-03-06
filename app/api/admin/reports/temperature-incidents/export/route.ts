import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { ADMIN_VIEW_TEMPERATURE_DASHBOARD } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

type ReadingRow = {
  id: string;
  recordedAt: Date;
  alertState: "HIGH" | "LOW" | "NORMAL" | "UNKNOWN";
  tempF: unknown;
  batteryPct: number | null;
  signalPct: number | null;
  hub: { name: string; location: { name: string } | null };
  device: { name: string } | null;
};

type Db = {
  mocreoTemperatureReading: {
    findMany: (args: unknown) => Promise<ReadingRow[]>;
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
  if (!perms.allowAll && !hasAnyPermission(perms, [ADMIN_VIEW_TEMPERATURE_DASHBOARD])) {
    return new Response("Forbidden", { status: 403 });
  }

  const days = Math.min(365, parseNum(new URL(req.url).searchParams.get("days"), 14));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db.mocreoTemperatureReading.findMany({
    where: { recordedAt: { gte: since }, alertState: { in: ["HIGH", "LOW"] } },
    orderBy: { recordedAt: "desc" },
    take: 6000,
    select: {
      id: true,
      recordedAt: true,
      alertState: true,
      tempF: true,
      batteryPct: true,
      signalPct: true,
      hub: { select: { name: true, location: { select: { name: true } } } },
      device: { select: { name: true } },
    },
  });

  const lines: string[] = [["id", "recordedAt", "hub", "location", "device", "alertState", "tempF", "batteryPct", "signalPct"].join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.recordedAt.toISOString(),
        r.hub.name,
        r.hub.location?.name ?? "",
        r.device?.name ?? "",
        r.alertState,
        r.tempF == null ? "" : Number(r.tempF).toFixed(2),
        r.batteryPct ?? "",
        r.signalPct ?? "",
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  const csv = lines.join("\n");
  const filename = `temperature-incidents_${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${filename}\"`,
      "Cache-Control": "no-store",
    },
  });
}
