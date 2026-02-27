// app/admin/inventory-orders/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { Permission, Role, InventoryOrderStatus, Prisma } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import ItemPicker from "./ItemPicker";

import {
  createOrderAction,
  saveOrderDetailsAction,
  markArrivedAction,
  addToInventoryAction,
  deleteOrderAction,
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

  // Reuse Items Admin view permission for Order History module
  const ok = hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) redirect("/");

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

  ok?: string; // "1"
  error?: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseOptionalDateOnlyToDate(v: string, endOfDay = false): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const iso = endOfDay ? `${s}T23:59:59.999` : `${s}T00:00:00`;
  const d = new Date(iso);
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

const ORDER_INCLUDE = {
  item: { select: { id: true, sku: true, partNumber: true, name: true } },
  forStore: { select: { id: true, name: true } },
  forUser: { select: { id: true, name: true } },
  createdByUser: { select: { id: true, name: true, email: true } },
} satisfies Prisma.InventoryOrderInclude;

type OrderRow = Prisma.InventoryOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

export default async function AdminInventoryOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireOrderHistoryView();

  // If Prisma Client isn't regenerated yet, avoid crashing.
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
              Prisma Client does not include <code>inventoryOrder</code>.
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

  const okMsg = (searchParams.ok ?? "").trim() === "1";
  const errMsg = (searchParams.error ?? "").trim();

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
      select: {
        id: true,
        sku: true,
        partNumber: true,
        name: true,
        category: true,
        manufacturer: true,
        orderFrom: true,
      },
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

        {/* Success / Error banner */}
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
            Order updated.
          </div>
        ) : null}

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

            <form action={createOrderAction} style={{ display: "grid", gap: 10 }}>
              <div style={wrapRow}>
                <label style={{ ...controlLabel, ...flexItem(420, 3) }}>
                  Item (select existing)
                  <div style={{ marginTop: 2 }}>
                    {/* ✅ IMPORTANT: ONLY PASS DATA, NO FUNCTIONS */}
                    <ItemPicker name="itemId" items={items} placeholder="Search SKU, part #, name, category, manufacturer…" />
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
            </form>
          </div>
        </details>

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

              <label style={{ ...controlLabel, ...flexItem(320, 2) }}>
                Item
                <div style={{ marginTop: 2 }}>
                  {/* ✅ IMPORTANT: ONLY PASS DATA, NO FUNCTIONS */}
                  <ItemPicker
                    name="itemId"
                    items={items}
                    defaultId={itemId}
                    placeholder="Search item (sku, part #, name, category, manufacturer…)"
                  />
                </div>
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

                          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                            <label style={controlLabel}>
                              Ordered at
                              <input name="orderedAt" type="datetime-local" defaultValue={fmtForDatetimeLocal(o.orderedAt)} style={controlBase} />
                            </label>

                            <label style={controlLabel}>
                              Qty
                              <input name="qty" type="number" min={1} step={1} defaultValue={o.quantity} required style={controlBase} />
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
                            Type <code>DELETE</code> to confirm deletion.
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
          Phases: <b>ORDERED</b> → <b>ARRIVED</b> → <b>ADDED TO INVENTORY</b>.
        </div>
      </div>
    </main>
  );
}