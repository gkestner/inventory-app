// app/admin/inventory-orders/actions.ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { Permission, Role } from "@prisma/client";
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

async function resolveSessionUserId(session: AdminSession): Promise<string> {
  const id = session?.user?.id ?? null;
  if (id) return id;

  const email = session?.user?.email ?? null;
  if (!email) return "";

  const u = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  return u?.id ?? "";
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
  if (args.prevCost !== undefined || args.newCost !== undefined)
    parts.push(`cost:${args.prevCost ?? "—"}→${args.newCost ?? "—"}`);
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

export async function createOrderAction(formData: FormData) {
  try {
    const { session } = await requireOrderHistoryEdit();

    const isNewItem = parseBool(formData.get("isNewItem"));
    let itemId = nonEmptyString(formData.get("itemId"));

    const newSku = nonEmptyString(formData.get("newSku"));
    const newName = nonEmptyString(formData.get("newName"));
    const newPartNumber = nonEmptyString(formData.get("newPartNumber"));
    const newVendorRaw = nonEmptyString(formData.get("newVendor"));
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
    if (!createdByUserId) throw new Error("Could not resolve your user id.");

    await prisma.$transaction(async (tx) => {
      if (isNewItem) {
        const vendor = newVendorRaw === "AMERICAN_PLUS" ? "AMERICAN_PLUS" : "SUCCESS_PLUS";

        const createdOrExisting = await tx.item.upsert({
          where: { sku: newSku },
          update: {
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

      if (created.orderedAt.getTime() !== orderedAt.getTime()) {
        await syncItemCostAndOrderFromFromLatestOrder(tx, itemId);
      }
    });

    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/items");

    const h = headers(); // ✅ sync
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { ok: "1" }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create order.";
    const h = headers(); // ✅ sync
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { error: msg }));
  }
}