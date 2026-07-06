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
import { createNotificationForUsers } from "@/app/lib/workflow-foundations";
import {
  getLiveOrderNotificationStageLabel,
  getLiveOrderWaitersForOrder,
  setLiveOrderNotificationPreference,
  type LiveOrderNotificationStage,
} from "@/app/lib/live-order-notifications";

const BUSINESS_TIME_ZONE = "America/New_York";
const EDITABLE_ORDER_STATUSES = ["ORDERED", "ARRIVED", "ADDED_TO_INVENTORY"] as const;
type EditableOrderStatus = (typeof EDITABLE_ORDER_STATUSES)[number];

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

  const uByExact = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (uByExact?.id) return uByExact.id;

  const uByInsensitive = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  return uByInsensitive?.id ?? "";
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

function stringFormValue(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (raw === null) return undefined;
  const value = String(raw).trim();
  return value ? value.slice(0, 500) : undefined;
}

function createOrderFormStateQuery(formData: FormData): Record<string, string | undefined> {
  const fields = [
    "itemId",
    "qty",
    "supplierName",
    "supplierPartNumber",
    "unitPrice",
    "orderedAt",
    "newSku",
    "newLoc",
    "newShelf",
    "newBin",
    "newName",
    "newPartNumber",
    "newVendor",
    "newCategory",
    "newManufacturer",
    "newOrderFrom",
    "newWebUrl",
    "shippingCost",
    "taxCost",
    "forUserId",
    "forStoreId",
    "note",
  ] as const;

  const hasNewItemDraft = Boolean(
    formData.get("isNewItem") ||
      stringFormValue(formData, "newSku") ||
      stringFormValue(formData, "newLoc") ||
      stringFormValue(formData, "newShelf") ||
      stringFormValue(formData, "newBin") ||
      stringFormValue(formData, "newName") ||
      stringFormValue(formData, "newPartNumber"),
  );

  const out: Record<string, string | undefined> = {
    createOrderOpen: "1",
    newItemOpen: hasNewItemDraft ? "1" : undefined,
    isNewItem: formData.get("isNewItem") ? "1" : undefined,
  };

  for (const field of fields) {
    out[`draft_${field}`] = stringFormValue(formData, field);
  }

  return out;
}

function revalidateTouchedItemPaths(itemId: string | null | undefined) {
  if (!itemId) return;
  revalidatePath(`/admin/items/${itemId}`);
  revalidatePath(`/admin/items/${itemId}/inventory`);
}

function isRedirectLikeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
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

  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})$/.exec(s);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  const naiveUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
  const guess = new Date(naiveUTC);
  const offsetMin = tzOffsetMinutes(guess, BUSINESS_TIME_ZONE);
  const out = new Date(naiveUTC - offsetMin * 60000);
  return Number.isNaN(out.getTime()) ? null : out;
}

function tzOffsetMinutes(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const get = (type: string) => {
    const p = parts.find((x) => x.type === type)?.value;
    return p ? Number(p) : NaN;
  };
  const y = get("year");
  const mo = get("month");
  const da = get("day");
  const h = get("hour");
  const mi = get("minute");
  const se = get("second");
  const asUTC = Date.UTC(y, mo - 1, da, h, mi, se);
  return Math.round((asUTC - at.getTime()) / 60000);
}

