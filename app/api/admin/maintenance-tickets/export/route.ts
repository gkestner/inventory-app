// app/api/admin/maintenance-tickets/export/route.ts
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { PartsCheckoutStatus, Permission, Prisma } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Query params:
 *  - status: OPEN | INVOICED | VOIDED (default INVOICED)
 *  - after:  YYYY-MM-DD or ISO (filters createdAt >= after)
 *  - before: YYYY-MM-DD or ISO (filters createdAt < before)
 *  - q:      free text (ticket id, store, tech, sku, part#, item name)
 */

function parseDateOrNull(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // wrap if contains comma/quote/newline; escape quotes by doubling
  if (/[,"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return new Response("Unauthorized", { status: 401 });

    const perms = await loadUserPermissions(session);
    const canExport =
      perms.allowAll ||
      hasAnyPermission(perms, [Permission.ADMIN_EXPORT_MAINTENANCE_TICKETS, Permission.ADMIN_VIEW_MAINTENANCE_TICKETS]);
    if (!canExport) return new Response("Forbidden", { status: 403 });

    const url = new URL(req.url);
    const sp = url.searchParams;

    const statusRaw = (sp.get("status") || "INVOICED").toUpperCase();
    const status: PartsCheckoutStatus =
      statusRaw === "OPEN"
        ? PartsCheckoutStatus.OPEN
        : statusRaw === "VOIDED"
          ? PartsCheckoutStatus.VOIDED
          : PartsCheckoutStatus.INVOICED;

    const after = parseDateOrNull(sp.get("after"));
    const before = parseDateOrNull(sp.get("before"));
    const q = (sp.get("q") || "").trim();

    const createdAt: Prisma.DateTimeFilter | undefined =
      after || before
        ? {
            ...(after ? { gte: after } : {}),
            ...(before ? { lt: before } : {}),
          }
        : undefined;

    const where: Prisma.PartsCheckoutTicketWhereInput = {
      status,
      ...(createdAt ? { createdAt } : {}),
      ...(q
        ? {
            OR: [
              { id: { contains: q, mode: "insensitive" } },
              { storeName: { contains: q, mode: "insensitive" } },
              { createdByName: { contains: q, mode: "insensitive" } },
              { skuSnapshot: { contains: q, mode: "insensitive" } },
              { partNumberSnapshot: { contains: q, mode: "insensitive" } },
              { nameSnapshot: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const rows = await prisma.partsCheckoutTicket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        itemId: true,
        storeId: true,
        storeName: true,
        quantity: true,
        needToOrderMore: true,
        createdAt: true,
        invoicedAt: true,
        voidedAt: true,
        voidNote: true,
        createdByUserId: true,
        createdByName: true,

        // snapshots (invoice-safe)
        skuSnapshot: true,
        partNumberSnapshot: true,
        nameSnapshot: true,
        costSnapshot: true,
        priceSnapshot: true,
        taxableSnapshot: true,
      },
    });

    const header = [
      "ticketId",
      "status",
      "createdAt",
      "storeId",
      "storeName",
      "createdByUserId",
      "createdByName",
      "itemId",
      "skuSnapshot",
      "partNumberSnapshot",
      "nameSnapshot",
      "quantity",
      "needToOrderMore",
      "costSnapshot",
      "priceSnapshot",
      "taxableSnapshot",
      "invoicedAt",
      "voidedAt",
      "voidNote",
    ];

    const lines: string[] = [];
    lines.push(header.join(","));

    for (const r of rows) {
      lines.push(
        [
          r.id,
          r.status,
          r.createdAt?.toISOString?.() ?? "",
          r.storeId,
          r.storeName,
          r.createdByUserId,
          r.createdByName,
          r.itemId,
          r.skuSnapshot,
          r.partNumberSnapshot,
          r.nameSnapshot,
          r.quantity,
          r.needToOrderMore,
          r.costSnapshot,
          r.priceSnapshot,
          r.taxableSnapshot,
          r.invoicedAt?.toISOString?.() ?? "",
          r.voidedAt?.toISOString?.() ?? "",
          r.voidNote ?? "",
        ]
          .map(csvEscape)
          .join(",")
      );
    }

    const csv = lines.join("\n");
    const filename = `maintenance-tickets_${status}_${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    console.error("Export maintenance tickets failed:", err);
    return new Response("Export failed", { status: 500 });
  }
}
