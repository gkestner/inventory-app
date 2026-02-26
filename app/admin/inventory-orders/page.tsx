// app/admin/inventory-orders/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { Permission, Role, InventoryOrderStatus, Prisma } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { Decimal } from "@prisma/client/runtime/library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

async function requireOrderHistoryView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return { session, perms };

  // Reuse Items Admin view permission for Order History module
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

type InventoryOrderPhase = InventoryOrderStatus;
const PHASES: InventoryOrderPhase[] = ["ORDERED", "ARRIVED", "ADDED_TO_INVENTORY"];

type SearchParams = {
  q?: string;
  phase?: string;
  itemId?: string;
  supplier?: string;
  forStoreId?: string;
  forUserId?: string;
  from?: string; // yyyy-mm-dd
  to?: string; // yyyy-mm-dd
  page?: string; // 1-based
  perPage?: string; // 10/25/50/100
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
    | "SYNC_ITEM_FROM_LATEST_ORDER";
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

const ORDER_INCLUDE = {
  item: { select: { id: true, sku: true, partNumber: true, name: true } },
  forStore: { select: { id: true, name: true } },
  forUser: { select: { id: true, name: true } },
  createdByUser: { select: { id: true, name: true, email: true } },
} satisfies Prisma.InventoryOrderInclude;

type OrderRow = Prisma.InventoryOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

export default async function AdminInventoryOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireOrderHistoryView();

  // IMPORTANT: prisma is a Proxy (lazy client). The `in` operator checks the Proxy TARGET ({}),
  // not the real PrismaClient, because we don't define a `has` trap. So using `"inventoryOrder" in prisma`
  // will incorrectly return false forever.
  //
  // We still must NOT touch Prisma during build-time evaluation (your prisma.ts intentionally throws).
  const isBuildTimeEvaluation =
    process.env.npm_lifecycle_event === "build" || process.env.NEXT_PHASE === "phase-production-build";

  if (isBuildTimeEvaluation) {
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
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Not ready during build</div>
            <div style={{ opacity: 0.85, lineHeight: 1.5 }}>
              This route was evaluated during build-time. Prisma access is intentionally blocked during build to prevent crashes.
              <br />
              This is expected during build; at runtime the page will load normally.
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Runtime: safely check the delegate by actually reading it (triggers Proxy get → real PrismaClient).
  let inventoryOrderDelegate: unknown = null;
  try {
    inventoryOrderDelegate = (prisma as unknown as Record<string, unknown>)["inventoryOrder"];
  } catch {
    inventoryOrderDelegate = null;
  }

  if (!inventoryOrderDelegate) {
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

  const q = (searchParams.q ?? "").trim();

  const phaseRaw = (searchParams.phase ?? "").trim().toUpperCase();
  const phase: InventoryOrderPhase | "" = (PHASES as readonly string[]).includes(phaseRaw) ? (phaseRaw as InventoryOrderPhase) : "";

  const itemId = (searchParams.itemId ?? "").trim();
  const supplier = (searchParams.supplier ?? "").trim();
  const forStoreId = (searchParams.forStoreId ?? "").trim();
  const forUserId = (searchParams.forUserId ?? "").trim();

  const fromStr = (searchParams.from ?? "").trim();
  const toStr = (searchParams.to ?? "").trim();
  const from = fromStr ? parseOptionalDateOnlyToDate(fromStr, false) : null;
  const to = toStr ? parseOptionalDateOnlyToDate(toStr, true) : null;

  const page = clamp(Number(searchParams.page ?? "1") || 1, 1, 9999);
  const perPageAllowed = new Set([10, 25, 50, 100]);
  const perPage = perPageAllowed.has(Number(searchParams.perPage)) ? Number(searchParams.perPage) : 25;
  const skip = (page - 1) * perPage;

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";
  const soft = "rgba(255,255,255,0.03)";

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

  // Wrap-friendly rows (prevents overflow on smaller screens)
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

  if (q) {
    where.OR = [
      { id: { contains: q, mode: "insensitive" } },
      { note: { contains: q, mode: "insensitive" } },
      { supplierName: { contains: q, mode: "insensitive" } },
      { supplierPartNumber: { contains: q, mode: "insensitive" } },
      { item: { sku: { contains: q, mode: "insensitive" } } },
      { item: { name: { contains: q, mode: "insensitive" } } },
      { forStore: { name: { contains: q, mode: "insensitive" } } },
      { forUser: { name: { contains: q, mode: "insensitive" } } },
      { createdByUser: { name: { contains: q, mode: "insensitive" } } },
      { createdByUser: { email: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [items, locations, users, total, orders] = await Promise.all([
    prisma.item.findMany({
      where: { active: true },
      orderBy: { sku: "asc" },
      select: { id: true, sku: true, partNumber: true, name: true },
    }),
    prisma.location.findMany({
      where: { active: true },
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

  const pageCount = Math.max(1, Math.ceil(total / perPage));

  async function syncItemCostAndOrderFromFromLatestOrder(tx: Prisma.TransactionClient, itemId: string) {
    // set Item.cost + Item.orderFrom from the most recent order (by orderedAt desc)
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

    const newCostStr = latest.unitPrice ? new Decimal(latest.unitPrice).toFixed(2) : null;
    const prevCostStr = item.cost ? new Decimal(item.cost).toFixed(2) : null;
    const newOrderFrom = latest.supplierName ?? null;

    // Only update if we actually have a new cost value
    if (!latest.unitPrice) return;

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

  async function createOrderAction(formData: FormData) {
    "use server";

    const { session: s } = await requireOrderHistoryEdit();

    const itemId = String(formData.get("itemId") ?? "").trim();
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

    if (!itemId) throw new Error("Missing item");
    if (!Number.isFinite(qty) || qty <= 0) throw new Error("Invalid quantity");
    if (!unitPriceStr) throw new Error("Unit price is required");

    const createdByUserId = s?.user?.id ?? "";
    if (!createdByUserId) throw new Error("Missing session user id");

    await prisma.$transaction(async (tx) => {
      const item = await tx.item.findUnique({
        where: { id: itemId },
        select: { id: true, sku: true, cost: true, orderFrom: true, orderedQty: true },
      });
      if (!item) throw new Error("Item not found");

      const prevCostStr = item.cost ? new Decimal(item.cost).toFixed(2) : null;
      const newCostStr = new Decimal(unitPriceStr).toFixed(2);

      const prevOrderFrom = item.orderFrom ?? null;
      const newOrderFrom = supplierName ? supplierName : prevOrderFrom;

      const prevOrderedQty = item.orderedQty ?? 0;
      const newOrderedQty = prevOrderedQty + qty;

      const auditLine = buildSystemAuditLine({
        action: "CREATE_ORDER",
        itemSku: item.sku,
        prevCost: prevCostStr,
        newCost: newCostStr,
        prevOrderFrom,
        newOrderFrom,
        prevOrderedQty,
        newOrderedQty,
        note: supplierName ? "item.cost + item.orderFrom updated" : "item.cost updated",
      });

      // Create the order (this IS the audit trail row)
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

      // Ordered amount should be added to item.orderedQty immediately.
      // ALSO update item cost + orderFrom (supplier) based on what was entered.
      await tx.item.update({
        where: { id: itemId },
        data: {
          orderedQty: { increment: qty },
          cost: new Decimal(unitPriceStr),
          orderFrom: supplierName ? supplierName : undefined, // only overwrite if provided
        },
      });

      // If for any reason orderedAt is not the latest, keep item cost/orderFrom in sync with the latest order row.
      // (This makes edits/late entries safe.)
      if (created.orderedAt.getTime() !== orderedAt.getTime()) {
        await syncItemCostAndOrderFromFromLatestOrder(tx, itemId);
      }
    });

    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/items");

    const h = await headers();
    redirect(safeReturnToPathFromReferer(h.get("referer")));
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
            throw new Error(
              `Cannot change qty: Item.onHandQty (${item.onHandQty}) would go negative by applying delta (${delta}).`
            );
          }
          await tx.item.update({
            where: { id: existing.itemId },
            data: { onHandQty: { increment: delta } },
          });
        } else {
          if (delta < 0 && (item.orderedQty ?? 0) + delta < 0) {
            throw new Error(
              `Cannot change qty: Item.orderedQty (${item.orderedQty}) would go negative by applying delta (${delta}).`
            );
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

      const item = await tx.item.findUnique({
        where: { id: existing.itemId },
        select: { id: true, orderedQty: true, onHandQty: true },
      });
      if (!item) throw new Error("Item not found");

      // GUARDRAIL: do not allow orderedQty to go negative from this workflow.
      if ((item.orderedQty ?? 0) < existing.quantity) {
        throw new Error(
          `Cannot add to inventory: Item.orderedQty (${item.orderedQty}) is less than order qty (${existing.quantity}).`
        );
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

      // Reverse inventory effect based on phase, but never allow negative results.
      if (existing.status === "ADDED_TO_INVENTORY") {
        if ((item.onHandQty ?? 0) < existing.quantity) {
          throw new Error(
            `Cannot delete: Item.onHandQty (${item.onHandQty}) is less than order qty (${existing.quantity}).`
          );
        }

        await tx.item.update({
          where: { id: existing.itemId },
          data: { onHandQty: { decrement: existing.quantity } },
        });
      } else {
        // ORDERED / ARRIVED => remove from orderedQty
        if ((item.orderedQty ?? 0) < existing.quantity) {
          throw new Error(
            `Cannot delete: Item.orderedQty (${item.orderedQty}) is less than order qty (${existing.quantity}).`
          );
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

        {/* CREATE ORDER */}
        <div style={{ marginTop: 12, border, borderRadius: 14, background: surface, padding: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 8, fontSize: 14 }}>Create Order</div>

          <form action={createOrderAction} style={{ display: "grid", gap: 10 }}>
            <div style={wrapRow}>
              <label style={{ ...controlLabel, ...flexItem(420, 3) }}>
                Item
                <select name="itemId" required style={controlBase}>
                  <option value="">Select item…</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.sku}
                      {it.partNumber ? ` • ${it.partNumber}` : ""} • {it.name}
                    </option>
                  ))}
                </select>
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

              <div style={{ ...flexItem(200, 0), display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button type="submit" style={btnPrimary}>
                  Create
                </button>
              </div>
            </div>

            <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
              Creating an order immediately increments <b>Item.orderedQty</b> and also updates:
              <ul style={{ margin: "6px 0 0 18px" }}>
                <li>
                  <b>Item.cost</b> → set to the order <b>unit price</b>
                </li>
                <li>
                  <b>Item.orderFrom</b> → set to <b>Supplier</b> (if provided)
                </li>
              </ul>
              Each order row includes an <b>AUDIT</b> line in <b>Note</b> so you can see what changed.
            </div>
          </form>
        </div>

        {/* FILTERS */}
        <div style={{ marginTop: 14, border, borderRadius: 14, background: surface, padding: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 8, fontSize: 14 }}>Search & Filters</div>

          <form action="/admin/inventory-orders" method="get" style={{ display: "grid", gap: 10 }}>
            <div style={wrapRow}>
              <label style={{ ...controlLabel, ...flexItem(240, 2) }}>
                Search
                <input name="q" defaultValue={q} placeholder="id, sku, name, supplier, note…" style={controlBase} />
              </label>

              <label style={{ ...controlLabel, ...flexItem(170, 0) }}>
                Phase
                <select name="phase" defaultValue={phase || ""} style={controlBase}>
                  <option value="">All</option>
                  {PHASES.map((s) => (
                    <option key={s} value={s}>
                      {phaseLabel(s)}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ ...controlLabel, ...flexItem(240, 1) }}>
                Item
                <select name="itemId" defaultValue={itemId} style={controlBase}>
                  <option value="">All</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.sku}
                      {it.partNumber ? ` • ${it.partNumber}` : ""} • {it.name}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ ...controlLabel, ...flexItem(220, 1) }}>
                Supplier
                <input name="supplier" defaultValue={supplier} placeholder="Supplier…" style={controlBase} />
              </label>

              <label style={{ ...controlLabel, ...flexItem(220, 1) }}>
                For Tech
                <select name="forUserId" defaultValue={forUserId} style={controlBase}>
                  <option value="">All</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role})
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ ...controlLabel, ...flexItem(220, 1) }}>
                For Store
                <select name="forStoreId" defaultValue={forStoreId} style={controlBase}>
                  <option value="">All</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={wrapRow}>
              <label style={{ ...controlLabel, ...flexItem(150, 0) }}>
                From
                <input type="date" name="from" defaultValue={fromStr} style={controlBase} />
              </label>

              <label style={{ ...controlLabel, ...flexItem(150, 0) }}>
                To
                <input type="date" name="to" defaultValue={toStr} style={controlBase} />
              </label>

              <label style={{ ...controlLabel, ...flexItem(130, 0) }}>
                Per page
                <select name="perPage" defaultValue={String(perPage)} style={controlBase}>
                  {[10, 25, 50, 100].map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>

              <div style={{ ...flexItem(220, 0), display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <input type="hidden" name="page" value="1" />
                <button type="submit" style={btn}>
                  Apply
                </button>
                <Link href="/admin/inventory-orders" style={{ ...btn, textDecoration: "none", display: "inline-block", opacity: 0.92 }}>
                  Clear
                </Link>
              </div>
            </div>

            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Showing <b>{orders.length}</b> of <b>{total}</b> results • Page <b>{page}</b> / <b>{pageCount}</b>
            </div>
          </form>
        </div>

        {/* TABLE */}
        <div style={{ marginTop: 14, overflowX: "auto", border, borderRadius: 14, background: surface }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {[
                  "Ordered",
                  "Phase",
                  "Item",
                  "Qty",
                  "Supplier",
                  "Unit",
                  "Ship",
                  "Tax",
                  "Total",
                  "For Tech",
                  "For Store",
                  "Arrived",
                  "Added",
                  "Actions",
                  "Edit",
                  "Delete",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: 10,
                      borderBottom: border,
                      fontSize: 12,
                      opacity: 0.85,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {orders.map((o: OrderRow) => {
                const unit = o.unitPrice ? Number(o.unitPrice) : 0;
                const ship = o.shippingCost ? Number(o.shippingCost) : 0;
                const tax = o.taxCost ? Number(o.taxCost) : 0;
                const totalCost = unit * (o.quantity ?? 0) + ship + tax;

                const itemLabel = o.item
                  ? `${o.item.sku}${o.item.partNumber ? ` • ${o.item.partNumber}` : ""} • ${o.item.name}`
                  : o.itemId;

                const canArrive = o.status === "ORDERED";
                const canAdd = o.status !== "ADDED_TO_INVENTORY";

                return (
                  <tr key={o.id} style={{ borderBottom: border, ...rowPhaseStyle(o.status as InventoryOrderPhase) }}>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{fmtLocal(o.orderedAt)}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 900 }}>{phaseLabel(o.status as InventoryOrderPhase)}</td>
                    <td style={{ padding: 10, minWidth: 320 }}>
                      <div style={{ fontWeight: 900 }}>{itemLabel}</div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>id: {o.id}</div>
                    </td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{o.quantity}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {o.supplierName ?? "—"}
                      {o.supplierPartNumber ? <div style={{ fontSize: 12, opacity: 0.75 }}>Part #: {o.supplierPartNumber}</div> : null}
                    </td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{o.unitPrice ? money(Number(o.unitPrice)) : "—"}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{o.shippingCost ? money(Number(o.shippingCost)) : "—"}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{o.taxCost ? money(Number(o.taxCost)) : "—"}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 900 }}>{money(totalCost)}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{o.forUser?.name ?? "—"}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{o.forStore?.name ?? "—"}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{fmtLocal(o.arrivedAt)}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{fmtLocal(o.addedToInventoryAt)}</td>

                    {/* ACTIONS */}
                    <td style={{ padding: 10, verticalAlign: "top" }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <form action={markArrivedAction}>
                          <input type="hidden" name="id" value={o.id} />
                          <button type="submit" style={{ ...btn, opacity: canArrive ? 1 : 0.5 }} disabled={!canArrive}>
                            Mark Arrived
                          </button>
                        </form>

                        <form action={addToInventoryAction}>
                          <input type="hidden" name="id" value={o.id} />
                          <button type="submit" style={{ ...btnPrimary, opacity: canAdd ? 1 : 0.5 }} disabled={!canAdd}>
                            Add to Inventory
                          </button>
                        </form>
                      </div>

                      {o.note ? (
                        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85, maxWidth: 340, whiteSpace: "pre-wrap" }}>
                          <b>Note:</b> {o.note}
                        </div>
                      ) : null}
                    </td>

                    {/* EDIT */}
                    <td style={{ padding: 10, verticalAlign: "top" }}>
                      <details>
                        <summary style={{ cursor: "pointer", fontWeight: 900 }}>Edit</summary>

                        <form
                          action={saveOrderDetailsAction}
                          style={{
                            marginTop: 10,
                            padding: 10,
                            border,
                            borderRadius: 12,
                            background: soft,
                            display: "flex",
                            flexDirection: "column",
                            gap: 10,
                            width: "100%",
                            minWidth: 640,
                          }}
                        >
                          <input type="hidden" name="id" value={o.id} />

                          <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.5 }}>
                            Item is not changeable (keeps inventory adjustments safe). Quantity edits are applied to{" "}
                            <b>{o.status === "ADDED_TO_INVENTORY" ? "on-hand" : "ordered"}</b>.
                            <br />
                            After saving, the system will sync <b>Item.cost</b> + <b>Item.orderFrom</b> from the latest order for that item.
                          </div>

                          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                            <label style={controlLabel}>
                              Ordered at
                              <input name="orderedAt" type="datetime-local" defaultValue={fmtForDatetimeLocal(o.orderedAt)} style={controlBase} />
                            </label>

                            <label style={controlLabel}>
                              Qty
                              <input
                                name="qty"
                                type="number"
                                min={1}
                                step={1}
                                defaultValue={o.quantity}
                                required
                                style={controlBase}
                              />
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
                          </div>

                          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                            <label style={controlLabel}>
                              Unit price
                              <input
                                name="unitPrice"
                                defaultValue={o.unitPrice ? String(o.unitPrice) : ""}
                                placeholder="0.00"
                                required
                                style={controlBase}
                              />
                            </label>
                            <label style={controlLabel}>
                              Shipping
                              <input
                                name="shippingCost"
                                defaultValue={o.shippingCost ? String(o.shippingCost) : ""}
                                placeholder="0.00"
                                style={controlBase}
                              />
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
                    </td>

                    {/* DELETE */}
                    <td style={{ padding: 10, verticalAlign: "top" }}>
                      <details>
                        <summary style={{ cursor: "pointer", fontWeight: 900 }}>Delete</summary>
                        <form
                          action={deleteOrderAction}
                          style={{
                            marginTop: 10,
                            padding: 10,
                            border,
                            borderRadius: 12,
                            background: soft,
                            display: "grid",
                            gap: 8,
                            minWidth: 260,
                          }}
                        >
                          <input type="hidden" name="id" value={o.id} />
                          <div style={{ fontSize: 12, opacity: 0.9 }}>
                            Type <code>DELETE</code> to confirm deletion. This reverses inventory effects for the current phase, then syncs{" "}
                            <b>Item.cost</b>/<b>Item.orderFrom</b> from the latest remaining order.
                          </div>
                          <input name="confirm" placeholder="DELETE" style={controlBase} />
                          <button type="submit" style={btn}>
                            Permanently Delete
                          </button>
                        </form>
                      </details>
                    </td>
                  </tr>
                );
              })}

              {orders.length === 0 ? (
                <tr>
                  <td colSpan={16} style={{ padding: 14, opacity: 0.8 }}>
                    No orders found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
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