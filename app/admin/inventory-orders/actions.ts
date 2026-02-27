// app/admin/inventory-orders/actions.ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { Permission, Role } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
    name?: string | null;
  } | null;
} | null;

async function requireOrderHistoryEdit() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) throw new Error("Unauthorized");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return { session, perms };

  const ok = hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) throw new Error("Forbidden");

  return { session, perms };
}

// In some setups, session.user.id may not be present; resolve by email if needed.
async function resolveSessionUserId(session: AdminSession): Promise<string> {
  const id = session?.user?.id ?? null;
  if (id) return id;

  const email = session?.user?.email ?? null;
  if (!email) return "";

  const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return u?.id ?? "";
}

function safeReturnToPathFromReferer(referer: string | null): string {
  if (!referer) return "/admin/inventory-orders";
  try {
    const u = new URL(referer);
    const path = `${u.pathname}${u.search}`;
    return path.startsWith("/") ? path : "/admin/inventory-orders";
  } catch {
    return "/admin/inventory-orders";
  }
}

function withQuery(basePath: string, next: Record<string, string | undefined>) {
  const u = new URL(basePath, "http://local");
  for (const [k, v] of Object.entries(next)) {
    if (!v) continue;
    u.searchParams.set(k, v);
  }
  const qs = u.searchParams.toString();
  return qs ? `${u.pathname}?${qs}` : u.pathname;
}

