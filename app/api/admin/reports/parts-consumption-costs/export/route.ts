import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS } from "@/app/lib/permission-constants";
import { partsConsumptionQuery } from "@/app/lib/parts-consumption-report";

export const dynamic = "force-dynamic";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS])) {
    return new Response("Forbidden", { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const { dateError, where } = partsConsumptionQuery({
    from: sp.get("from"), to: sp.get("to"), itemId: sp.get("itemId"), includeVoided: sp.get("includeVoided"),
  });
  if (dateError) return new Response("Invalid date range", { status: 400 });

  const rows = await prisma.partsCheckoutTicket.findMany({
    where,
    orderBy: { createdAt: "desc" },
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
