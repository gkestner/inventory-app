// app/admin/live-orders/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { loadUserPermissions, hasAnyPermission } from "@/app/lib/permissions";
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

async function requireLiveOrdersAccess() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  const role = session?.user?.role ?? null;

  const canView =
    role === Role.ADMIN ||
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_VIEW_WORK_ORDERS,
      Permission.ADMIN_EDIT_WORK_ORDERS,
    ]);

  if (!canView) redirect("/");

  return { session, perms };
}

function fmtDateTime(d: Date | null | undefined) {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

function fmtMoney(v: unknown) {
  if (v == null) return "—";
  const s =
    typeof v === "string"
      ? v
      : typeof v === "number"
        ? String(v)
        : (v as any)?.toString?.() ?? String(v);
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default async function LiveOrdersPage() {
  await requireLiveOrdersAccess();

  const orders = await prisma.inventoryOrder.findMany({
    orderBy: { orderedAt: "desc" },
    take: 100,
    include: {
      item: {
        select: {
          id: true,
          sku: true,
          partNumber: true,
          name: true,
          vendor: true,
          cost: true,
          price: true,
          active: true,
        },
      },
      forStore: {
        select: {
          id: true,
          name: true,
          locationNumber: true,
        },
      },
      forUser: {
        select: {
          id: true,
          name: true,
          email: true,
          active: true,
        },
      },
      createdByUser: {
        select: {
          id: true,
          name: true,
          email: true,
          active: true,
        },
      },
    },
  });

  type OrderRow = (typeof orders)[number];

  // === Theme-safe tokens (match your admin dark look) ===
  const border = "1px solid rgba(128,128,128,0.25)";
  const fg = "var(--foreground)";
  const surface = "var(--background)";
  const soft = "rgba(255,255,255,0.03)";
  const soft2 = "rgba(255,255,255,0.06)";

  const wrap: CSSProperties = {
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    color: fg,
  };

  const headerRow: CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  };

  const h1: CSSProperties = { fontSize: 20, fontWeight: 900, margin: 0 };

  const muted: CSSProperties = { opacity: 0.75, fontSize: 12, lineHeight: 1.35 };

  const topLinks: CSSProperties = {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  };

  const topLinkStyle: CSSProperties = {
    fontSize: 13,
    textDecoration: "none",
    padding: "8px 10px",
    borderRadius: 10,
    border,
    background: surface,
    color: fg,
    fontWeight: 900,
    opacity: 0.92,
  };

  const card: CSSProperties = {
    border,
    borderRadius: 14,
    padding: 14,
    background: surface,
  };

  const tableWrap: CSSProperties = {
    border,
    borderRadius: 14,
    overflowX: "auto",
    background: surface,
  };

  const table: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 1050,
  };

  const th: CSSProperties = {
    textAlign: "left",
    fontSize: 12,
    padding: "10px 10px",
    borderBottom: border,
    background: soft,
    whiteSpace: "nowrap",
    fontWeight: 900,
    opacity: 0.9,
  };

  const td: CSSProperties = {
    padding: "10px 10px",
    borderBottom: "1px solid rgba(128,128,128,0.18)",
    verticalAlign: "top",
    fontSize: 13,
  };

  const mono: CSSProperties = {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  };

  const right: CSSProperties = { textAlign: "right", whiteSpace: "nowrap" };

  function statusPillStyle(status: string): CSSProperties {
    // subtle in dark mode, readable
    const base: CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      padding: "4px 10px",
      borderRadius: 999,
      border,
      fontWeight: 900,
      fontSize: 12,
      background: soft,
      opacity: 0.95,
    };

    if (status === "ORDERED") return { ...base, background: "rgba(255,193,7,0.12)" };
    if (status === "ARRIVED") return { ...base, background: "rgba(33,150,243,0.12)" };
    if (status === "ADDED_TO_INVENTORY") return { ...base, background: "rgba(76,175,80,0.14)" };
    return base;
  }

  return (
    <div style={wrap}>
      <div style={headerRow}>
        <div>
          <h1 style={h1}>Live Orders</h1>
          <div style={muted}>Each row is one InventoryOrder (item + quantity). Refresh to see updates.</div>
        </div>

        <div style={topLinks}>
          <Link href="/admin/inventory-orders" style={topLinkStyle}>
            Inventory Orders
          </Link>
          <Link href="/admin/items" style={topLinkStyle}>
            Items
          </Link>
        </div>
      </div>

      {orders.length === 0 ? (
        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 6, opacity: 0.9 }}>No inventory orders found</div>
          <div style={muted}>Once orders exist, they’ll appear here.</div>
        </div>
      ) : (
        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Ordered</th>
                <th style={th}>Status</th>
                <th style={th}>Vendor</th>
                <th style={th}>Item</th>
                <th style={th}>For Store</th>
                <th style={th}>For User</th>
                <th style={th}>Qty</th>
                <th style={{ ...th, ...right }}>Unit</th>
                <th style={{ ...th, ...right }}>Ship</th>
                <th style={{ ...th, ...right }}>Tax</th>
                <th style={th}>Created By</th>
                <th style={th}>Note</th>
              </tr>
            </thead>

            <tbody>
              {orders.map((o: OrderRow) => {
                const storeLabel = o.forStore
                  ? `${o.forStore.name}${o.forStore.locationNumber ? ` (#${o.forStore.locationNumber})` : ""}`
                  : "—";
                const userLabel = o.forUser ? `${o.forUser.name} (${o.forUser.email})` : "—";
                const createdByLabel = o.createdByUser ? `${o.createdByUser.name} (${o.createdByUser.email})` : "—";

                return (
                  <tr key={o.id}>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDateTime(o.orderedAt)}</td>

                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <span style={statusPillStyle(String(o.status))}>{String(o.status)}</span>
                    </td>

                    <td style={{ ...td, whiteSpace: "nowrap" }}>{String(o.vendor)}</td>

                    <td style={td}>
                      <div style={{ fontWeight: 900, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span style={mono}>{o.item.sku}</span>
                        <span>{o.item.name}</span>
                      </div>

                      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.72, lineHeight: 1.35 }}>
                        {o.item.partNumber ? <>Part: {o.item.partNumber} • </> : null}
                        Default Vendor: {String(o.item.vendor)}
                        {o.item.active ? "" : " • INACTIVE"}
                      </div>
                    </td>

                    <td style={td}>{storeLabel}</td>
                    <td style={td}>{userLabel}</td>

                    <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 900 }}>{o.quantity}</td>
                    <td style={{ ...td, ...right }}>{fmtMoney(o.unitPrice)}</td>
                    <td style={{ ...td, ...right }}>{fmtMoney(o.shippingCost)}</td>
                    <td style={{ ...td, ...right }}>{fmtMoney(o.taxCost)}</td>

                    <td style={td}>{createdByLabel}</td>

                    <td style={td}>
                      {o.note ? (
                        <div style={{ whiteSpace: "pre-wrap" }}>{o.note}</div>
                      ) : (
                        <span style={muted}>—</span>
                      )}
                      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.6 }}>
                        <span style={{ ...mono, background: soft2, padding: "2px 6px", borderRadius: 8, border }}>
                          {o.id}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}