function parseBool(v: FormDataEntryValue | null): boolean {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function normalizeSupplierNameInput(value: FormDataEntryValue | null): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

async function resolveCanonicalSupplierName(tx: Prisma.TransactionClient, rawSupplierName: string): Promise<string> {
  const normalized = rawSupplierName.trim().replace(/\s+/g, " ");
  if (!normalized) return "";

  const existingOrder = await tx.inventoryOrder.findFirst({
    where: {
      supplierName: {
        equals: normalized,
        mode: "insensitive",
      },
    },
    orderBy: {
      orderedAt: "desc",
    },
    select: {
      supplierName: true,
    },
  });
  if (existingOrder?.supplierName?.trim()) {
    return existingOrder.supplierName.trim().replace(/\s+/g, " ");
  }

  const existingItem = await tx.item.findFirst({
    where: {
      orderFrom: {
        equals: normalized,
        mode: "insensitive",
      },
    },
    select: {
      orderFrom: true,
    },
  });
  if (existingItem?.orderFrom?.trim()) {
    return existingItem.orderFrom.trim().replace(/\s+/g, " ");
  }

  return normalized;
}

function nonEmptyString(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

function parseEditableOrderStatus(v: FormDataEntryValue | null, fallback: EditableOrderStatus): EditableOrderStatus {
  const raw = String(v ?? "").trim().toUpperCase();
  if ((EDITABLE_ORDER_STATUSES as readonly string[]).includes(raw)) return raw as EditableOrderStatus;
  return fallback;
}

function orderedQtyEffect(status: string, quantity: number): number {
  return status === "ORDERED" || status === "ARRIVED" ? quantity : 0;
}

function onHandQtyEffect(status: string, quantity: number): number {
  return status === "ADDED_TO_INVENTORY" ? quantity : 0;
}

function parseTwoDigitSkuPart(raw: FormDataEntryValue | null, label: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (!/^\d{1,2}$/.test(s)) throw new Error(`${label} must be 1-2 digits.`);
  return s.padStart(2, "0");
}

function buildSkuPrefix(loc: string, shelf: string, bin: string): string {
  return `${loc}${shelf}${bin}`;
}

function buildSkuKeyCandidates(itemId: string): string[] {
  const compact = itemId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const lengths = [6, 8, 10, 12, compact.length];
  const out: string[] = [];
  for (const len of lengths) {
    const key = compact.slice(-Math.max(1, len));
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

async function buildUniqueGeneratedSku(
  tx: Prisma.TransactionClient,
  itemId: string,
  loc: string,
  shelf: string,
  bin: string,
): Promise<string> {
  const prefix = buildSkuPrefix(loc, shelf, bin);
  const candidates = buildSkuKeyCandidates(itemId);

  for (const key of candidates) {
    const sku = `${prefix} - ${key}`;
    const existing = await tx.item.findFirst({
      where: {
        sku,
        NOT: { id: itemId },
      },
      select: { id: true },
    });
    if (!existing) return sku;
  }

  return `${prefix} - ${itemId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`;
}

function applySkuMiddleFromParts(skuRaw: string, loc: string, shelf: string, bin: string): string {
  if (!loc && !shelf && !bin) return skuRaw;

  if (!loc || !shelf || !bin) {
    throw new Error("Loc, Shelf, and Bin are all required when setting SKU location fields.");
  }

  const parts = String(skuRaw).trim().split("-");
  if (parts.length < 3) return skuRaw;

  parts[1] = `${loc}${shelf}${bin}`;
  return parts.join("-");
}

function buildSystemAuditLine(args: {
  action:
    | "CREATE_ORDER"
    | "EDIT_ORDER"
    | "MARK_ARRIVED"
    | "ADD_TO_INVENTORY"
    | "CANCEL_ORDER"
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

function computeLandedUnitCost(args: {
  unitPrice: Decimal | string | number;
  shippingCost?: Decimal | string | number | null;
  taxCost?: Decimal | string | number | null;
  quantity: number;
}): Decimal {
  const unit = new Decimal(args.unitPrice);
  const shipping = args.shippingCost ? new Decimal(args.shippingCost) : new Decimal(0);
  const tax = args.taxCost ? new Decimal(args.taxCost) : new Decimal(0);
  const qty = Number.isFinite(args.quantity) && args.quantity > 0 ? Math.trunc(args.quantity) : 1;

  // Item.cost stores landed per-unit cost.
  return new Decimal(unit.add(shipping.add(tax).div(qty)).toFixed(2));
}

function buildLiveOrderNotificationPayload(args: {
  stage: LiveOrderNotificationStage;
  orderId: string;
  itemName: string | null | undefined;
  itemSku: string | null | undefined;
}): { title: string; body: string; href: string } {
  const itemName = String(args.itemName ?? "").trim() || "Your order";
  const itemSku = String(args.itemSku ?? "").trim();
  const stageLabel = getLiveOrderNotificationStageLabel(args.stage);
  const title = `${itemName} ${stageLabel}`;
  const body = itemSku
    ? `${itemName} (${itemSku}) has ${stageLabel}.`
    : `${itemName} has ${stageLabel}.`;

  return {
    title,
    body,
    href: "/employee/live-orders",
  };
}

async function syncItemCostAndOrderFromFromLatestOrder(tx: Prisma.TransactionClient, itemId: string) {
  const latest = await tx.inventoryOrder.findFirst({
    where: { itemId, status: { not: "CANCELLED" } },
    orderBy: { orderedAt: "desc" },
    select: {
      id: true,
      unitPrice: true,
      shippingCost: true,
      taxCost: true,
      quantity: true,
      supplierName: true,
      orderedAt: true,
      note: true,
    },
  });

  if (!latest) return;

  const item = await tx.item.findUnique({
    where: { id: itemId },
    select: { id: true, sku: true, cost: true, orderFrom: true },
  });
  if (!item) return;

  // Only update if we have a cost value.
  if (!latest.unitPrice) return;

  const landedUnitCost = computeLandedUnitCost({
    unitPrice: latest.unitPrice,
    shippingCost: latest.shippingCost,
    taxCost: latest.taxCost,
    quantity: latest.quantity,
  });
  const newCostStr = landedUnitCost.toFixed(2);
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
      cost: landedUnitCost,
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

    const requestedNewItem = parseBool(formData.get("isNewItem"));
    let itemId = nonEmptyString(formData.get("itemId"));

    // new item fields (only required when isNewItem)
    const newSkuRaw = nonEmptyString(formData.get("newSku"));
    const newName = nonEmptyString(formData.get("newName"));
    const newPartNumber = nonEmptyString(formData.get("newPartNumber"));
    const newVendorRaw = nonEmptyString(formData.get("newVendor")); // SUCCESS_PLUS / AMERICAN_PLUS
    const newCategory = nonEmptyString(formData.get("newCategory"));
    const newManufacturer = nonEmptyString(formData.get("newManufacturer"));
    const newOrderFrom = nonEmptyString(formData.get("newOrderFrom"));
    const newWebUrl = nonEmptyString(formData.get("newWebUrl"));
    const newLoc = parseTwoDigitSkuPart(formData.get("newLoc"), "Loc");
    const newShelf = parseTwoDigitSkuPart(formData.get("newShelf"), "Shelf");
    const newBin = parseTwoDigitSkuPart(formData.get("newBin"), "Bin");
    const newSku = applySkuMiddleFromParts(newSkuRaw, newLoc, newShelf, newBin);

    // If users fill New item fields but forget the checkbox, still treat submit as a new-item flow.
    const hasNewItemSignals = Boolean(newSkuRaw || newName || newPartNumber || newLoc || newShelf || newBin);
    const isNewItem = requestedNewItem || (!itemId && hasNewItemSignals);

    const supplierName = normalizeSupplierNameInput(formData.get("supplierName"));
    const shippingCostStr = parseOptionalMoneyString(formData.get("shippingCost"));
    const taxCostStr = parseOptionalMoneyString(formData.get("taxCost"));

    const forStoreId = String(formData.get("forStoreId") ?? "").trim();
    const forUserId = String(formData.get("forUserId") ?? "").trim();

    const orderedAt = parseOptionalDateTimeLocal(formData.get("orderedAt")) ?? new Date();
    const note = String(formData.get("note") ?? "").trim();

    const lineItemIds = isNewItem ? [] : formData.getAll("itemId").map((v) => String(v).trim());
    const lineQtys = formData.getAll("qty");
    const lineSupplierPartNumbers = formData.getAll("supplierPartNumber");
    const lineUnitPrices = formData.getAll("unitPrice");
    const existingItemLines = lineItemIds
      .map((lineItemId, index) => ({
        itemId: lineItemId,
        qty: parseRequiredInt(lineQtys[index] ?? null),
        supplierPartNumber: String(lineSupplierPartNumbers[index] ?? "").trim(),
        unitPriceStr: parseRequiredMoneyString(lineUnitPrices[index] ?? null),
      }))
      .filter((line) => line.itemId || Number.isFinite(line.qty) || line.unitPriceStr || line.supplierPartNumber);

    const qty = isNewItem ? parseRequiredInt(formData.get("qty")) : 0;
    const supplierPartNumber = isNewItem ? String(formData.get("supplierPartNumber") ?? "").trim() : "";
    const unitPriceStr = isNewItem ? parseRequiredMoneyString(formData.get("unitPrice")) : "";

    if (isNewItem) {
      if (!newSku && (!newLoc || !newShelf || !newBin)) {
        throw new Error("Loc, Shelf, and Bin are required when SKU is blank.");
      }
      if (!newName) throw new Error("New item name is required");
    } else {
      if (existingItemLines.length === 0) throw new Error("Missing item. Pick at least one item from the dropdown (or check New item).");
    }

    if (isNewItem) {
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("Invalid quantity");
      if (!unitPriceStr) throw new Error("Unit price is required");
    } else {
      for (const [index, line] of existingItemLines.entries()) {
        if (!line.itemId) throw new Error(`Missing item on line ${index + 1}.`);
        if (!Number.isFinite(line.qty) || line.qty <= 0) throw new Error(`Invalid quantity on line ${index + 1}.`);
        if (!line.unitPriceStr) throw new Error(`Unit price is required on line ${index + 1}.`);
      }
    }

    const createdByUserId = await resolveSessionUserId(session);
    if (!createdByUserId) throw new Error("Missing session user id");

    let touchedItemId: string | null = null;

    await prisma.$transaction(async (tx) => {
      const canonicalSupplierName = await resolveCanonicalSupplierName(tx, supplierName);

      // If this order is for a brand-new item (SKU not in list), create it first (or reuse if it exists).
      if (isNewItem) {
        const vendor = newVendorRaw === "AMERICAN_PLUS" ? "AMERICAN_PLUS" : "SUCCESS_PLUS";
        if (newSku) {
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
        } else {
          const created = await tx.item.create({
            data: {
              sku: `PENDING-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
              name: newName,
              partNumber: newPartNumber || null,
              vendor,
              category: newCategory || null,
              manufacturer: newManufacturer || null,
              orderFrom: newOrderFrom || null,
              webUrl: newWebUrl || null,
              active: true,
            },
            select: { id: true },
          });

          const generatedSku = await buildUniqueGeneratedSku(tx, created.id, newLoc, newShelf, newBin);
          const finalized = await tx.item.update({
            where: { id: created.id },
            data: { sku: generatedSku },
            select: { id: true },
          });

          itemId = finalized.id;
        }
      }

      const baseLines = isNewItem ? [{ itemId, qty, supplierPartNumber, unitPriceStr }] : existingItemLines;
      const subtotal = baseLines.reduce(
        (sum, line) => sum.add(new Decimal(line.unitPriceStr).mul(line.qty)),
        new Decimal(0),
      );
      const totalShipping = shippingCostStr ? new Decimal(shippingCostStr) : new Decimal(0);
      const totalTax = taxCostStr ? new Decimal(taxCostStr) : new Decimal(0);
      let allocatedShipping = new Decimal(0);
      let allocatedTax = new Decimal(0);
      const lines = baseLines.map((line, index) => {
        const isLast = index === baseLines.length - 1;
        const lineSubtotal = new Decimal(line.unitPriceStr).mul(line.qty);
        const ratio = subtotal.gt(0) ? lineSubtotal.div(subtotal) : new Decimal(0);
        const shipping = isLast ? totalShipping.sub(allocatedShipping) : new Decimal(totalShipping.mul(ratio).toFixed(2));
        const tax = isLast ? totalTax.sub(allocatedTax) : new Decimal(totalTax.mul(ratio).toFixed(2));
        allocatedShipping = allocatedShipping.add(shipping);
        allocatedTax = allocatedTax.add(tax);
        return {
          ...line,
          shippingCostStr: shipping.gt(0) ? shipping.toFixed(2) : null,
          taxCostStr: tax.gt(0) ? tax.toFixed(2) : null,
        };
      });

      for (const line of lines) {
        const item = await tx.item.findUnique({
          where: { id: line.itemId },
          select: { id: true, sku: true, cost: true, orderFrom: true, orderedQty: true },
        });
        if (!item) throw new Error("Item not found");

        const prevCostStr = item.cost ? new Decimal(item.cost).toFixed(2) : null;
        const landedUnitCost = computeLandedUnitCost({
          unitPrice: line.unitPriceStr,
          shippingCost: line.shippingCostStr,
          taxCost: line.taxCostStr,
          quantity: line.qty,
        });
        const newCostStr = landedUnitCost.toFixed(2);

        const prevOrderFrom = item.orderFrom ?? null;
        const newOrderFromFinal = canonicalSupplierName ? canonicalSupplierName : prevOrderFrom;

        const prevOrderedQty = item.orderedQty ?? 0;
        const newOrderedQty = prevOrderedQty + line.qty;

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
            : canonicalSupplierName
              ? "item.cost + item.orderFrom updated"
              : "item.cost updated",
        });

        const created = await tx.inventoryOrder.create({
          data: {
            status: "ORDERED",
            itemId: line.itemId,
            quantity: line.qty,
            unitPrice: new Decimal(line.unitPriceStr),
            shippingCost: line.shippingCostStr ? new Decimal(line.shippingCostStr) : null,
            taxCost: line.taxCostStr ? new Decimal(line.taxCostStr) : null,
            orderedAt,
            supplierName: canonicalSupplierName || null,
            supplierPartNumber: line.supplierPartNumber || null,
            forStoreId: forStoreId || null,
            forUserId: forUserId || null,
            createdByUserId,
            note: note ? `${note}\n${auditLine}` : auditLine,
          },
        });

        await tx.item.update({
          where: { id: line.itemId },
          data: {
            orderedQty: { increment: line.qty },
            cost: landedUnitCost,
            orderFrom: canonicalSupplierName ? canonicalSupplierName : undefined,
          },
        });

        if (created.orderedAt.getTime() !== orderedAt.getTime()) {
          await syncItemCostAndOrderFromFromLatestOrder(tx, line.itemId);
        }

        touchedItemId = line.itemId;
      }
    });

    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/items");
    revalidateTouchedItemPaths(touchedItemId);
    revalidatePath("/admin/live-orders");
    revalidatePath("/employee/live-orders");

    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { ok: "1" }));
  } catch (e) {
    if (isRedirectLikeError(e)) throw e;
    const msg = e instanceof Error ? e.message : "Failed to create order.";
    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { error: msg, ...createOrderFormStateQuery(formData) }));
  }
}

/** CANCEL */
export async function cancelOrderAction(formData: FormData) {
  try {
    await requireOrderHistoryEdit();

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing order id");

    const reason = String(formData.get("cancelReason") ?? "").trim();
    if (!reason) throw new Error("Cancellation reason is required.");

    let touchedItemId: string | null = null;

    await prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryOrder.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          itemId: true,
          quantity: true,
          note: true,
          item: { select: { sku: true } },
        },
      });
      if (!existing) throw new Error("Order not found");
      if (existing.status === "CANCELLED") return;

      const item = await tx.item.findUnique({
        where: { id: existing.itemId },
        select: { id: true, orderedQty: true, onHandQty: true },
      });
      if (!item) throw new Error("Item not found");

      if (existing.status === "ADDED_TO_INVENTORY") {
        if ((item.onHandQty ?? 0) < existing.quantity) {
          throw new Error(`Cannot cancel: Item.onHandQty (${item.onHandQty}) is less than order qty (${existing.quantity}).`);
        }
        await tx.item.update({
          where: { id: existing.itemId },
          data: { onHandQty: { decrement: existing.quantity } },
        });
      } else {
        if ((item.orderedQty ?? 0) < existing.quantity) {
          throw new Error(`Cannot cancel: Item.orderedQty (${item.orderedQty}) is less than order qty (${existing.quantity}).`);
        }
        await tx.item.update({
          where: { id: existing.itemId },
          data: { orderedQty: { decrement: existing.quantity } },
        });
      }

      const auditLine = buildSystemAuditLine({
        action: "CANCEL_ORDER",
        itemSku: existing.item?.sku ?? null,
        note: `order=${id}; reason=${reason}`,
      });

      await tx.inventoryOrder.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelReason: reason,
          note: existing.note ? `${existing.note}\n${auditLine}` : auditLine,
        },
      });

      await syncItemCostAndOrderFromFromLatestOrder(tx, existing.itemId);
      touchedItemId = existing.itemId;
    });

    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/items");
    revalidateTouchedItemPaths(touchedItemId);
    revalidatePath("/admin/live-orders");
    revalidatePath("/employee/live-orders");

    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { ok: "1" }));
  } catch (e) {
    if (isRedirectLikeError(e)) throw e;
    const msg = e instanceof Error ? e.message : "Failed to cancel order.";
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

    const supplierName = normalizeSupplierNameInput(formData.get("supplierName"));
    const supplierPartNumber = String(formData.get("supplierPartNumber") ?? "").trim();

    const unitPriceStr = parseRequiredMoneyString(formData.get("unitPrice"));
    const shippingCostStr = parseOptionalMoneyString(formData.get("shippingCost"));
    const taxCostStr = parseOptionalMoneyString(formData.get("taxCost"));

    const forStoreId = String(formData.get("forStoreId") ?? "").trim();
    const forUserId = String(formData.get("forUserId") ?? "").trim();

    const orderedAt = parseOptionalDateTimeLocal(formData.get("orderedAt"));
    const userNote = String(formData.get("note") ?? "").trim();

    if (!unitPriceStr) throw new Error("Unit price is required");

    let touchedItemId: string | null = null;

    await prisma.$transaction(async (tx) => {
      const canonicalSupplierName = await resolveCanonicalSupplierName(tx, supplierName);

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
          arrivedAt: true,
          addedToInventoryAt: true,
        },
      });
      if (!existing) throw new Error("Order not found");
      if (existing.status === "CANCELLED") throw new Error("Cancelled orders cannot be edited.");

      const item = await tx.item.findUnique({
        where: { id: existing.itemId },
        select: { id: true, sku: true, cost: true, orderFrom: true, orderedQty: true, onHandQty: true },
      });
      if (!item) throw new Error("Item not found");

      const currentStatus = existing.status as EditableOrderStatus;
      const nextStatus = parseEditableOrderStatus(formData.get("status"), currentStatus);
      const orderedQtyDelta = orderedQtyEffect(nextStatus, qty) - orderedQtyEffect(currentStatus, existing.quantity);
      const onHandQtyDelta = onHandQtyEffect(nextStatus, qty) - onHandQtyEffect(currentStatus, existing.quantity);

      if (orderedQtyDelta !== 0 || onHandQtyDelta !== 0) {
        const nextOrderedQty = (item.orderedQty ?? 0) + orderedQtyDelta;
        const nextOnHandQty = (item.onHandQty ?? 0) + onHandQtyDelta;
        if (nextOrderedQty < 0) {
          throw new Error(`Cannot save: Item.orderedQty (${item.orderedQty}) would go negative by applying delta (${orderedQtyDelta}).`);
        }
        if (nextOnHandQty < 0) {
          throw new Error(`Cannot save: Item.onHandQty (${item.onHandQty}) would go negative by applying delta (${onHandQtyDelta}).`);
        }

        await tx.item.update({
          where: { id: existing.itemId },
          data: {
            orderedQty: { increment: orderedQtyDelta },
            onHandQty: { increment: onHandQtyDelta },
          },
        });
      }

      const prevCostStr = item.cost ? new Decimal(item.cost).toFixed(2) : null;
      const landedUnitCost = computeLandedUnitCost({
        unitPrice: unitPriceStr,
        shippingCost: shippingCostStr,
        taxCost: taxCostStr,
        quantity: qty,
      });
      const newCostStr = landedUnitCost.toFixed(2);

      const prevOrderFrom = item.orderFrom ?? null;
      const newOrderFrom = canonicalSupplierName ? canonicalSupplierName : prevOrderFrom;

      const auditLine = buildSystemAuditLine({
        action: "EDIT_ORDER",
        itemSku: item.sku,
        prevCost: prevCostStr,
        newCost: newCostStr,
        prevOrderFrom,
        newOrderFrom,
        prevOrderedQty: item.orderedQty ?? 0,
        newOrderedQty: (item.orderedQty ?? 0) + orderedQtyDelta,
        prevOnHandQty: item.onHandQty ?? 0,
        newOnHandQty: (item.onHandQty ?? 0) + onHandQtyDelta,
        note: `order=${id}; status:${currentStatus}->${nextStatus}`,
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
          status: nextStatus,
          arrivedAt: nextStatus === "ORDERED" ? null : nextStatus === "ARRIVED" || nextStatus === "ADDED_TO_INVENTORY" ? existing.arrivedAt ?? new Date() : undefined,
          addedToInventoryAt: nextStatus === "ADDED_TO_INVENTORY" ? existing.addedToInventoryAt ?? new Date() : null,
          cancelledAt: null,
          cancelReason: null,
          supplierName: canonicalSupplierName || null,
          supplierPartNumber: supplierPartNumber || null,
          orderedAt: orderedAt ?? undefined,
          forStoreId: forStoreId || null,
          forUserId: forUserId || null,
          note: mergedNote,
        },
      });

      // Keep the Item's cost + orderFrom synced to the *latest* order for the item
      await syncItemCostAndOrderFromFromLatestOrder(tx, existing.itemId);

      touchedItemId = existing.itemId;
    });

    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/items");
    revalidateTouchedItemPaths(touchedItemId);
    revalidatePath("/admin/live-orders");
    revalidatePath("/employee/live-orders");

    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { ok: "1" }));
  } catch (e) {
    if (isRedirectLikeError(e)) throw e;
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

    const notification = await prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryOrder.findUnique({
        where: { id },
        select: { id: true, status: true, itemId: true, note: true, item: { select: { sku: true, name: true } } },
      });
      if (!existing) throw new Error("Order not found");
      if (existing.status !== "ORDERED") return null;

      const waitlistUsers = await tx.user.findMany({
        where: { active: true },
        select: { id: true, name: true, uiPreferences: true },
      });
      const waiters = getLiveOrderWaitersForOrder(waitlistUsers, existing.id);

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

      if (waiters.length === 0) return null;

      return {
        userIds: waiters.map((waiter) => waiter.id),
        ...buildLiveOrderNotificationPayload({
          stage: "ARRIVED",
          orderId: existing.id,
          itemName: existing.item?.name,
          itemSku: existing.item?.sku,
        }),
      };
    });

    if (notification) {
      await createNotificationForUsers({
        userIds: notification.userIds,
        title: notification.title,
        body: notification.body,
        href: notification.href,
        type: "SYSTEM",
      });
    }

    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/live-orders");
    revalidatePath("/employee/live-orders");

    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { ok: "1" }));
  } catch (e) {
    if (isRedirectLikeError(e)) throw e;
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

    let touchedItemId: string | null = null;

    const notification = await prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryOrder.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          itemId: true,
          quantity: true,
          addedToInventoryAt: true,
          note: true,
          item: { select: { sku: true, name: true } },
        },
      });
      if (!existing) throw new Error("Order not found");
      if (existing.status === "ADDED_TO_INVENTORY") return null;
      if (existing.status !== "ARRIVED") {
        throw new Error("Order must be marked as arrived before adding to inventory.");
      }

      const waitlistUsers = await tx.user.findMany({
        where: { active: true },
        select: { id: true, name: true, uiPreferences: true },
      });
      const waiters = getLiveOrderWaitersForOrder(waitlistUsers, existing.id);

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
          addedToInventoryAt: existing.addedToInventoryAt ?? new Date(),
          note: existing.note ? `${existing.note}\n${auditLine}` : auditLine,
        },
      });

      for (const waiter of waiters) {
        await tx.user.update({
          where: { id: waiter.id },
          data: {
            uiPreferences: setLiveOrderNotificationPreference(
              waitlistUsers.find((user) => user.id === waiter.id)?.uiPreferences,
              existing.id,
              false,
            ),
          },
        });
      }

      touchedItemId = existing.itemId;

      if (waiters.length === 0) return null;

      return {
        userIds: waiters.map((waiter) => waiter.id),
        ...buildLiveOrderNotificationPayload({
          stage: "ADDED_TO_INVENTORY",
          orderId: existing.id,
          itemName: existing.item?.name,
          itemSku: existing.item?.sku,
        }),
      };
    });

    if (notification) {
      await createNotificationForUsers({
        userIds: notification.userIds,
        title: notification.title,
        body: notification.body,
        href: notification.href,
        type: "SYSTEM",
      });
    }

    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/items");
    revalidateTouchedItemPaths(touchedItemId);
    revalidatePath("/admin/live-orders");
    revalidatePath("/employee/live-orders");

    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { ok: "1" }));
  } catch (e) {
    if (isRedirectLikeError(e)) throw e;
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

    let touchedItemId: string | null = null;

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
      if (existing.status === "CANCELLED") {
        // Cancelled rows have already had their inventory effect reversed.
      } else if (existing.status === "ADDED_TO_INVENTORY") {
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

      touchedItemId = existing.itemId;
    });

    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/items");
    revalidateTouchedItemPaths(touchedItemId);

    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { ok: "1" }));
  } catch (e) {
    if (isRedirectLikeError(e)) throw e;
    const msg = e instanceof Error ? e.message : "Failed to delete order.";
    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));
    redirect(withQuery(back, { error: msg }));
  }
}
