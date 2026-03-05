// app/api/admin/items/purge/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { Permission } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

function json(body: unknown, status: number) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseBody(body: unknown): { ids: string[] } {
  if (!isRecord(body)) throw new Error("Invalid JSON body");
  const idsRaw = body.ids;
  if (!Array.isArray(idsRaw)) throw new Error("Invalid ids");

  const ids = idsRaw
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x) => x.length > 0);

  const uniqueIds = Array.from(new Set(ids));

  if (uniqueIds.length === 0) throw new Error("No ids provided");
  if (uniqueIds.length > 2000) throw new Error("Too many ids (max 2000 per request)");

  return { ids: uniqueIds };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return json({ error: "Unauthorized" }, 401);
  const perms = await loadUserPermissions(session);
  const canPurgeItems = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
  if (!canPurgeItems) return json({ error: "Forbidden" }, 403);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  let parsed: { ids: string[] };
  try {
    parsed = parseBody(raw);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Invalid request";
    return json({ error: msg }, 400);
  }

  const ids = parsed.ids;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Atomic correctness: require all ids exist (no partial purges)
      const existing = await tx.item.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });

      const found = new Set(existing.map((x) => x.id));
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new Error(
          `Some ids were not found; no changes were made. Missing: ${missing.slice(0, 20).join(", ")}${
            missing.length > 20 ? "…" : ""
          }`
        );
      }

      // Find all checkout tickets referencing these items (these are onDelete: Restrict from Item)
      const ticketIds = await tx.partsCheckoutTicket.findMany({
        where: { itemId: { in: ids } },
        select: { id: true },
      });

      const checkoutIds = ticketIds.map((t) => t.id);

      // IMPORTANT:
      // InvoiceLine.checkoutId is onDelete: Restrict to PartsCheckoutTicket,
      // so we must delete invoice lines first (or deletion of ticket will fail).
      const invoiceLinesDeleted = checkoutIds.length
        ? await tx.invoiceLine.deleteMany({
            where: { checkoutId: { in: checkoutIds } },
          })
        : { count: 0 };

      // Delete checkout tickets (now unblocked)
      const checkoutsDeleted = checkoutIds.length
        ? await tx.partsCheckoutTicket.deleteMany({
            where: { id: { in: checkoutIds } },
          })
        : { count: 0 };

      // InventoryOrder.itemId is onDelete: Restrict to Item, so delete those too
      const ordersDeleted = await tx.inventoryOrder.deleteMany({
        where: { itemId: { in: ids } },
      });

      // Versions first (FK-safe even if cascade exists)
      const versionsDeleted = await tx.itemVersion.deleteMany({
        where: { itemId: { in: ids } },
      });

      // Finally delete items
      const itemsDeleted = await tx.item.deleteMany({
        where: { id: { in: ids } },
      });

      if (itemsDeleted.count !== ids.length) {
        // Should not happen due to existence check, but keep defensive.
        throw new Error("Purge did not delete all requested items");
      }

      return {
        ok: true,
        deletedIds: ids,
        invoiceLinesDeleted: invoiceLinesDeleted.count,
        checkoutsDeleted: checkoutsDeleted.count,
        ordersDeleted: ordersDeleted.count,
        versionsDeleted: versionsDeleted.count,
        itemsDeleted: itemsDeleted.count,
      };
    });

    return json(result, 200);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Purge failed";
    const status = msg.includes("no changes were made") ? 400 : 500;
    return json({ error: msg }, status);
  }
}