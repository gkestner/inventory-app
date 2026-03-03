// app/api/maintenance/checkout/route.ts
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { Prisma, Role, InvoiceVendor } from "@prisma/client";

type Body = {
  itemId: string;
  storeId: string;
  quantity: number;
  createdByUserId?: string; // optional; if missing/invalid, falls back to session user
  needToOrderMore?: boolean;
  note?: string | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isRole(v: unknown): v is Role {
  return typeof v === "string" && (Object.values(Role) as string[]).includes(v);
}

function getSessionUserRole(session: unknown): Role | null {
  if (!isRecord(session)) return null;
  const user = session.user;
  if (!isRecord(user)) return null;
  const role = user.role;
  return isRole(role) ? role : null;
}

function getSessionUserId(session: unknown): string | null {
  if (!isRecord(session)) return null;
  const user = session.user;
  if (!isRecord(user)) return null;
  const id = user.id;
  return typeof id === "string" && id.trim() ? id : null;
}

function getSessionUserEmail(session: unknown): string | null {
  if (!isRecord(session)) return null;
  const user = session.user;
  if (!isRecord(user)) return null;
  const email = user.email;
  return typeof email === "string" && email.trim() ? email : null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Math.trunc(Number(v));
  return null;
}

function isAllowedMaintenanceCheckoutRole(role: Role): boolean {
  switch (role) {
    case Role.EMPLOYEE:
    case Role.MAINTENANCE:
    case Role.MANAGER:
    case Role.ADMIN:
      return true;
    default:
      return false;
  }
}

function normalizeVendor(v: unknown): InvoiceVendor | null {
  const s = String(v ?? "")
    .trim()
    .toUpperCase()
    .replace(/[-\s]+/g, "_");
  if (s === "AMERICAN_PLUS") return InvoiceVendor.AMERICAN_PLUS;
  if (s === "SUCCESS_PLUS") return InvoiceVendor.SUCCESS_PLUS;
  return null;
}

/**
 * Infer vendor from "label-ish" item fields (since your app uses an "american plus" label).
 * This is intentionally defensive: it won't throw if fields don't exist.
 */
function inferVendorFromItemLabelishFields(item: unknown): InvoiceVendor | null {
  if (!isRecord(item)) return null;

  const candidates: unknown[] = [
    item.vendor, // if present in schema already
    item.name,
    (item as Record<string, unknown>).description,
    (item as Record<string, unknown>).category,
    (item as Record<string, unknown>).manufacturer,
    (item as Record<string, unknown>).orderFrom,
    (item as Record<string, unknown>).vendorLabel,
    (item as Record<string, unknown>).label,
    (item as Record<string, unknown>).labels,
    (item as Record<string, unknown>).pricingTier,
    (item as Record<string, unknown>).pricingLabel,
    (item as Record<string, unknown>).invoiceVendor,
    (item as Record<string, unknown>).invoiceVendorLabel,
    (item as Record<string, unknown>).tier,
  ];

  // First: if any candidate is already a vendor enum-ish string
  for (const c of candidates) {
    const v = normalizeVendor(c);
    if (v) return v;
  }

  // Next: if any candidate contains a phrase like "american plus"
  for (const c of candidates) {
    if (typeof c === "string") {
      const s = c.toLowerCase();
      if (s.includes("american plus") || s.includes("american_plus")) return InvoiceVendor.AMERICAN_PLUS;
      if (s.includes("success plus") || s.includes("success_plus")) return InvoiceVendor.SUCCESS_PLUS;
    }

    if (Array.isArray(c)) {
      const joined = c.map((x) => String(x ?? "")).join(" ").toLowerCase();
      if (joined.includes("american plus") || joined.includes("american_plus")) return InvoiceVendor.AMERICAN_PLUS;
      if (joined.includes("success plus") || joined.includes("success_plus")) return InvoiceVendor.SUCCESS_PLUS;
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const role = getSessionUserRole(session);
  if (!role) return new Response("Forbidden", { status: 403 });

  if (!isAllowedMaintenanceCheckoutRole(role)) {
    return new Response("Forbidden", { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const itemId = isNonEmptyString(body.itemId) ? body.itemId.trim() : "";
  const storeId = isNonEmptyString(body.storeId) ? body.storeId.trim() : "";
  const qty = toInt(body.quantity);

  if (!itemId) return new Response("Missing itemId", { status: 400 });
  if (!storeId) return new Response("Missing storeId", { status: 400 });
  if (qty === null || qty <= 0) return new Response("Invalid quantity", { status: 400 });

  const needToOrderMore = Boolean(body.needToOrderMore);
  const note = typeof body.note === "string" ? body.note.trim() : null;

  const sessionUserId = getSessionUserId(session);
  const sessionUserEmail = getSessionUserEmail(session);

  if (!sessionUserId && !sessionUserEmail) {
    return new Response("Session missing user id/email", { status: 500 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1) Load item + store
      const [item, store] = await Promise.all([
        tx.item.findUnique({ where: { id: itemId } }),
        tx.location.findUnique({ where: { id: storeId } }),
      ]);

      if (!item) throw new Error("Item not found");
      if (!store) throw new Error("Store not found");

      // 2) Resolve createdBy user
      let createdByUser = null as null | { id: string; name: string; active: boolean };
      if (isNonEmptyString(body.createdByUserId)) {
        createdByUser = await tx.user.findUnique({
          where: { id: body.createdByUserId.trim() },
          select: { id: true, name: true, active: true },
        });
      }

      if (!createdByUser || !createdByUser.active) {
        if (sessionUserId) {
          createdByUser = await tx.user.findUnique({
            where: { id: sessionUserId },
            select: { id: true, name: true, active: true },
          });
        } else if (sessionUserEmail) {
          createdByUser = await tx.user.findUnique({
            where: { email: sessionUserEmail },
            select: { id: true, name: true, active: true },
          });
        }
      }

      if (!createdByUser || !createdByUser.active) {
        throw new Error("Created-by user not found/active");
      }

      // 3) Snapshot into ItemVersion
      const latest = await tx.itemVersion.findFirst({
        where: { itemId: item.id },
        orderBy: [{ version: "desc" }],
        select: { version: true },
      });
      const nextVersion = (latest?.version ?? 0) + 1;

      await tx.itemVersion.create({
        data: {
          itemId: item.id,
          sku: item.sku,
          partNumber: item.partNumber,
          name: item.name,
          description: item.description,
          category: item.category,
          cost: item.cost,
          price: item.price,
          taxable: item.taxable,
          active: item.active,
          onHandQty: item.onHandQty,
          orderedQty: item.orderedQty,
          usedQty: item.usedQty,
          minQty: item.minQty,
          version: nextVersion,
        },
      });

      // 4) Inventory update
      const onHandAfter = item.onHandQty - qty;
      const usedAfter = item.usedQty + qty;
      const orderedAfter = item.orderedQty;
      const availableAfter = onHandAfter + orderedAfter;
      const minQtyAtTime = item.minQty;

      const updatedItem = await tx.item.update({
        where: { id: item.id },
        data: {
          onHandQty: onHandAfter,
          usedQty: usedAfter,
        },
        select: {
          id: true,
          sku: true,
          partNumber: true,
          name: true,
          cost: true,
          price: true,
          taxable: true,
          onHandQty: true,
          orderedQty: true,
          usedQty: true,
          minQty: true,
        },
      });

      // ✅ 5) Vendor snapshot: prefer item.vendor if it is a valid enum; otherwise infer from label-ish fields
      const inferredVendor =
        normalizeVendor((item as unknown as { vendor?: unknown }).vendor) ??
        inferVendorFromItemLabelishFields(item) ??
        InvoiceVendor.SUCCESS_PLUS;

      const ticket = await tx.partsCheckoutTicket.create({
        data: {
          status: "OPEN",
          itemId: item.id,
          storeId: store.id,
          storeName: store.name,
          quantity: qty,
          needToOrderMore,
          createdByUserId: createdByUser.id,
          createdByName: createdByUser.name,
          note,
          skuSnapshot: item.sku,
          partNumberSnapshot: item.partNumber,
          nameSnapshot: item.name,
          vendorSnapshot: inferredVendor,
          costSnapshot: item.cost,
          priceSnapshot: item.price,
          taxableSnapshot: item.taxable,
        },
      });

      // 6) Alerts
      const alertsToCreate: Prisma.InventoryAlertCreateManyInput[] = [];

      if (onHandAfter < 0) {
        alertsToCreate.push({
          type: "NEGATIVE_ON_HAND",
          itemId: item.id,
          storeId: store.id,
          storeName: store.name,
          checkoutId: ticket.id,
          createdByUserId: createdByUser.id,
          createdByName: createdByUser.name,
          qtyDelta: -qty,
          onHandAfter,
          orderedAfter,
          availableAfter,
          minQtyAtTime,
          note: "On-hand went negative after checkout.",
        });
      }

      if (availableAfter < minQtyAtTime) {
        alertsToCreate.push({
          type: "BELOW_MIN",
          itemId: item.id,
          storeId: store.id,
          storeName: store.name,
          checkoutId: ticket.id,
          createdByUserId: createdByUser.id,
          createdByName: createdByUser.name,
          qtyDelta: -qty,
          onHandAfter,
          orderedAfter,
          availableAfter,
          minQtyAtTime,
          note: "Available quantity below minimum after checkout.",
        });
      }

      if (needToOrderMore) {
        alertsToCreate.push({
          type: "TECH_REQUEST_ORDER",
          itemId: item.id,
          storeId: store.id,
          storeName: store.name,
          checkoutId: ticket.id,
          createdByUserId: createdByUser.id,
          createdByName: createdByUser.name,
          qtyDelta: -qty,
          onHandAfter,
          orderedAfter,
          availableAfter,
          minQtyAtTime,
          note: "Technician requested reorder.",
        });
      }

      if (alertsToCreate.length) {
        await tx.inventoryAlert.createMany({ data: alertsToCreate });
      }

      return {
        ticket,
        item: updatedItem,
        signals: {
          negativeOnHand: onHandAfter < 0,
          belowMin: availableAfter < minQtyAtTime,
          techRequestedOrder: needToOrderMore,
        },
      };
    });

    return Response.json(result, { status: 201 });
  } catch (e: unknown) {
    const msg =
      typeof e === "object" && e !== null && "message" in e && typeof (e as { message: unknown }).message === "string"
        ? (e as { message: string }).message
        : "Checkout failed";

    if (msg === "Item not found" || msg === "Store not found") {
      return new Response(msg, { status: 404 });
    }

    return new Response(msg, { status: 500 });
  }
}