function parseOptionalInt(v: FormDataEntryValue | null): number | null {
  if (v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function parseRequiredInt(v: FormDataEntryValue | null): number {
  const n = parseOptionalInt(v);
  if (n === null) return NaN;
  return n;
}

function parseOptionalMoneyString(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

function parseRequiredMoneyString(v: FormDataEntryValue | null): string {
  const s = parseOptionalMoneyString(v);
  if (s === null) return "";
  return s;
}

function parseOptionalDateTimeLocal(v: FormDataEntryValue | null): Date | null {
  if (v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseBool(v: FormDataEntryValue | null): boolean {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function nonEmptyString(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

function buildSystemAuditLine(args: {
  action:
    | "CREATE_ORDER"
    | "EDIT_ORDER"
    | "MARK_ARRIVED"
    | "ADD_TO_INVENTORY"
    | "DELETE_ORDER"
    | "SYNC_ITEM_FROM_LATEST_ORDER"
    | "CREATE_ITEM_FROM_ORDER";
  itemSku?: string | null;
  prevCost?: string | null;
  newCost?: string | null;
  prevOrderFrom?: string | null;
  newOrderFrom?: string | null;
  prevOrderedQty?: number | null;
  newOrderedQty?: number | null;
  prevOnHandQty?: number | null;
  newOnHandQty?: number | null;
  note?: string;
}) {
  const now = new Date().toISOString();
  const parts: string[] = [`AUDIT ${now} ${args.action}`];
  if (args.itemSku) parts.push(`sku=${args.itemSku}`);
  if (args.prevCost !== undefined || args.newCost !== undefined) parts.push(`cost:${args.prevCost ?? "—"}→${args.newCost ?? "—"}`);
  if (args.prevOrderFrom !== undefined || args.newOrderFrom !== undefined)
    parts.push(`orderFrom:${args.prevOrderFrom ?? "—"}→${args.newOrderFrom ?? "—"}`);
  if (args.prevOrderedQty !== undefined || args.newOrderedQty !== undefined)
    parts.push(`orderedQty:${args.prevOrderedQty ?? "—"}→${args.newOrderedQty ?? "—"}`);
  if (args.prevOnHandQty !== undefined || args.newOnHandQty !== undefined)
    parts.push(`onHandQty:${args.prevOnHandQty ?? "—"}→${args.newOnHandQty ?? "—"}`);
  if (args.note) parts.push(`(${args.note})`);
  return parts.join(" ");
}

async function syncItemCostAndOrderFromFromLatestOrder(tx: Prisma.TransactionClient, itemId: string) {
  const latest = await tx.inventoryOrder.findFirst({
    where: { itemId },
    orderBy: { orderedAt: "desc" },
    select: { id: true, unitPrice: true, supplierName: true, orderedAt: true, note: true },
  });

  if (!latest) return;

  const item = await tx.item.findUnique({
    where: { id: itemId },
    select: { id: true, sku: true, cost: true, orderFrom: true },
  });
  if (!item) return;

  // Only update if we have a cost value.
  if (!latest.unitPrice) return;

  const newCostStr = new Decimal(latest.unitPrice).toFixed(2);
  const prevCostStr = item.cost ? new Decimal(item.cost).toFixed(2) : null;
  const newOrderFrom = latest.supplierName ?? null;

  const auditLine = buildSystemAuditLine({
    action: "SYNC_ITEM_FROM_LATEST_ORDER",
    itemSku: item.sku,
    prevCost: prevCostStr,
    newCost: newCostStr,
    prevOrderFrom: item.orderFrom ?? null,
    newOrderFrom,
    note: `latestOrder=${latest.id}`,
  });

  await tx.item.update({
    where: { id: itemId },
    data: {
      cost: latest.unitPrice,
      orderFrom: newOrderFrom,
      // tack the audit line onto latest order note so you can see *why* item changed
      inventoryOrders: {
        update: {
          where: { id: latest.id },
          data: {
            note: latest.note ? `${latest.note}\n${auditLine}` : auditLine,
          },
        },
      },
    },
  });
}

/** CREATE */
export async function createOrderAction(formData: FormData) {
  try {
    const { session } = await requireOrderHistoryEdit();

    const isNewItem = parseBool(formData.get("isNewItem"));
    let itemId = nonEmptyString(formData.get("itemId"));

    // new item fields (only required when isNewItem)
    const newSku = nonEmptyString(formData.get("newSku"));
    const newName = nonEmptyString(formData.get("newName"));
    const newPartNumber = nonEmptyString(formData.get("newPartNumber"));
    const newVendorRaw = nonEmptyString(formData.get("newVendor")); // SUCCESS_PLUS / AMERICAN_PLUS
    const newCategory = nonEmptyString(formData.get("newCategory"));
    const newManufacturer = nonEmptyString(formData.get("newManufacturer"));
    const newOrderFrom = nonEmptyString(formData.get("newOrderFrom"));
    const newWebUrl = nonEmptyString(formData.get("newWebUrl"));

    const qty = parseRequiredInt(formData.get("qty"));
    const supplierName = String(formData.get("supplierName") ?? "").trim();
    const supplierPartNumber = String(formData.get("supplierPartNumber") ?? "").trim();

    const unitPriceStr = parseRequiredMoneyString(formData.get("unitPrice"));
    const shippingCostStr = parseOptionalMoneyString(formData.get("shippingCost"));
    const taxCostStr = parseOptionalMoneyString(formData.get("taxCost"));

    const forStoreId = String(formData.get("forStoreId") ?? "").trim();
    const forUserId = String(formData.get("forUserId") ?? "").trim();

    const orderedAt = parseOptionalDateTimeLocal(formData.get("orderedAt")) ?? new Date();
    const note = String(formData.get("note") ?? "").trim();

    if (isNewItem) {
      if (!newSku) throw new Error("New item SKU is required");
      if (!newName) throw new Error("New item name is required");
    } else {
      if (!itemId) throw new Error("Missing item. Pick an item from the dropdown (or check New item).");
    }

    if (!Number.isFinite(qty) || qty <= 0) throw new Error("Invalid quantity");
    if (!unitPriceStr) throw new Error("Unit price is required");

    const createdByUserId = await resolveSessionUserId(session);
    if (!createdByUserId) throw new Error("Missing session user id");

    await prisma.$transaction(async (tx) => {
      // If this order is for a brand-new item (SKU not in list), create it first (or reuse if it exists).
      if (isNewItem) {
        const vendor = newVendorRaw === "AMERICAN_PLUS" ? "AMERICAN_PLUS" : "SUCCESS_PLUS";

        const createdOrExisting = await tx.item.upsert({
          where: { sku: newSku },
          update: {
            // Keep conservative: fill in details, but do not touch quantities here.
            name: newName,
            partNumber: newPartNumber || null,
            vendor,
            category: newCategory || null,
            manufacturer: newManufacturer || null,
            orderFrom: newOrderFrom || null,
            webUrl: newWebUrl || null,
            active: true,
          },
          create: {
            sku: newSku,
            name: newName,
            partNumber: newPartNumber || null,
            vendor,
            category: newCategory || null,
            manufacturer: newManufacturer || null,
            orderFrom: newOrderFrom || null,
            webUrl: newWebUrl || null,
            active: true,
          },
          select: { id: true, sku: true },
        });

        itemId = createdOrExisting.id;
      }

      const item = await tx.item.findUnique({
        where: { id: itemId },
        select: { id: true, sku: true, cost: true, orderFrom: true, orderedQty: true },
      });
      if (!item) throw new Error("Item not found");

      const prevCostStr = item.cost ? new Decimal(item.cost).toFixed(2) : null;
      const newCostStr = new Decimal(unitPriceStr).toFixed(2);

      const prevOrderFrom = item.orderFrom ?? null;
      const newOrderFromFinal = supplierName ? supplierName : prevOrderFrom;

      const prevOrderedQty = item.orderedQty ?? 0;
      const newOrderedQty = prevOrderedQty + qty;

      const auditLine = buildSystemAuditLine({
        action: isNewItem ? "CREATE_ITEM_FROM_ORDER" : "CREATE_ORDER",
        itemSku: item.sku,
        prevCost: prevCostStr,
        newCost: newCostStr,
        prevOrderFrom,
        newOrderFrom: newOrderFromFinal,
        prevOrderedQty,
        newOrderedQty,
        note: isNewItem
          ? "item created (or reused by sku) + item.cost updated"
          : supplierName
            ? "item.cost + item.orderFrom updated"
            : "item.cost updated",
      });

      const created = await tx.inventoryOrder.create({
        data: {
          status: "ORDERED",
          itemId,
          quantity: qty,
          unitPrice: new Decimal(unitPriceStr),
          shippingCost: shippingCostStr ? new Decimal(shippingCostStr) : null,
          taxCost: taxCostStr ? new Decimal(taxCostStr) : null,
          orderedAt,
          supplierName: supplierName || null,
          supplierPartNumber: supplierPartNumber || null,
          forStoreId: forStoreId || null,
          forUserId: forUserId || null,
          createdByUserId,
          note: note ? `${note}\n${auditLine}` : auditLine,
        },
      });

      await tx.item.update({
        where: { id: itemId },
        data: {
          orderedQty: { increment: qty },
          cost: new Decimal(unitPriceStr),
          orderFrom: supplierName ? supplierName : undefined,
        },
      });

      // If for any reason orderedAt is not the latest, keep item cost/orderFrom in sync with the latest order row.
      if (created.orderedAt.getTime() !== orderedAt.getTime()) {
        await syncItemCostAndOrderFromFromLatestOrder(tx, itemId);
      }
    });

    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/items");

    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { ok: "1" }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create order.";
    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { error: msg }));
  }
}

/** SAVE EDIT */
export async function saveOrderDetailsAction(formData: FormData) {
  try {
    await requireOrderHistoryEdit();

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing order id");

    const qty = parseRequiredInt(formData.get("qty"));
    if (!Number.isFinite(qty) || qty <= 0) throw new Error("Invalid quantity");

    const supplierName = String(formData.get("supplierName") ?? "").trim();
    const supplierPartNumber = String(formData.get("supplierPartNumber") ?? "").trim();

    const unitPriceStr = parseRequiredMoneyString(formData.get("unitPrice"));
    const shippingCostStr = parseOptionalMoneyString(formData.get("shippingCost"));
    const taxCostStr = parseOptionalMoneyString(formData.get("taxCost"));

    const forStoreId = String(formData.get("forStoreId") ?? "").trim();
    const forUserId = String(formData.get("forUserId") ?? "").trim();

    const orderedAt = parseOptionalDateTimeLocal(formData.get("orderedAt"));
    const userNote = String(formData.get("note") ?? "").trim();

    if (!unitPriceStr) throw new Error("Unit price is required");

    await prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryOrder.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          itemId: true,
          quantity: true,
          unitPrice: true,
          supplierName: true,
          note: true,
          orderedAt: true,
          forStoreId: true,
          forUserId: true,
          supplierPartNumber: true,
          shippingCost: true,
          taxCost: true,
          addedToInventoryAt: true,
        },
      });
      if (!existing) throw new Error("Order not found");

      const item = await tx.item.findUnique({
        where: { id: existing.itemId },
        select: { id: true, sku: true, cost: true, orderFrom: true, orderedQty: true, onHandQty: true },
      });
      if (!item) throw new Error("Item not found");

      const delta = qty - existing.quantity;

      // Keep inventory consistent when changing qty:
      // - ORDERED / ARRIVED => adjust Item.orderedQty by delta
      // - ADDED_TO_INVENTORY => adjust Item.onHandQty by delta
      if (delta !== 0) {
        if (existing.status === "ADDED_TO_INVENTORY") {
          if (delta < 0 && (item.onHandQty ?? 0) + delta < 0) {
            throw new Error(`Cannot change qty: Item.onHandQty (${item.onHandQty}) would go negative by applying delta (${delta}).`);
          }
          await tx.item.update({
            where: { id: existing.itemId },
            data: { onHandQty: { increment: delta } },
          });
        } else {
          if (delta < 0 && (item.orderedQty ?? 0) + delta < 0) {
            throw new Error(`Cannot change qty: Item.orderedQty (${item.orderedQty}) would go negative by applying delta (${delta}).`);
          }
          await tx.item.update({
            where: { id: existing.itemId },
            data: { orderedQty: { increment: delta } },
          });
        }
      }

      const prevCostStr = item.cost ? new Decimal(item.cost).toFixed(2) : null;
      const newCostStr = new Decimal(unitPriceStr).toFixed(2);

      const prevOrderFrom = item.orderFrom ?? null;
      const newOrderFrom = supplierName ? supplierName : prevOrderFrom;

      const auditLine = buildSystemAuditLine({
        action: "EDIT_ORDER",
        itemSku: item.sku,
        prevCost: prevCostStr,
        newCost: newCostStr,
        prevOrderFrom,
        newOrderFrom,
        note: `order=${id}`,
      });

      const mergedNote = userNote
        ? `${userNote}\n${auditLine}`
        : existing.note
          ? `${existing.note}\n${auditLine}`
          : auditLine;

      await tx.inventoryOrder.update({
        where: { id },
        data: {
          quantity: qty,
          unitPrice: new Decimal(unitPriceStr),
          shippingCost: shippingCostStr ? new Decimal(shippingCostStr) : null,
          taxCost: taxCostStr ? new Decimal(taxCostStr) : null,
          supplierName: supplierName || null,
          supplierPartNumber: supplierPartNumber || null,
          orderedAt: orderedAt ?? undefined,
          forStoreId: forStoreId || null,
          forUserId: forUserId || null,
          note: mergedNote,
        },
      });

      // Keep the Item's cost + orderFrom synced to the *latest* order for the item
      await syncItemCostAndOrderFromFromLatestOrder(tx, existing.itemId);
    });

    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/items");

    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { ok: "1" }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save order.";
    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { error: msg }));
  }
}

