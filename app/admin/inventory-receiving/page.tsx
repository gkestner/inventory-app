// app/admin/inventory-receiving/page.tsx
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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

async function requireReceivingView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return { session, perms };

  const ok = hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) redirect("/");

  return { session, perms };
}

async function requireReceivingEdit() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) throw new Error("Unauthorized");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return { session, perms };

  const ok = hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) throw new Error("Forbidden");

  return { session, perms };
}

type Phase = InventoryOrderStatus;

function phaseLabel(s: Phase): string {
  if (s === "ORDERED") return "ORDERED";
  if (s === "ARRIVED") return "ARRIVED / PROCESSING";
  return "COMPLETED (ADDED)";
}

function rowPhaseStyle(phase: Phase): CSSProperties {
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

function fmtLocal(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function money(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function safeReturnToPathFromReferer(referer: string | null): string {
  if (!referer) return "/admin/inventory-receiving";
  try {
    const u = new URL(referer);
    const path = `${u.pathname}${u.search}`;
    return path.startsWith("/") ? path : "/admin/inventory-receiving";
  } catch {
    return "/admin/inventory-receiving";
  }
}

type SearchParams = {
  q?: string;
  itemId?: string;
  supplier?: string;
  forStoreId?: string;
  forUserId?: string;
  showCompleted?: string; // "1" to include ADDED_TO_INVENTORY
};

const ROW_INCLUDE = {
  item: { select: { id: true, sku: true, partNumber: true, name: true } },
  forStore: { select: { id: true, name: true } },
  forUser: { select: { id: true, name: true } },
  createdByUser: { select: { id: true, name: true, email: true } },
} satisfies Prisma.InventoryOrderInclude;

type Row = Prisma.InventoryOrderGetPayload<{ include: typeof ROW_INCLUDE }>;

export default async function AdminInventoryReceivingPage({ searchParams }: { searchParams: SearchParams }) {
  await requireReceivingView();

  // If Prisma Client isn't regenerated yet, avoid crashing.
  const anyPrisma = prisma as unknown as { inventoryOrder?: unknown };
  if (!("inventoryOrder" in anyPrisma) || !anyPrisma.inventoryOrder) {
    return (
      <main style={{ padding: 16 }}>
        <div style={{ padding: 16, maxWidth: 1400, margin: "0 auto", color: "var(--foreground)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Admin: Orders Received / Processing</h1>
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
              Your app is running with a Prisma Client that does not include <code>inventoryOrder</code> yet, so this page would crash.
              <br />
              Fix: run migration + regenerate Prisma Client (or restart dev server after <code>prisma generate</code>).
            </div>
          </div>
        </div>
      </main>
    );
  }

  const q = String(searchParams.q ?? "").trim();
  const itemId = String(searchParams.itemId ?? "").trim();
  const supplier = String(searchParams.supplier ?? "").trim();
  const forStoreId = String(searchParams.forStoreId ?? "").trim();
  const forUserId = String(searchParams.forUserId ?? "").trim();
  const showCompleted = String(searchParams.showCompleted ?? "").trim() === "1";

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
  const btnPrimary: CSSProperties = {
    ...btn,
    background: "var(--order-submit-bg, rgba(76, 175, 80, 0.18))",
    border: "1px solid var(--order-submit-border, rgba(76, 175, 80, 0.45))",
  };
  const badge: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    border,
    background: surface,
    fontWeight: 900,
    fontSize: 12,
    opacity: 0.95,
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

  // Receiving view defaults to ARRIVED rows, and optionally includes completed.
  const where: Prisma.InventoryOrderWhereInput = {};
  if (!showCompleted) {
    where.status = "ARRIVED";
  } else {
    where.status = { in: ["ARRIVED", "ADDED_TO_INVENTORY"] };
  }

  if (itemId) where.itemId = itemId;
  if (supplier) where.supplierName = { contains: supplier, mode: "insensitive" };
  if (forStoreId) where.forStoreId = forStoreId;
  if (forUserId) where.forUserId = forUserId;

  if (q) {
    where.OR = [
      { id: { contains: q, mode: "insensitive" } },
      { note: { contains: q, mode: "insensitive" } },
      { supplierName: { contains: q, mode: "insensitive" } },
      { supplierPartNumber: { contains: q, mode: "insensitive" } },
      { item: { id: { contains: q, mode: "insensitive" } } },
      { item: { sku: { contains: q, mode: "insensitive" } } },
      { item: { name: { contains: q, mode: "insensitive" } } },
      { forStore: { name: { contains: q, mode: "insensitive" } } },
      { forUser: { name: { contains: q, mode: "insensitive" } } },
      { createdByUser: { name: { contains: q, mode: "insensitive" } } },
      { createdByUser: { email: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [items, locations, users, rows] = await Promise.all([
    prisma.item.findMany({
      where: { active: true },
      orderBy: { sku: "asc" },
      select: { id: true, sku: true, partNumber: true, name: true },
    }),
    prisma.location.findMany({
      where: { active: true, receiptEnabled: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
    prisma.inventoryOrder.findMany({
      where,
      orderBy: { arrivedAt: "desc" },
      take: 300,
      include: ROW_INCLUDE,
    }),
  ]);

  const arrived = rows.filter((r) => r.status === "ARRIVED");
  const completed = rows.filter((r) => r.status === "ADDED_TO_INVENTORY");

  async function addToInventoryAction(formData: FormData) {
    "use server";

    await requireReceivingEdit();

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing order id");

    await prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryOrder.findUnique({
        where: { id },
        select: { id: true, status: true, itemId: true, quantity: true, addedToInventoryAt: true },
      });
      if (!existing) throw new Error("Order not found");
      if (existing.status === "ADDED_TO_INVENTORY") return;

      const item = await tx.item.findUnique({
        where: { id: existing.itemId },
        select: { id: true, orderedQty: true, onHandQty: true },
      });
      if (!item) throw new Error("Item not found");

      if ((item.orderedQty ?? 0) < existing.quantity) {
        throw new Error(
          `Cannot add to inventory: Item.orderedQty (${item.orderedQty}) is less than order qty (${existing.quantity}).`
        );
      }

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
        },
      });
    });

    revalidatePath("/admin/inventory-receiving");
    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/items");

    const h = await headers();
    redirect(safeReturnToPathFromReferer(h.get("referer")));
  }

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1400, margin: "0 auto", color: fg }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Admin: Orders Received / Processing</h1>

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
            ← Order History
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
            href="/admin/items"
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
            Items →
          </Link>
        </div>

        {/* FILTERS */}
        <div style={{ marginTop: 12, border, borderRadius: 14, background: surface, padding: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 8, fontSize: 14 }}>
            Receiving queue (default: ARRIVED). Rows are color-coded by phase.
          </div>

          <form action="/admin/inventory-receiving" method="get" style={{ display: "grid", gap: 10 }}>
            <div style={wrapRow}>
              <label style={{ ...controlLabel, ...flexItem(280, 2) }}>
                Search
                <input name="q" defaultValue={q} placeholder="sku, name, supplier, note, id…" style={controlBase} />
              </label>

              <label style={{ ...controlLabel, ...flexItem(280, 1) }}>
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

              <label style={{ ...controlLabel, ...flexItem(240, 1) }}>
                Supplier
                <input name="supplier" defaultValue={supplier} placeholder="Supplier…" style={controlBase} />
              </label>

              <label style={{ ...controlLabel, ...flexItem(240, 1) }}>
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

              <label style={{ ...controlLabel, ...flexItem(240, 1) }}>
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

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, opacity: 0.9 }}>
                <input type="hidden" name="showCompleted" value="0" />
                <input type="checkbox" name="showCompleted" value="1" defaultChecked={showCompleted} />
                Include completed (added)
              </label>

              <button type="submit" style={btn}>
                Apply
              </button>

              <Link
                href="/admin/inventory-receiving"
                style={{ ...btn, textDecoration: "none", display: "inline-block", opacity: 0.92 }}
              >
                Clear
              </Link>

              <span style={badge}>
                ARRIVED: <span style={{ opacity: 0.85 }}>{arrived.length}</span>
              </span>
              <span style={badge}>
                COMPLETED: <span style={{ opacity: 0.85 }}>{completed.length}</span>
              </span>
            </div>

            <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
              Use this screen when parts physically show up. When you click <b>Add to Inventory</b>, the system moves qty
              from <b>Item.orderedQty</b> → <b>Item.onHandQty</b> and marks the order completed.
            </div>
          </form>
        </div>

        {/* TABLE */}
        <div style={{ marginTop: 14, overflowX: "auto", border, borderRadius: 14, background: surface }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Ordered", "Phase", "Item", "Qty", "Supplier", "Total", "For Tech", "For Store", "Arrived", "Added", "Receiving"].map(
                  (h) => (
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
                  )
                )}
              </tr>
            </thead>

            <tbody>
              {rows.map((o: Row) => {
                const unit = o.unitPrice ? Number(o.unitPrice) : 0;
                const ship = o.shippingCost ? Number(o.shippingCost) : 0;
                const tax = o.taxCost ? Number(o.taxCost) : 0;
                const totalCost = unit * (o.quantity ?? 0) + ship + tax;

                const itemLabel = o.item
                  ? `${o.item.sku}${o.item.partNumber ? ` • ${o.item.partNumber}` : ""} • ${o.item.name}`
                  : o.itemId;

                const canAdd = o.status === "ARRIVED";

                return (
                  <tr key={o.id} style={{ borderBottom: border, ...rowPhaseStyle(o.status as Phase) }}>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{fmtLocal(o.orderedAt)}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 900 }}>{phaseLabel(o.status as Phase)}</td>
                    <td style={{ padding: 10, minWidth: 320 }}>
                      <div style={{ fontWeight: 900 }}>{itemLabel}</div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>id: {o.id}</div>
                    </td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{o.quantity}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {o.supplierName ?? "—"}
                      {o.supplierPartNumber ? <div style={{ fontSize: 12, opacity: 0.75 }}>Part #: {o.supplierPartNumber}</div> : null}
                    </td>
                    <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 900 }}>{money(totalCost)}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{o.forUser?.name ?? "—"}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{o.forStore?.name ?? "—"}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{fmtLocal(o.arrivedAt)}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{fmtLocal(o.addedToInventoryAt)}</td>

                    <td style={{ padding: 10, verticalAlign: "top" }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <form action={addToInventoryAction}>
                          <input type="hidden" name="id" value={o.id} />
                          <button type="submit" style={{ ...btnPrimary, opacity: canAdd ? 1 : 0.5 }} disabled={!canAdd}>
                            Add to Inventory
                          </button>
                        </form>

                        <Link
                          href={`/admin/inventory-orders?q=${encodeURIComponent(o.id)}`}
                          style={{ ...btn, textDecoration: "none", display: "inline-block", opacity: 0.92 }}
                        >
                          View in History →
                        </Link>
                      </div>

                      {o.note ? (
                        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85, maxWidth: 440, whiteSpace: "pre-wrap" }}>
                          <b>Note:</b> {o.note}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}

              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ padding: 14, opacity: 0.8 }}>
                    No rows found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
          This screen is optimized for receiving. It focuses on <b>ARRIVED</b> rows, and uses the same colors as the other order pages.
        </div>
      </div>
    </main>
  );
}