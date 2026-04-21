// app/admin/reports/item-cost-history/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { Permission, Role } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

async function requireReportView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  const ok = hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) redirect("/");
}

type SearchParams = {
  itemId?: string;
  supplier?: string;
  method?: string; // "LAST_BEFORE" | "AVG_WINDOW"
  months?: string; // "1" | "3" | "6" | "12" | "24" | "36" | "60"
  asOf?: string; // yyyy-mm-dd
  page?: string; // 1-based
  perPage?: string; // 25/50/100
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

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

function money(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function pct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function toNum(v: unknown): number {
  if (v === null || typeof v === "undefined") return NaN;
  if (typeof v === "number") return v;
  // Prisma Decimal string / Decimal-like -> Number() works if it stringifies cleanly.
  try {
    return Number(v as never);
  } catch {
    return NaN;
  }
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addMonths(d: Date, deltaMonths: number) {
  const x = new Date(d);
  const day = x.getDate();
  x.setMonth(x.getMonth() + deltaMonths);

  // If month rollover caused day mismatch, clamp to last day of month
  if (x.getDate() !== day) {
    x.setDate(0);
  }
  return x;
}

// ------------------
// Types for the dynamic inventoryOrder model access (no `any`)
// ------------------

type InventoryOrderStatusLike = "ORDERED" | "ARRIVED" | "ADDED_TO_INVENTORY";

type InventoryOrderFindManyRow = {
  itemId: string;
  unitPrice: unknown;
  orderedAt: Date | null;
  supplierName: string | null;
};

type InventoryOrderGroupByRow = {
  itemId: string;
  _avg: { unitPrice: unknown | null } | null;
  _max: { orderedAt: Date | null } | null;
};

type InventoryOrderModel = {
  findMany: (args: {
    where: {
      itemId: { in: string[] };
      orderedAt: { lte: Date };
      supplierName?: { contains: string; mode: "insensitive" };
    };
    orderBy: Array<{ itemId: "asc" } | { orderedAt: "desc" }>;
    distinct: Array<"itemId">;
    select: { itemId: true; unitPrice: true; orderedAt: true; supplierName: true };
  }) => Promise<InventoryOrderFindManyRow[]>;
  groupBy: (args: {
    by: ["itemId"];
    where: {
      itemId: { in: string[] };
      orderedAt: { gte: Date; lte: Date };
      supplierName?: { contains: string; mode: "insensitive" };
    };
    _avg: { unitPrice: true };
    _max: { orderedAt: true };
  }) => Promise<InventoryOrderGroupByRow[]>;
};

function getInventoryOrderModel(p: unknown): InventoryOrderModel | null {
  if (!p || typeof p !== "object") return null;
  const maybe = p as { inventoryOrder?: unknown };
  const io = maybe.inventoryOrder;
  if (!io || typeof io !== "object") return null;

  const hasFindMany = typeof (io as { findMany?: unknown }).findMany === "function";
  const hasGroupBy = typeof (io as { groupBy?: unknown }).groupBy === "function";
  if (!hasFindMany || !hasGroupBy) return null;

  return io as InventoryOrderModel;
}

export default async function AdminItemCostHistoryReportPage({ searchParams }: { searchParams: SearchParams }) {
  await requireReportView();

  const sp: SearchParams = (searchParams instanceof Promise ? await searchParams : searchParams) ?? {};

  const inventoryOrder = getInventoryOrderModel(prisma);
  if (!inventoryOrder) {
    return (
      <main style={{ padding: 16 }}>
        <div style={{ padding: 16, maxWidth: 1400, margin: "0 auto", color: "var(--foreground)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Report: Item Cost History</h1>
            <Link
              href="/admin/items"
              style={{
                padding: "10px 14px",
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
              Your Prisma Client does not include <code>inventoryOrder</code> yet, so this report would crash.
              <br />
              Fix: run migration + regenerate Prisma Client (or restart dev server after <code>prisma generate</code>).
            </div>
          </div>
        </div>
      </main>
    );
  }

  const itemId = String(sp.itemId ?? "").trim();
  const supplier = String(sp.supplier ?? "").trim();

  const methodRaw = String(sp.method ?? "LAST_BEFORE").trim().toUpperCase();
  const method: "LAST_BEFORE" | "AVG_WINDOW" = methodRaw === "AVG_WINDOW" ? "AVG_WINDOW" : "LAST_BEFORE";

  const monthsAllowed = new Set([1, 3, 6, 12, 24, 36, 60]);
  const months = monthsAllowed.has(Number(sp.months)) ? Number(sp.months) : 6;

  const today = startOfDay(new Date());
  const asOfStr = String(sp.asOf ?? "").trim();
  const asOf = parseOptionalDateOnlyToDate(asOfStr, true) ?? new Date(today.getTime() + 23 * 60 * 60 * 1000);
  const windowStart = addMonths(startOfDay(asOf), -months);

  const perPageAllowed = new Set([25, 50, 100]);
  const perPage = perPageAllowed.has(Number(sp.perPage)) ? Number(sp.perPage) : 50;
  const page = clamp(Number(sp.page ?? "1") || 1, 1, 9999);
  const skip = (page - 1) * perPage;

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";

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

  // Base item query (bounded; can filter by itemId and paginate)
  const itemWhere: { active: true; id?: string } = { active: true };
  if (itemId) itemWhere.id = itemId;

  const [itemsTotal, items, itemOptions] = await Promise.all([
    prisma.item.count({ where: itemWhere }),
    prisma.item.findMany({
      where: itemWhere,
      orderBy: { sku: "asc" },
      skip,
      take: perPage,
      select: { id: true, sku: true, partNumber: true, name: true, cost: true },
    }),
    prisma.item.findMany({
      where: { active: true },
      orderBy: { sku: "asc" },
      select: { id: true, sku: true, partNumber: true, name: true },
      take: 500,
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(itemsTotal / perPage));
  const itemIds = items.map((i) => i.id);

  type ThenInfo = {
    itemId: string;
    thenCost: number; // derived from unitPrice avg or last
    thenDate: Date | null;
    thenSupplier: string | null;
  };

  const thenByItemId = new Map<string, ThenInfo>();

  if (itemIds.length > 0) {
    if (method === "LAST_BEFORE") {
      const rows = await inventoryOrder.findMany({
        where: {
          itemId: { in: itemIds },
          orderedAt: { lte: asOf },
          ...(supplier ? { supplierName: { contains: supplier, mode: "insensitive" } } : {}),
        },
        orderBy: [{ itemId: "asc" }, { orderedAt: "desc" }],
        distinct: ["itemId"],
        select: { itemId: true, unitPrice: true, orderedAt: true, supplierName: true },
      });

      for (const r of rows) {
        const n = toNum(r.unitPrice);
        if (!Number.isFinite(n)) continue;
        thenByItemId.set(r.itemId, {
          itemId: r.itemId,
          thenCost: n,
          thenDate: r.orderedAt ?? null,
          thenSupplier: r.supplierName ?? null,
        });
      }
    } else {
      const rows = await inventoryOrder.groupBy({
        by: ["itemId"],
        where: {
          itemId: { in: itemIds },
          orderedAt: { gte: windowStart, lte: asOf },
          ...(supplier ? { supplierName: { contains: supplier, mode: "insensitive" } } : {}),
        },
        _avg: { unitPrice: true },
        _max: { orderedAt: true },
      });

      for (const r of rows) {
        const avg = r._avg?.unitPrice ?? null;
        const n = toNum(avg);
        if (!Number.isFinite(n)) continue;
        thenByItemId.set(r.itemId, {
          itemId: r.itemId,
          thenCost: n,
          thenDate: r._max?.orderedAt ?? null,
          thenSupplier: null,
        });
      }
    }
  }

  const rows = items.map((it) => {
    const currentCost = toNum(it.cost);
    const then = thenByItemId.get(it.id);
    const thenCost = then ? then.thenCost : NaN;

    const delta = Number.isFinite(currentCost) && Number.isFinite(thenCost) ? currentCost - thenCost : NaN;
    const deltaPct = Number.isFinite(delta) && Number.isFinite(thenCost) && thenCost !== 0 ? delta / thenCost : NaN;

    return {
      id: it.id,
      sku: it.sku,
      partNumber: it.partNumber,
      name: it.name,
      currentCost,
      thenCost,
      delta,
      deltaPct,
      thenDate: then?.thenDate ?? null,
      thenSupplier: then?.thenSupplier ?? null,
    };
  });

  function buildHref(next: Partial<SearchParams>) {
    const sp = new URLSearchParams();

    const merged: SearchParams = {
      itemId: itemId || undefined,
      supplier: supplier || undefined,
      method,
      months: String(months),
      asOf: asOfStr || new Date(asOf).toISOString().slice(0, 10),
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
    return qs ? `/admin/reports/item-cost-history?${qs}` : "/admin/reports/item-cost-history";
  }

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1400, margin: "0 auto", color: fg }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Report: Item Cost History</h1>

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
            href="/admin/inventory-orders"
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
            Order History →
          </Link>
        </div>

        {/* FILTERS */}
        <div style={{ marginTop: 12, border, borderRadius: 14, background: surface, padding: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 8, fontSize: 14 }}>Filters</div>

          <form action="/admin/reports/item-cost-history" method="get" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
              <label style={{ ...controlLabel, flex: "2 1 520px", minWidth: 260 }}>
                Item (optional)
                <select name="itemId" defaultValue={itemId} style={controlBase}>
                  <option value="">All active items</option>
                  {itemOptions.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.sku}
                      {it.partNumber ? ` • ${it.partNumber}` : ""} • {it.name}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ ...controlLabel, flex: "1 1 240px", minWidth: 200 }}>
                Supplier contains (optional)
                <input name="supplier" defaultValue={supplier} placeholder="e.g. Grainger" style={controlBase} />
              </label>

              <label style={{ ...controlLabel, flex: "0 1 240px", minWidth: 200 }}>
                Method
                <select name="method" defaultValue={method} style={controlBase}>
                  <option value="LAST_BEFORE">Last order at/before date</option>
                  <option value="AVG_WINDOW">Average unit price in window</option>
                </select>
              </label>

              <label style={{ ...controlLabel, flex: "0 1 180px", minWidth: 160 }}>
                Months
                <select name="months" defaultValue={String(months)} style={controlBase}>
                  {[1, 3, 6, 12, 24, 36, 60].map((m) => (
                    <option key={m} value={String(m)}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ ...controlLabel, flex: "0 1 190px", minWidth: 170 }}>
                As-of date
                <input
                  type="date"
                  name="asOf"
                  defaultValue={asOfStr || new Date(asOf).toISOString().slice(0, 10)}
                  style={controlBase}
                />
              </label>

              <label style={{ ...controlLabel, flex: "0 1 150px", minWidth: 140 }}>
                Per page
                <select name="perPage" defaultValue={String(perPage)} style={controlBase}>
                  {[25, 50, 100].map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>

              <input type="hidden" name="page" value="1" />
              <button type="submit" style={btn}>
                Apply
              </button>

              <Link
                href="/admin/reports/item-cost-history"
                style={{ ...btn, textDecoration: "none", display: "inline-block", opacity: 0.92 }}
              >
                Clear
              </Link>
            </div>

            <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
              <div>
                Window: <b>{fmtDate(windowStart)}</b> → <b>{fmtDate(asOf)}</b>
              </div>
              <div>
                Showing <b>{rows.length}</b> of <b>{itemsTotal}</b> items • Page <b>{page}</b> / <b>{pageCount}</b>
              </div>
            </div>
          </form>
        </div>

        {/* TABLE */}
        <div style={{ marginTop: 14, overflowX: "auto", border, borderRadius: 14, background: surface }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["SKU", "Item", "Current Cost", "Then Cost", "Δ", "Δ %", "Then Date", "Then Supplier"].map((h) => (
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
              {rows.map((r) => {
                const deltaColor =
                  Number.isFinite(r.delta) && r.delta !== 0
                    ? r.delta > 0
                      ? "rgba(244, 67, 54, 0.85)"
                      : "rgba(76, 175, 80, 0.85)"
                    : "rgba(128,128,128,0.75)";

                const itemLabel = `${r.name}${r.partNumber ? ` • ${r.partNumber}` : ""}`;

                return (
                  <tr key={r.id} style={{ borderBottom: border }}>
                    <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 900 }}>{r.sku}</td>
                    <td style={{ padding: 10, minWidth: 360 }}>
                      <div style={{ fontWeight: 900 }}>{itemLabel}</div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>id: {r.id}</div>
                    </td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {Number.isFinite(r.currentCost) ? money(r.currentCost) : "—"}
                    </td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {Number.isFinite(r.thenCost) ? money(r.thenCost) : "—"}
                    </td>
                    <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 900, color: deltaColor }}>
                      {Number.isFinite(r.delta) ? money(r.delta) : "—"}
                    </td>
                    <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 900, color: deltaColor }}>
                      {Number.isFinite(r.deltaPct) ? pct(r.deltaPct) : "—"}
                    </td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{fmtDate(r.thenDate)}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{r.thenSupplier ?? "—"}</td>
                  </tr>
                );
              })}

              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 14, opacity: 0.8 }}>
                    No items found.
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

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
          Notes:
          <ul style={{ margin: "6px 0 0 18px" }}>
            <li>
              <b>Then Cost</b> comes from <b>InventoryOrder.unitPrice</b> (either last order before the as-of date, or the
              average in the window).
            </li>
            <li>
              <b>Current Cost</b> comes from <b>Item.cost</b>.
            </li>
            <li>If you filter by supplier, “Then” values only consider orders matching that supplier filter.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}