/** MARK ARRIVED */
export async function markArrivedAction(formData: FormData) {
  try {
    await requireOrderHistoryEdit();

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing order id");

    await prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryOrder.findUnique({
        where: { id },
        select: { id: true, status: true, itemId: true, note: true, item: { select: { sku: true } } },
      });
      if (!existing) throw new Error("Order not found");

      const auditLine = buildSystemAuditLine({
        action: "MARK_ARRIVED",
        itemSku: existing.item?.sku ?? null,
        note: `order=${id}`,
      });

      await tx.inventoryOrder.update({
        where: { id },
        data: {
          status: "ARRIVED",
          arrivedAt: new Date(),
          note: existing.note ? `${existing.note}\n${auditLine}` : auditLine,
        },
      });
    });

    revalidatePath("/admin/inventory-orders");

    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { ok: "1" }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to mark arrived.";
    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { error: msg }));
  }
}

/** ADD TO INVENTORY */
export async function addToInventoryAction(formData: FormData) {
  try {
    await requireOrderHistoryEdit();

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing order id");

    await prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryOrder.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          itemId: true,
          quantity: true,
          addedToInventoryAt: true,
          note: true,
          item: { select: { sku: true } },
        },
      });
      if (!existing) throw new Error("Order not found");
      if (existing.status === "ADDED_TO_INVENTORY") return;

      const item = await tx.item.findUnique({
        where: { id: existing.itemId },
        select: { id: true, orderedQty: true, onHandQty: true },
      });
      if (!item) throw new Error("Item not found");

      // GUARDRAIL: do not allow orderedQty to go negative from this workflow.
      if ((item.orderedQty ?? 0) < existing.quantity) {
        throw new Error(`Cannot add to inventory: Item.orderedQty (${item.orderedQty}) is less than order qty (${existing.quantity}).`);
      }

      const prevOrderedQty = item.orderedQty ?? 0;
      const newOrderedQty = prevOrderedQty - existing.quantity;
      const prevOnHand = item.onHandQty ?? 0;
      const newOnHand = prevOnHand + existing.quantity;

      const auditLine = buildSystemAuditLine({
        action: "ADD_TO_INVENTORY",
        prevOrderedQty,
        newOrderedQty,
        prevOnHandQty: prevOnHand,
        newOnHandQty: newOnHand,
        itemSku: existing.item?.sku ?? null,
        note: `order=${id}`,
      });

      await tx.item.update({
        where: { id: existing.itemId },
        data: {
          orderedQty: { decrement: existing.quantity },
          onHandQty: { increment: existing.quantity },
        },
      });

      await tx.inventoryOrder.update({
        where: { id },
        data: {
          status: "ADDED_TO_INVENTORY",
          arrivedAt: existing.status === "ORDERED" ? new Date() : undefined,
          addedToInventoryAt: existing.addedToInventoryAt ?? new Date(),
          note: existing.note ? `${existing.note}\n${auditLine}` : auditLine,
        },
      });
    });

    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/items");

    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { ok: "1" }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to add to inventory.";
    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { error: msg }));
  }
}

