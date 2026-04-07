// app/admin/inventory-orders/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { prisma } from "@/app/lib/prisma";
import { parseItemLabelNumberSearchTerm } from "@/app/lib/item-label-number";
import { authOptions } from "@/app/lib/auth";
import { Permission, Role, InventoryOrderStatus, Prisma } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { Decimal } from "@prisma/client/runtime/library";

import ItemPicker from "./ItemPicker";
import NewItemAutoCheck from "./NewItemAutoCheck";
import OrderTotalPreview from "./OrderTotalPreview";
import SearchFilters from "./SearchFilters";
import { DEFAULT_APP_CONFIG, loadAppConfig, ORDER_HISTORY_PER_PAGE_OPTIONS, saveAppConfig } from "@/app/lib/app-config";
import {
  addToInventoryAction as addToInventoryServerAction,
  createOrderAction as createOrderServerAction,
  deleteOrderAction as deleteOrderServerAction,
  markArrivedAction as markArrivedServerAction,
  saveOrderDetailsAction as saveOrderDetailsServerAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
    name?: string | null;
  } | null;
} | null;

async function requireOrderHistoryView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return { session, perms };

  const ok = hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) redirect("/");

  return { session, perms };
}

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

type InventoryOrderPhase = InventoryOrderStatus;
const PHASES: InventoryOrderPhase[] = ["ORDERED", "ARRIVED", "ADDED_TO_INVENTORY"];

