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
  // This is a maintenance checkout endpoint; MAINTENANCE should be allowed.
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

export async function POST(req: NextRequest) {
  // Auth: maintenance men must be logged in. We allow EMPLOYEE+.
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const role = getSessionUserRole(session);
  if (!role) return new Response("Forbidden", { status: 403 });

  // ✅ Fix: avoid includes() union mismatch, and allow MAINTENANCE.
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

  // We require a stable user id for auditing. If your NextAuth session doesn’t include user.id,
  // we’ll fall back to looking up by email. If neither exists, we must fail (otherwise tickets can’t be attributed).
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

      if (!item) {
        throw new Error("Item not found");
      }
      if (!store) {
        throw new Error("Store not found");
      }

      // 2) Resolve createdBy (dropdown selection) without ever blocking checkout:
      // - If body.createdByUserId is provided and valid/active -> use it
      // - Else use session user (by id if present; else email)
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

      // 3) Snapshot current item state into ItemVersion (including inventory quantities)
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

      // 4) Apply inventory update (allowed to go negative; never blocks)
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

      // 5) Create checkout ticket with snapshots (for invoicing stability)
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
          // Vendor snapshot is REQUIRED for vendor-based invoicing.
          // Default to SUCCESS_PLUS for any legacy/null items.
          vendorSnapshot: item.vendor ?? InvoiceVendor.SUCCESS_PLUS,
          costSnapshot: item.cost,
          priceSnapshot: item.price,
          taxableSnapshot: item.taxable,
        },
      });

      // 6) Create InventoryAlert rows (Option B)
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