/** DELETE */
export async function deleteOrderAction(formData: FormData) {
  try {
    await requireOrderHistoryEdit();

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing order id");

    const confirmText = String(formData.get("confirm") ?? "").trim().toUpperCase();
    if (confirmText !== "DELETE") throw new Error('Type "DELETE" to confirm deletion.');

    await prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryOrder.findUnique({
        where: { id },
        select: { id: true, status: true, itemId: true, quantity: true, item: { select: { sku: true } } },
      });
      if (!existing) return;

      const item = await tx.item.findUnique({
        where: { id: existing.itemId },
        select: { id: true, orderedQty: true, onHandQty: true },
      });
      if (!item) throw new Error("Item not found");

      // Reverse inventory effect based on phase, but never allow negative results.
      if (existing.status === "ADDED_TO_INVENTORY") {
        if ((item.onHandQty ?? 0) < existing.quantity) {
          throw new Error(`Cannot delete: Item.onHandQty (${item.onHandQty}) is less than order qty (${existing.quantity}).`);
        }
        await tx.item.update({
          where: { id: existing.itemId },
          data: { onHandQty: { decrement: existing.quantity } },
        });
      } else {
        // ORDERED / ARRIVED => remove from orderedQty
        if ((item.orderedQty ?? 0) < existing.quantity) {
          throw new Error(`Cannot delete: Item.orderedQty (${item.orderedQty}) is less than order qty (${existing.quantity}).`);
        }
        await tx.item.update({
          where: { id: existing.itemId },
          data: { orderedQty: { decrement: existing.quantity } },
        });
      }

      await tx.inventoryOrder.delete({ where: { id } });

      // After deletion, re-sync item cost/orderFrom from latest order (if any)
      await syncItemCostAndOrderFromFromLatestOrder(tx, existing.itemId);
    });

    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/items");

    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { ok: "1" }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to delete order.";
    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { error: msg }));
  }
}