type SearchParams = {
  q?: string;
  phase?: string;
  itemId?: string;
  supplier?: string;
  forStoreId?: string;
  forUserId?: string;
  from?: string;
  to?: string;
  page?: string;
  perPage?: string;

  ok?: string;
  error?: string;
  configOk?: string;
  configError?: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
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

function parseOptionalDateOnlyToDate(v: string, endOfDay = false): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const iso = endOfDay ? `${s}T23:59:59.999` : `${s}T00:00:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseOptionalDateTimeLocal(v: FormDataEntryValue | null): Date | null {
  if (v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtLocal(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function fmtDateOnly(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

function fmtForDatetimeLocal(d: Date | null): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 16);
}

function money(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
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

function normalizeQuery(q: string): string {
  return (q ?? "")
    .normalize("NFKC")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeQuery(q: string): string[] {
  const normalized = normalizeQuery(q);
  if (!normalized) return [];
  return normalized
    .split(/[ \-]+/g)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

function variants(token: string): string[] {
  const cleaned = token
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");

  const out = new Set<string>();
  if (cleaned) out.add(cleaned);

  if (cleaned.endsWith("s") && cleaned.length > 3) {
    out.add(cleaned.slice(0, -1));
  } else if (cleaned.length > 2) {
    out.add(`${cleaned}s`);
  }

  return Array.from(out);
}

function buildOrderSearchWhere(qRaw: string): Prisma.InventoryOrderWhereInput {
  const tokens = tokenizeQuery(qRaw);
  if (tokens.length === 0) return {};

  const tokenClauses: Prisma.InventoryOrderWhereInput[] = tokens.map((tok) => {
    const vs = variants(tok);
    const labelNumber = parseItemLabelNumberSearchTerm(tok);

    const ors: Prisma.InventoryOrderWhereInput[] = vs.flatMap((v) => [
      { id: { contains: v, mode: "insensitive" } },
      { note: { contains: v, mode: "insensitive" } },
      { supplierName: { contains: v, mode: "insensitive" } },
      { supplierPartNumber: { contains: v, mode: "insensitive" } },
      { item: { id: { contains: v, mode: "insensitive" } } },
      { item: { sku: { contains: v, mode: "insensitive" } } },
      { item: { partNumber: { contains: v, mode: "insensitive" } } },
      { item: { name: { contains: v, mode: "insensitive" } } },
      { item: { category: { contains: v, mode: "insensitive" } } },
      { item: { manufacturer: { contains: v, mode: "insensitive" } } },
      { item: { orderFrom: { contains: v, mode: "insensitive" } } },
      { forStore: { name: { contains: v, mode: "insensitive" } } },
      { forUser: { name: { contains: v, mode: "insensitive" } } },
      { createdByUser: { name: { contains: v, mode: "insensitive" } } },
      { createdByUser: { email: { contains: v, mode: "insensitive" } } },
    ]);

    if (labelNumber !== null) {
      ors.push({ item: { labelNumber } });
    }

    return { OR: ors };
  });

  return { AND: tokenClauses };
}

function phaseLabel(s: InventoryOrderPhase): string {
  if (s === "ORDERED") return "ORDERED";
  if (s === "ARRIVED") return "ARRIVED";
  return "ADDED TO INVENTORY";
}

function rowPhaseStyle(phase: InventoryOrderPhase): CSSProperties {
  const orderedBg = "var(--order-ordered-bg, rgba(255, 193, 7, 0.10))";
  const arrivedBg = "var(--order-arrived-bg, rgba(33, 150, 243, 0.10))";
  const addedBg = "var(--order-added-bg, rgba(76, 175, 80, 0.12))";

  const orderedBar = "var(--order-ordered-bar, rgba(255, 193, 7, 0.55))";
  const arrivedBar = "var(--order-arrived-bar, rgba(33, 150, 243, 0.55))";
  const addedBar = "var(--order-added-bar, rgba(76, 175, 80, 0.60))";

  if (phase === "ORDERED") return { background: orderedBg, borderLeft: `6px solid ${orderedBar}` };
  if (phase === "ARRIVED") return { background: arrivedBg, borderLeft: `6px solid ${arrivedBar}` };
  return { background: addedBg, borderLeft: `6px solid ${addedBar}` };
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

  return new Decimal(unit.add(shipping.add(tax).div(qty)).toFixed(2));
}

const ORDER_INCLUDE = {
  item: { select: { id: true, sku: true, partNumber: true, name: true } },
  forStore: { select: { id: true, name: true } },
  forUser: { select: { id: true, name: true } },
  createdByUser: { select: { id: true, name: true, email: true } },
} satisfies Prisma.InventoryOrderInclude;

type OrderRow = Prisma.InventoryOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

function parseBool(v: FormDataEntryValue | null): boolean {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function nonEmptyString(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

// Client-safe item shape for ItemPicker (PLAIN JSON ONLY)
type ItemLite = {
  id: string;
  labelNumber?: number | null;
  sku: string;
  partNumber: string | null;
  name: string;
  category?: string | null;
  manufacturer?: string | null;
  orderFrom?: string | null;
};

export default async function AdminInventoryOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireOrderHistoryView();

  const sp = (await searchParams) ?? {};
  const { config: appConfig, isAvailable: appConfigAvailable } = await loadAppConfig();

  async function createOrderFormAction(formData: FormData) {
    "use server";
    await createOrderServerAction(formData);
  }

  async function saveDisplaySettingsFormAction(formData: FormData) {
    "use server";

    const h = await headers();
    const back = safeReturnToPathFromReferer(h.get("referer"));

    try {
      await requireOrderHistoryEdit();

      const retentionDays = clamp(parseRequiredInt(formData.get("liveOrdersAddedRetentionDays")) || DEFAULT_APP_CONFIG.liveOrdersAddedRetentionDays, 1, 365);
      const requestedPerPage = parseRequiredInt(formData.get("orderHistoryPerPage"));
      const orderHistoryPerPage = ORDER_HISTORY_PER_PAGE_OPTIONS.includes(requestedPerPage as (typeof ORDER_HISTORY_PER_PAGE_OPTIONS)[number])
        ? requestedPerPage
        : DEFAULT_APP_CONFIG.orderHistoryPerPage;

      const result = await saveAppConfig({
        liveOrdersAddedRetentionDays: retentionDays,
        orderHistoryPerPage,
      });

      if (!result.saved) {
        redirect(withQuery(back, { configError: "Global settings are not available until the app-config migration is applied." }));
      }

      revalidatePath("/admin/inventory-orders");
      revalidatePath("/admin/live-orders");
      revalidatePath("/employee/live-orders");
      redirect(withQuery(back, { configOk: "1" }));
    } catch (error) {
      unstable_rethrow(error);

      const msg = error instanceof Error ? error.message : "Failed to save display settings.";
      redirect(withQuery(back, { configError: msg }));
    }
  }

  async function markArrivedFormAction(formData: FormData) {
    "use server";
    await markArrivedServerAction(formData);
  }

  async function addToInventoryFormAction(formData: FormData) {
    "use server";
    await addToInventoryServerAction(formData);
  }

  async function saveOrderDetailsFormAction(formData: FormData) {
    "use server";
    await saveOrderDetailsServerAction(formData);
  }

  async function deleteOrderFormAction(formData: FormData) {
    "use server";
    await deleteOrderServerAction(formData);
  }

  const anyPrisma = prisma as unknown as { inventoryOrder?: unknown };
  if (!("inventoryOrder" in anyPrisma) || !anyPrisma.inventoryOrder) {
    return (
      <main style={{ padding: 16 }}>
        <div style={{ padding: 16, maxWidth: 1400, margin: "0 auto", color: "var(--foreground)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Admin: Order History</h1>
            <Link
              href="/admin/items"
              style={{
                padding: "8px 12px",
                borderRadius: 12,
                border: "1px solid rgba(128,128,128,0.25)",
                background: "var(--background)",
                color: "var(--foreground)",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              ← Items
            </Link>
            <Link
              href="/admin/price-lookup"
              style={{
                padding: "8px 12px",
                borderRadius: 12,
                border: "1px solid rgba(128,128,128,0.25)",
                background: "var(--background)",
                color: "var(--foreground)",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              AI Price Lookup
            </Link>
          </div>

          <div
            style={{
              marginTop: 12,
              padding: 14,
              borderRadius: 14,
              border: "1px solid rgba(128,128,128,0.25)",
              background: "var(--background)",
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Not ready yet</div>
            <div style={{ opacity: 0.85, lineHeight: 1.5 }}>
              Your app is running with a Prisma Client that does not include <code>inventoryOrder</code> yet, so this page would crash.
              <br />
              Fix: run migration + regenerate Prisma Client (or restart dev server after <code>prisma generate</code>).
            </div>
          </div>
        </div>
      </main>
    );
  }

  const q = (sp.q ?? "").trim();

  const phaseRaw = (sp.phase ?? "").trim().toUpperCase();
  const phase: InventoryOrderPhase | "" = (PHASES as readonly string[]).includes(phaseRaw) ? (phaseRaw as InventoryOrderPhase) : "";

  const itemId = (sp.itemId ?? "").trim();
  const supplier = (sp.supplier ?? "").trim();
  const forStoreId = (sp.forStoreId ?? "").trim();
  const forUserId = (sp.forUserId ?? "").trim();

  const fromStr = (sp.from ?? "").trim();
  const toStr = (sp.to ?? "").trim();
  const from = fromStr ? parseOptionalDateOnlyToDate(fromStr, false) : null;
  const to = toStr ? parseOptionalDateOnlyToDate(toStr, true) : null;

  const page = clamp(Number(sp.page ?? "1") || 1, 1, 9999);
  const perPageAllowed = new Set<number>(ORDER_HISTORY_PER_PAGE_OPTIONS);
  const perPage = perPageAllowed.has(Number(sp.perPage)) ? Number(sp.perPage) : appConfig.orderHistoryPerPage;
  const skip = (page - 1) * perPage;

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";
  const soft = "rgba(255,255,255,0.03)";

  const okMsg = (sp.ok ?? "").trim() === "1";
  const errMsg = (sp.error ?? "").trim();
  const configOkMsg = (sp.configOk ?? "").trim() === "1";
  const configErrMsg = (sp.configError ?? "").trim();

  const controlLabel: CSSProperties = { display: "grid", gap: 6, fontSize: 12, opacity: 0.9, fontWeight: 900 };
  const controlBase: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 12,
    border,
    background: surface,
    color: fg,
    outline: "none",
    fontSize: 14,
    minWidth: 0,
  };
  const btn: CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border,
    background: surface,
    color: fg,
    fontWeight: 900,
    cursor: "pointer",
    lineHeight: 1,
    whiteSpace: "nowrap",
  };
  const btnPrimary: CSSProperties = {
    ...btn,
    background: "var(--order-submit-bg, rgba(76, 175, 80, 0.18))",
    border: "1px solid var(--order-submit-border, rgba(76, 175, 80, 0.45))",
  };

  const wrapRow: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "end",
    width: "100%",
    minWidth: 0,
  };
  const flexItem = (basis: number, grow = 1): CSSProperties => ({
    flex: `${grow} 1 ${basis}px`,
    minWidth: 0,
  });

  const where: Prisma.InventoryOrderWhereInput = {};
  if (phase) where.status = phase;
  if (itemId) where.itemId = itemId;
  if (supplier) where.supplierName = { contains: supplier, mode: "insensitive" };
  if (forStoreId) where.forStoreId = forStoreId;
  if (forUserId) where.forUserId = forUserId;

  if (from || to) {
    where.orderedAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  Object.assign(where, buildOrderSearchWhere(q));

  const [itemsRaw, locations, users, total, orders] = await Promise.all([
    prisma.item.findMany({
      where: { active: true },
      orderBy: { sku: "asc" },
      select: {
        id: true,
        labelNumber: true,
        sku: true,
        partNumber: true,
        name: true,
        category: true,
        manufacturer: true,
        orderFrom: true,
      },
    }),
    prisma.location.findMany({
      where: { active: true, receiptEnabled: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, role: true },
    }),
    prisma.inventoryOrder.count({ where }),
    prisma.inventoryOrder.findMany({
      where,
      orderBy: { orderedAt: "desc" },
      take: perPage,
      skip,
      include: ORDER_INCLUDE,
    }),
  ]);

  // 🔥 IMPORTANT: make items 100% client-serializable (no Prisma prototypes)
  const pickerItems = JSON.parse(
    JSON.stringify(
      itemsRaw.map((it) => ({
        id: it.id,
        labelNumber: it.labelNumber ?? null,
        sku: it.sku,
        partNumber: it.partNumber ?? null,
        name: it.name,
        category: it.category ?? null,
        manufacturer: it.manufacturer ?? null,
        orderFrom: it.orderFrom ?? null,
      }))
    )
  ) as ItemLite[];

  const pageCount = Math.max(1, Math.ceil(total / perPage));

  async function syncItemCostAndOrderFromFromLatestOrder(tx: Prisma.TransactionClient, itemIdX: string) {
    const latest = await tx.inventoryOrder.findFirst({
      where: { itemId: itemIdX },
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
      where: { id: itemIdX },
      select: { id: true, sku: true, cost: true, orderFrom: true },
    });
    if (!item) return;

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
      where: { id: itemIdX },
      data: {
        cost: landedUnitCost,
        orderFrom: newOrderFrom,
        inventoryOrders: {
          update: {
            where: { id: latest.id },
            data: { note: latest.note ? `${latest.note}\n${auditLine}` : auditLine },
          },
        },
      },
    });
  }

  async function createOrderAction(formData: FormData) {
    "use server";

    try {
      const { session: s } = await requireOrderHistoryEdit();

      const isNewItem = parseBool(formData.get("isNewItem"));
      let pickedItemId = nonEmptyString(formData.get("itemId"));

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

      const forStoreId2 = String(formData.get("forStoreId") ?? "").trim();
      const forUserId2 = String(formData.get("forUserId") ?? "").trim();

      const orderedAt = parseOptionalDateTimeLocal(formData.get("orderedAt")) ?? new Date();
      const note = String(formData.get("note") ?? "").trim();

      if (isNewItem) {
        if (!newSku) throw new Error("New item SKU is required");
        if (!newName) throw new Error("New item name is required");
      } else {
        if (!pickedItemId) throw new Error("Missing item. Pick an item from the dropdown (or check New item).");
      }

      if (!Number.isFinite(qty) || qty <= 0) throw new Error("Invalid quantity");
      if (!unitPriceStr) throw new Error("Unit price is required");

      const createdByUserId = await resolveSessionUserId(s);
      if (!createdByUserId) throw new Error("Could not resolve your user id. (Session missing id + email lookup failed)");

      await prisma.$transaction(async (tx) => {
        let finalItemId = pickedItemId;

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
          finalItemId = createdOrExisting.id;
        }

        const item = await tx.item.findUnique({
          where: { id: finalItemId },
          select: { id: true, sku: true, cost: true, orderFrom: true, orderedQty: true },
        });
        if (!item) throw new Error("Item not found");

        const landedUnitCost = computeLandedUnitCost({
          unitPrice: unitPriceStr,
          shippingCost: shippingCostStr,
          taxCost: taxCostStr,
          quantity: qty,
        });
        const prevCostStr = item.cost ? new Decimal(item.cost).toFixed(2) : null;
        const newCostStr = landedUnitCost.toFixed(2);

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
            itemId: finalItemId,
            quantity: qty,
            unitPrice: new Decimal(unitPriceStr),
            shippingCost: shippingCostStr ? new Decimal(shippingCostStr) : null,
            taxCost: taxCostStr ? new Decimal(taxCostStr) : null,
            orderedAt,
            supplierName: supplierName || null,
            supplierPartNumber: supplierPartNumber || null,
            forStoreId: forStoreId2 || null,
            forUserId: forUserId2 || null,
            createdByUserId,
            note: note ? `${note}\n${auditLine}` : auditLine,
          },
        });

        await tx.item.update({
          where: { id: finalItemId },
          data: {
            orderedQty: { increment: qty },
            cost: landedUnitCost,
            orderFrom: supplierName ? supplierName : undefined,
          },
        });

        if (created.orderedAt.getTime() !== orderedAt.getTime()) {
          await syncItemCostAndOrderFromFromLatestOrder(tx, finalItemId);
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

  async function saveOrderDetailsAction(formData: FormData) {
    "use server";

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

    const forStoreId2 = String(formData.get("forStoreId") ?? "").trim();
    const forUserId2 = String(formData.get("forUserId") ?? "").trim();

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
        },
      });
      if (!existing) throw new Error("Order not found");

      const item = await tx.item.findUnique({
        where: { id: existing.itemId },
        select: { id: true, sku: true, cost: true, orderFrom: true, orderedQty: true, onHandQty: true },
      });
      if (!item) throw new Error("Item not found");

      const delta = qty - existing.quantity;

      if (delta !== 0) {
        if (existing.status === "ADDED_TO_INVENTORY") {
          if (delta < 0 && (item.onHandQty ?? 0) + delta < 0) {
            throw new Error(`Cannot change qty: Item.onHandQty (${item.onHandQty}) would go negative by applying delta (${delta}).`);
          }
          await tx.item.update({ where: { id: existing.itemId }, data: { onHandQty: { increment: delta } } });
        } else {
          if (delta < 0 && (item.orderedQty ?? 0) + delta < 0) {
            throw new Error(`Cannot change qty: Item.orderedQty (${item.orderedQty}) would go negative by applying delta (${delta}).`);
          }
          await tx.item.update({ where: { id: existing.itemId }, data: { orderedQty: { increment: delta } } });
        }
      }

      const landedUnitCost = computeLandedUnitCost({
        unitPrice: unitPriceStr,
        shippingCost: shippingCostStr,
        taxCost: taxCostStr,
        quantity: qty,
      });
      const prevCostStr = item.cost ? new Decimal(item.cost).toFixed(2) : null;
      const newCostStr = landedUnitCost.toFixed(2);

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

      const mergedNote = userNote ? `${userNote}\n${auditLine}` : existing.note ? `${existing.note}\n${auditLine}` : auditLine;

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
          forStoreId: forStoreId2 || null,
          forUserId: forUserId2 || null,
          note: mergedNote,
        },
      });

      await syncItemCostAndOrderFromFromLatestOrder(tx, existing.itemId);
    });

    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/items");

    const h = await headers();
    redirect(safeReturnToPathFromReferer(h.get("referer")));
  }

  async function markArrivedAction(formData: FormData) {
    "use server";

    await requireOrderHistoryEdit();

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing order id");

    await prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryOrder.findUnique({
        where: { id },
        select: { id: true, status: true, itemId: true, note: true, item: { select: { sku: true } } },
      });
      if (!existing) throw new Error("Order not found");
      if (existing.status !== "ORDERED") return;

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
    redirect(safeReturnToPathFromReferer(h.get("referer")));
  }

  async function addToInventoryAction(formData: FormData) {
    "use server";

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
      if (existing.status !== "ARRIVED") {
        throw new Error("Order must be marked as arrived before adding to inventory.");
      }

      const item = await tx.item.findUnique({
        where: { id: existing.itemId },
        select: { id: true, orderedQty: true, onHandQty: true },
      });
      if (!item) throw new Error("Item not found");

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
    });

    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/items");

    const h = await headers();
    redirect(safeReturnToPathFromReferer(h.get("referer")));
  }

  async function deleteOrderAction(formData: FormData) {
    "use server";

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

      if (existing.status === "ADDED_TO_INVENTORY") {
        if ((item.onHandQty ?? 0) < existing.quantity) {
          throw new Error(`Cannot delete: Item.onHandQty (${item.onHandQty}) is less than order qty (${existing.quantity}).`);
        }
        await tx.item.update({ where: { id: existing.itemId }, data: { onHandQty: { decrement: existing.quantity } } });
      } else {
        if ((item.orderedQty ?? 0) < existing.quantity) {
          throw new Error(`Cannot delete: Item.orderedQty (${item.orderedQty}) is less than order qty (${existing.quantity}).`);
        }
        await tx.item.update({ where: { id: existing.itemId }, data: { orderedQty: { decrement: existing.quantity } } });
      }

      await tx.inventoryOrder.delete({ where: { id } });
      await syncItemCostAndOrderFromFromLatestOrder(tx, existing.itemId);
    });

    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/items");

    const h = await headers();
    redirect(safeReturnToPathFromReferer(h.get("referer")));
  }

  function buildHref(next: Partial<SearchParams>) {
    const sp = new URLSearchParams();
    const merged: SearchParams = {
      q: q || undefined,
      phase: phase || undefined,
      itemId: itemId || undefined,
      supplier: supplier || undefined,
      forStoreId: forStoreId || undefined,
      forUserId: forUserId || undefined,
      from: fromStr || undefined,
      to: toStr || undefined,
      page: String(page),
      perPage: String(perPage),
      ...next,
    };

    for (const [k, v] of Object.entries(merged)) {
      if (v === undefined) continue;
      if (String(v).trim() === "") continue;
      sp.set(k, String(v));
    }

    const qs = sp.toString();
    return qs ? `/admin/inventory-orders?${qs}` : "/admin/inventory-orders";
  }

  const labelStyle: CSSProperties = { fontSize: 11, opacity: 0.72, fontWeight: 900, letterSpacing: "0.02em" };
  const valueStyle: CSSProperties = { fontSize: 13, fontWeight: 800, overflowWrap: "anywhere" };

  function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
        <div style={labelStyle}>{label}</div>
        <div style={valueStyle}>{children}</div>
      </div>
    );
  }

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1400, margin: "0 auto", color: fg }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Admin: Order History</h1>

          <Link
            href="/admin/items"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border,
              background: surface,
              color: fg,
              textDecoration: "none",
              fontWeight: 900,
            }}
          >
            ← Items
          </Link>

          <Link
            href="/admin/live-orders"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border,
              background: surface,
              color: fg,
              textDecoration: "none",
              fontWeight: 900,
              opacity: 0.92,
            }}
          >
            Live Orders →
          </Link>

          <Link
            href="/admin/price-lookup"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border,
              background: surface,
              color: fg,
              textDecoration: "none",
              fontWeight: 900,
              opacity: 0.92,
            }}
          >
            AI Price Lookup
          </Link>

          <Link
            href="/admin/reports"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border,
              background: surface,
              color: fg,
              textDecoration: "none",
              fontWeight: 900,
              opacity: 0.92,
            }}
          >
            Reports →
          </Link>
        </div>

        {errMsg ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 14,
              border: "1px solid rgba(244,67,54,0.45)",
              background: "rgba(244,67,54,0.10)",
              color: fg,
              fontWeight: 800,
              lineHeight: 1.4,
            }}
          >
            Error: {errMsg}
          </div>
        ) : okMsg ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 14,
              border: "1px solid rgba(76,175,80,0.45)",
              background: "rgba(76,175,80,0.10)",
              color: fg,
              fontWeight: 800,
              lineHeight: 1.4,
            }}
          >
            Order created.
          </div>
        ) : null}

        {configErrMsg ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 14,
              border: "1px solid rgba(244,67,54,0.45)",
              background: "rgba(244,67,54,0.10)",
              color: fg,
              fontWeight: 800,
              lineHeight: 1.4,
            }}
          >
            Error: {configErrMsg}
          </div>
        ) : configOkMsg ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 14,
              border: "1px solid rgba(76,175,80,0.45)",
              background: "rgba(76,175,80,0.10)",
              color: fg,
              fontWeight: 800,
              lineHeight: 1.4,
            }}
          >
            App-wide display settings saved.
          </div>
        ) : null}

        <details style={{ marginTop: 12 }}>
          <summary
            style={{
              cursor: "pointer",
              userSelect: "none",
              fontWeight: 900,
              padding: 12,
              border,
              borderRadius: 14,
              background: surface,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <span>App-Wide Display Settings</span>
            <span style={{ fontSize: 12, opacity: 0.75 }}>Click to expand</span>
          </summary>

          <div style={{ marginTop: 10, border, borderRadius: 14, background: surface, padding: 12 }}>
            <div style={{ fontWeight: 900, marginBottom: 8, fontSize: 14 }}>App-Wide Display Settings</div>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
              These values apply to everyone in the app.
              {!appConfigAvailable ? " Defaults are showing until the app-config migration is applied." : ""}
            </div>

            <form action={saveDisplaySettingsFormAction} style={{ display: "grid", gap: 10 }}>
              <div style={wrapRow}>
                <label style={{ ...controlLabel, ...flexItem(220, 0) }}>
                  Live Orders retention (days)
                  <input
                    type="number"
                    name="liveOrdersAddedRetentionDays"
                    min={1}
                    max={365}
                    defaultValue={appConfig.liveOrdersAddedRetentionDays}
                    style={controlBase}
                  />
                </label>

                <label style={{ ...controlLabel, ...flexItem(180, 0) }}>
                  Default Order History count
                  <select name="orderHistoryPerPage" defaultValue={String(appConfig.orderHistoryPerPage)} style={controlBase}>
                    {ORDER_HISTORY_PER_PAGE_OPTIONS.map((count) => (
                      <option key={count} value={String(count)}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>

                <div style={{ ...flexItem(220, 1), display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button type="submit" style={btnPrimary}>
                    Save Display Settings
                  </button>
                </div>
              </div>
            </form>
          </div>
        </details>

        {/* CREATE ORDER */}
        <details style={{ marginTop: 12 }}>
          <summary
            style={{
              cursor: "pointer",
              userSelect: "none",
              fontWeight: 900,
              padding: 12,
              border,
              borderRadius: 14,
              background: surface,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <span>Create Order</span>
            <span style={{ fontSize: 12, opacity: 0.75 }}>Click to expand</span>
          </summary>

          <div style={{ marginTop: 10, border, borderRadius: 14, background: surface, padding: 12 }}>
            <div style={{ fontWeight: 900, marginBottom: 8, fontSize: 14 }}>Create Order</div>

            <form id="create-order-form" action={createOrderFormAction} style={{ display: "grid", gap: 10 }}>
              <NewItemAutoCheck formId="create-order-form" />
              <div style={wrapRow}>
                <label style={{ display: "grid", gap: 6, fontSize: 12, opacity: 0.9, fontWeight: 900, ...flexItem(420, 3) }}>
                  Item (select existing)
                  <div style={{ marginTop: 2 }}>
                    <ItemPicker name="itemId" items={pickerItems} placeholder="Search item #, ID, SKU, part #, name, category, manufacturer…" />
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                    If you’re creating a brand-new item, use the “New item” section below instead.
                  </div>
                </label>

                <label style={{ ...controlLabel, ...flexItem(110, 0) }}>
                  Qty
                  <input name="qty" type="number" min={1} step={1} defaultValue={1} required style={controlBase} />
                </label>

                <label style={{ ...controlLabel, ...flexItem(200, 1) }}>
                  Supplier (optional)
                  <input name="supplierName" placeholder="Supplier…" style={controlBase} />
                </label>

                <label style={{ ...controlLabel, ...flexItem(220, 1) }}>
                  Supplier Part # (optional)
                  <input name="supplierPartNumber" placeholder="Supplier part #…" style={controlBase} />
                </label>

                <label style={{ ...controlLabel, ...flexItem(170, 0) }}>
                  Unit price (required)
                  <input name="unitPrice" placeholder="0.00" inputMode="decimal" required style={controlBase} />
                </label>

                <label style={{ ...controlLabel, ...flexItem(220, 0) }}>
                  Ordered at
                  <input name="orderedAt" type="datetime-local" defaultValue={fmtForDatetimeLocal(new Date())} style={controlBase} />
                </label>
              </div>

              <details style={{ marginTop: 6, border, borderRadius: 12, padding: 10, background: soft }}>
                <summary style={{ cursor: "pointer", fontWeight: 900 }}>New item (creates Item automatically if SKU doesn’t exist)</summary>
                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 900 }}>
                    <input type="checkbox" name="isNewItem" />
                    Create / use item by SKU (instead of selecting)
                  </label>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    <label style={{ ...controlLabel, ...flexItem(220, 1) }}>
                      SKU (required for new)
                      <input name="newSku" placeholder="SKU…" style={controlBase} />
                    </label>

                    <label style={{ ...controlLabel, ...flexItem(120, 0) }}>
                      Loc
                      <input name="newLoc" placeholder="03" inputMode="numeric" style={controlBase} />
                    </label>

                    <label style={{ ...controlLabel, ...flexItem(120, 0) }}>
                      Shelf
                      <input name="newShelf" placeholder="18" inputMode="numeric" style={controlBase} />
                    </label>

                    <label style={{ ...controlLabel, ...flexItem(120, 0) }}>
                      Bin
                      <input name="newBin" placeholder="02" inputMode="numeric" style={controlBase} />
                    </label>

                    <label style={{ ...controlLabel, ...flexItem(360, 2) }}>
                      Name (required for new)
                      <input name="newName" placeholder="Item name…" style={controlBase} />
                    </label>

                    <label style={{ ...controlLabel, ...flexItem(220, 1) }}>
                      Part #
                      <input name="newPartNumber" placeholder="Part number…" style={controlBase} />
                    </label>

                    <label style={{ ...controlLabel, ...flexItem(220, 0) }}>
                      Vendor
                      <select name="newVendor" defaultValue="SUCCESS_PLUS" style={controlBase}>
                        <option value="SUCCESS_PLUS">SUCCESS_PLUS</option>
                        <option value="AMERICAN_PLUS">AMERICAN_PLUS</option>
                      </select>
                    </label>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    <label style={{ ...controlLabel, ...flexItem(220, 1) }}>
                      Category
                      <input name="newCategory" placeholder="Category…" style={controlBase} />
                    </label>

                    <label style={{ ...controlLabel, ...flexItem(220, 1) }}>
                      Manufacturer
                      <input name="newManufacturer" placeholder="Manufacturer…" style={controlBase} />
                    </label>

                    <label style={{ ...controlLabel, ...flexItem(220, 1) }}>
                      Order From
                      <input name="newOrderFrom" placeholder="Order from…" style={controlBase} />
                    </label>

                    <label style={{ ...controlLabel, ...flexItem(360, 2) }}>
                      Web URL
                      <input name="newWebUrl" placeholder="https://…" style={controlBase} />
                    </label>
                  </div>
                </div>
              </details>

              <div style={wrapRow}>
                <label style={{ ...controlLabel, ...flexItem(170, 0) }}>
                  Shipping (optional)
                  <input name="shippingCost" placeholder="0.00" inputMode="decimal" style={controlBase} />
                </label>

                <label style={{ ...controlLabel, ...flexItem(150, 0) }}>
                  Tax (optional)
                  <input name="taxCost" placeholder="0.00" inputMode="decimal" style={controlBase} />
                </label>

                <label style={{ ...controlLabel, ...flexItem(240, 1) }}>
                  For tech (optional)
                  <select name="forUserId" defaultValue="" style={controlBase}>
                    <option value="">—</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role})
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ ...controlLabel, ...flexItem(240, 1) }}>
                  For store (optional)
                  <select name="forStoreId" defaultValue="" style={controlBase}>
                    <option value="">—</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ ...controlLabel, ...flexItem(420, 3) }}>
                  Note (optional)
                  <input name="note" placeholder="Optional note…" style={controlBase} />
                </label>

                <div style={{ ...flexItem(280, 1), alignSelf: "end" }}>
                  <OrderTotalPreview formId="create-order-form" />
                </div>

                <div style={{ ...flexItem(200, 0), display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button type="submit" style={btnPrimary}>
                    Create
                  </button>
                </div>
              </div>
            </form>
          </div>
        </details>

        <SearchFilters
          items={pickerItems}
          users={users.map((u) => ({ id: u.id, name: u.name, role: String(u.role) }))}
          locations={locations}
          phases={[...PHASES]}
          defaultPerPage={appConfig.orderHistoryPerPage}
          values={{
            q,
            phase,
            itemId,
            supplier,
            forUserId,
            forStoreId,
            from: fromStr,
            to: toStr,
            perPage,
          }}
          summary={{
            orders: orders.length,
            total,
            page,
            pageCount,
          }}
        />

        {/* Responsive “no overlap, no horizontal scroll” layout */}
        <style>{`
          .ordersList {
            margin-top: 14px;
            display: grid;
            gap: 12px;
          }
          .orderCard {
            border: 1px solid rgba(128,128,128,0.25);
            border-radius: 14px;
            background: var(--background);
            padding: 0;
            overflow: hidden;
          }
          .orderSummary {
            list-style: none;
            cursor: pointer;
            padding: 12px;
          }
          .orderSummary::-webkit-details-marker {
            display: none;
          }
          .orderSummaryRow {
            display: grid;
            gap: 10px;
            grid-template-columns: 1fr;
            align-items: center;
          }
          @media (min-width: 900px) {
            .orderSummaryRow {
              grid-template-columns: 170px 1fr 90px 220px;
            }
          }
          .orderExpandedBody {
            padding: 12px;
            border-top: 1px solid rgba(128,128,128,0.22);
            background: rgba(255,255,255,0.02);
          }
          .orderTop {
            display: grid;
            grid-template-columns: 1fr;
            gap: 10px;
          }
          @media (min-width: 900px) {
            .orderTop {
              grid-template-columns: 320px 1fr;
              align-items: start;
            }
          }
          .pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-weight: 900;
            font-size: 12px;
            padding: 6px 10px;
            border-radius: 999px;
            border: 1px solid rgba(128,128,128,0.25);
            background: rgba(255,255,255,0.03);
            white-space: nowrap;
          }
          .metaGrid {
            display: grid;
            gap: 10px;
            grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
            align-items: start;
          }
          .actionsRow {
            margin-top: 10px;
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            align-items: flex-start;
          }
          .noteBox {
            margin-top: 10px;
            padding: 10px;
            border-radius: 12px;
            border: 1px solid rgba(128,128,128,0.25);
            background: rgba(255,255,255,0.03);
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            word-break: break-word;
            font-size: 12px;
            opacity: 0.9;
            line-height: 1.4;
          }
          details.orderDetails > summary {
            cursor: pointer;
            font-weight: 900;
          }
        `}</style>

        {/* ORDERS */}
        <div className="ordersList">
          {orders.map((o: OrderRow) => {
            const unit = o.unitPrice ? Number(o.unitPrice) : 0;
            const ship = o.shippingCost ? Number(o.shippingCost) : 0;
            const tax = o.taxCost ? Number(o.taxCost) : 0;
            const qty = o.quantity ?? 0;
            const totalCost = unit * qty + ship + tax;
            const landedUnitCost = qty > 0 ? totalCost / qty : unit;

            const itemLabel = o.item
              ? `${o.item.sku}${o.item.partNumber ? ` • ${o.item.partNumber}` : ""} • ${o.item.name}`
              : o.itemId;
            const itemSummaryName = o.item?.name?.trim() || itemLabel;
            const itemSummarySupplier = o.supplierName?.trim() || "—";

            const canArrive = o.status === "ORDERED";
            const canAdd = o.status === "ARRIVED";
            const phaseText = phaseLabel(o.status as InventoryOrderPhase);

            return (
              <details key={o.id} className="orderCard" style={{ ...rowPhaseStyle(o.status as InventoryOrderPhase) }}>
                <summary className="orderSummary">
                  <div className="orderSummaryRow">
                    <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.88 }}>Ordered: {fmtDateOnly(o.orderedAt)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 17, fontWeight: 900, lineHeight: 1.2, overflowWrap: "anywhere" }}>{itemSummaryName}</div>
                      <div style={{ marginTop: 3, fontSize: 12, opacity: 0.78, overflowWrap: "anywhere" }}>
                        Supplier: {itemSummarySupplier} • id: {o.id}
                      </div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 950, textAlign: "left" }}>Qty: {o.quantity ?? "—"}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                      <span className="pill">{phaseText}</span>
                      <span style={{ fontSize: 12, opacity: 0.78, fontWeight: 900 }}>Click to expand</span>
                    </div>
                  </div>
                </summary>

                <div className="orderExpandedBody">
                  <div className="orderTop">
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        <span className="pill">{phaseText}</span>
                        <span className="pill">Ordered: {fmtLocal(o.orderedAt)}</span>
                      </div>

                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontSize: 16, fontWeight: 950, lineHeight: 1.2, overflowWrap: "anywhere" }}>{itemLabel}</div>
                        <div style={{ fontSize: 12, opacity: 0.75, overflowWrap: "anywhere" }}>id: {o.id}</div>
                      </div>
                    </div>

                    <div className="metaGrid">
                      <Field label="Qty">{o.quantity ?? "—"}</Field>
                      <Field label="Supplier">{o.supplierName ?? "—"}</Field>
                      <Field label="Supplier Part #">{o.supplierPartNumber ?? "—"}</Field>
                      <Field label="Vendor Unit">{o.unitPrice ? money(Number(o.unitPrice)) : "—"}</Field>
                      <Field label="Landed Cost/ea">{money(landedUnitCost)}</Field>
                      <Field label="Ship">{o.shippingCost ? money(Number(o.shippingCost)) : "—"}</Field>
                      <Field label="Tax">{o.taxCost ? money(Number(o.taxCost)) : "—"}</Field>
                      <Field label="Total">{money(totalCost)}</Field>
                      <Field label="For Tech">{o.forUser?.name ?? "—"}</Field>
                      <Field label="For Store">{o.forStore?.name ?? "—"}</Field>
                      <Field label="Arrived">{fmtLocal(o.arrivedAt)}</Field>
                      <Field label="Added">{fmtLocal(o.addedToInventoryAt)}</Field>
                    </div>
                  </div>

                  <div className="actionsRow">
                  {canArrive ? (
                    <form action={markArrivedFormAction}>
                      <input type="hidden" name="id" value={o.id} />
                      <button type="submit" style={btn}>
                        Mark Arrived
                      </button>
                    </form>
                  ) : null}

                  {canAdd ? (
                    <form action={addToInventoryFormAction}>
                      <input type="hidden" name="id" value={o.id} />
                      <button type="submit" style={btnPrimary}>
                        Add to Inventory
                      </button>
                    </form>
                  ) : null}

                  <Link
                    href={`/labels?ids=${encodeURIComponent(o.itemId)}&autoprint=1&autoclose=1`}
                    target="labels-print-popup"
                    rel="noopener noreferrer"
                    style={{ ...btn, textDecoration: "none", display: "inline-block" }}
                  >
                    Print Label
                  </Link>

                  <details className="orderDetails" style={{ border: border, borderRadius: 12, padding: 10, background: soft }}>
                    <summary>Edit</summary>
                    <form
                      action={saveOrderDetailsFormAction}
                      style={{
                        marginTop: 10,
                        padding: 10,
                        border,
                        borderRadius: 12,
                        background: surface,
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      <input type="hidden" name="id" value={o.id} />

                      <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.5 }}>
                        Item is not changeable (keeps inventory adjustments safe). Quantity edits are applied to{" "}
                        <b>{o.status === "ADDED_TO_INVENTORY" ? "on-hand" : "ordered"}</b>.
                        <br />
                        After saving, the system will sync <b>Item.cost</b> + <b>Item.orderFrom</b> from the latest order for that item.
                      </div>

                      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                        <label style={controlLabel}>
                          Ordered at
                          <input name="orderedAt" type="datetime-local" defaultValue={fmtForDatetimeLocal(o.orderedAt)} style={controlBase} />
                        </label>

                        <label style={controlLabel}>
                          Qty
                          <input name="qty" type="number" min={1} step={1} defaultValue={o.quantity ?? 1} required style={controlBase} />
                        </label>

                        <label style={controlLabel}>
                          Supplier
                          <input name="supplierName" defaultValue={o.supplierName ?? ""} placeholder="Supplier…" style={controlBase} />
                        </label>

                        <label style={controlLabel}>
                          Supplier Part #
                          <input
                            name="supplierPartNumber"
                            defaultValue={o.supplierPartNumber ?? ""}
                            placeholder="Supplier part #…"
                            style={controlBase}
                          />
                        </label>

                        <label style={controlLabel}>
                          Unit price
                          <input name="unitPrice" defaultValue={o.unitPrice ? String(o.unitPrice) : ""} placeholder="0.00" required style={controlBase} />
                        </label>

                        <label style={controlLabel}>
                          Shipping
                          <input name="shippingCost" defaultValue={o.shippingCost ? String(o.shippingCost) : ""} placeholder="0.00" style={controlBase} />
                        </label>

                        <label style={controlLabel}>
                          Tax
                          <input name="taxCost" defaultValue={o.taxCost ? String(o.taxCost) : ""} placeholder="0.00" style={controlBase} />
                        </label>

                        <label style={controlLabel}>
                          For tech
                          <select name="forUserId" defaultValue={o.forUserId ?? ""} style={controlBase}>
                            <option value="">—</option>
                            {users.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name} ({u.role})
                              </option>
                            ))}
                          </select>
                        </label>

                        <label style={controlLabel}>
                          For store
                          <select name="forStoreId" defaultValue={o.forStoreId ?? ""} style={controlBase}>
                            <option value="">—</option>
                            {locations.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <label style={controlLabel}>
                        Note
                        <input name="note" defaultValue={o.note ?? ""} placeholder="Optional note…" style={controlBase} />
                      </label>

                      <button type="submit" style={btn}>
                        Save
                      </button>
                    </form>
                  </details>

                  <details className="orderDetails" style={{ border: border, borderRadius: 12, padding: 10, background: soft }}>
                    <summary>Delete</summary>
                    <form
                      action={deleteOrderFormAction}
                      style={{
                        marginTop: 10,
                        padding: 10,
                        border,
                        borderRadius: 12,
                        background: surface,
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      <input type="hidden" name="id" value={o.id} />
                      <div style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.45 }}>
                        Type <code>DELETE</code> to confirm deletion. This reverses inventory effects for the current phase, then syncs{" "}
                        <b>Item.cost</b>/<b>Item.orderFrom</b> from the latest remaining order.
                      </div>
                      <input name="confirm" placeholder="DELETE" style={controlBase} />
                      <button type="submit" style={btn}>
                        Permanently Delete
                      </button>
                    </form>
                  </details>
                  </div>

                  {o.note ? (
                    <div className="noteBox">
                      <b>Note:</b> {o.note}
                    </div>
                  ) : null}
                </div>
              </details>
            );
          })}

          {orders.length === 0 ? (
            <div style={{ padding: 14, opacity: 0.8, border, borderRadius: 14, background: surface }}>
              No orders found.
            </div>
          ) : null}
        </div>

        {/* PAGINATION */}
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link
            href={buildHref({ page: String(Math.max(1, page - 1)) })}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border,
              background: surface,
              color: fg,
              textDecoration: "none",
              fontWeight: 900,
              opacity: page <= 1 ? 0.5 : 0.95,
              pointerEvents: page <= 1 ? "none" : "auto",
            }}
            aria-disabled={page <= 1}
            tabIndex={page <= 1 ? -1 : 0}
          >
            Prev
          </Link>

          <div style={{ fontSize: 12, opacity: 0.85 }}>
            Page <b>{page}</b> of <b>{pageCount}</b>
          </div>

          <Link
            href={buildHref({ page: String(Math.min(pageCount, page + 1)) })}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border,
              background: surface,
              color: fg,
              textDecoration: "none",
              fontWeight: 900,
              opacity: page >= pageCount ? 0.5 : 0.95,
              pointerEvents: page >= pageCount ? "none" : "auto",
            }}
            aria-disabled={page >= pageCount}
            tabIndex={page >= pageCount ? -1 : 0}
          >
            Next
          </Link>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
          Phases: <b>ORDERED</b> → <b>ARRIVED</b> → <b>ADDED TO INVENTORY</b>. Row color indicates phase. Creating an order increments{" "}
          <b>Item.orderedQty</b>. “Add to Inventory” moves qty from <b>orderedQty</b> to <b>onHandQty</b>.
        </div>
      </div>
    </main>
  );
}