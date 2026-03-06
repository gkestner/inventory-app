import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseDateStart(v: string | null): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateEnd(v: string | null): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(`${s}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function boolParam(v: string | null): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS])) {
    return new Response("Forbidden", { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = parseDateStart(sp.get("from")) ?? defaultFrom;
  const to = parseDateEnd(sp.get("to")) ?? now;
  const includeVoided = boolParam(sp.get("includeVoided"));

  const rows = await prisma.partsCheckoutTicket.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      ...(includeVoided ? {} : { status: { not: "VOIDED" } }),
    },
    orderBy: { createdAt: "desc" },
    take: 10000,
    select: {
      id: true,
      status: true,
      createdAt: true,
      storeName: true,
      createdByName: true,
      skuSnapshot: true,
      partNumberSnapshot: true,
      nameSnapshot: true,
      quantity: true,
      costSnapshot: true,
      needToOrderMore: true,
    },
  });

  const header = [
    "id",
    "status",
    "createdAt",
    "storeName",
    "createdByName",
    "sku",
    "partNumber",
    "itemName",
    "quantity",
    "costSnapshot",
    "estimatedLineCost",
    "needToOrderMore",
  ];
  const lines: string[] = [header.join(",")];

  for (const r of rows) {
    const estimatedLineCost = Number(r.costSnapshot ?? 0) * r.quantity;
    lines.push(
      [
        r.id,
        r.status,
        r.createdAt.toISOString(),
        r.storeName,
        r.createdByName,
        r.skuSnapshot,
        r.partNumberSnapshot ?? "",
        r.nameSnapshot,
        r.quantity,
        r.costSnapshot ?? "",
        estimatedLineCost.toFixed(2),
        r.needToOrderMore ? "true" : "false",
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  const csv = lines.join("\n");
  const filename = `parts-consumption-costs_${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${filename}\"`,
      "Cache-Control": "no-store",
    },
  });
}
