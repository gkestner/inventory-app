// app/admin/live-orders/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { loadUserPermissions, hasAnyPermission } from "@/app/lib/permissions";
import LiveOrdersBoardControls from "@/app/components/LiveOrdersBoardControls";
import { Permission, Role } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIVE_BOARD_RETENTION_DAYS = 14;

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

  const canEdit =
    role === Role.ADMIN ||
    perms.allowAll ||
    hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);

  return { session, perms, canEdit };
}

function safeReturnToPathFromReferer(referer: string | null): string {
  if (!referer) return "/admin/live-orders";
  try {
    const u = new URL(referer);
    const path = `${u.pathname}${u.search}`;
    return path.startsWith("/") ? path : "/admin/live-orders";
  } catch {
    return "/admin/live-orders";
  }
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

function fmtDate(d: Date | null | undefined) {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function getLiveBoardRemovalDate(order: { status: string; addedToInventoryAt: Date | null; orderedAt: Date }): Date | null {
  if (order.status !== "ADDED_TO_INVENTORY") return null;
  const anchor = order.addedToInventoryAt ?? order.orderedAt;
  return new Date(anchor.getTime() + LIVE_BOARD_RETENTION_DAYS * 24 * 60 * 60 * 1000);
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

function rowPhaseStyle(phase: string): CSSProperties {
  const orderedBg = "var(--order-ordered-bg, rgba(255, 193, 7, 0.20))";
  const arrivedBg = "var(--order-arrived-bg, rgba(33, 150, 243, 0.20))";
  const addedBg = "var(--order-added-bg, rgba(76, 175, 80, 0.24))";

  const orderedBar = "var(--order-ordered-bar, rgba(255, 193, 7, 0.92))";
  const arrivedBar = "var(--order-arrived-bar, rgba(33, 150, 243, 0.92))";
  const addedBar = "var(--order-added-bar, rgba(76, 175, 80, 0.95))";

  if (phase === "ORDERED") {
    return { background: orderedBg, borderLeft: `8px solid ${orderedBar}`, boxShadow: `inset 0 0 0 1px ${orderedBar}` };
  }
  if (phase === "ARRIVED") {
    return { background: arrivedBg, borderLeft: `8px solid ${arrivedBar}`, boxShadow: `inset 0 0 0 1px ${arrivedBar}` };
  }
  return { background: addedBg, borderLeft: `8px solid ${addedBar}`, boxShadow: `inset 0 0 0 1px ${addedBar}` };
}

function phaseTextStyle(phase: string): CSSProperties {
  if (phase === "ORDERED") return { color: "var(--order-ordered-bar, rgba(255, 193, 7, 0.98))" };
  if (phase === "ARRIVED") return { color: "var(--order-arrived-bar, rgba(33, 150, 243, 0.98))" };
  return { color: "var(--order-added-bar, rgba(76, 175, 80, 0.98))" };
}

export default async function LiveOrdersPage() {
  const { canEdit } = await requireLiveOrdersAccess();

  async function setHiddenFromUserBoardAction(formData: FormData) {
    "use server";
    const { canEdit: ok } = await requireLiveOrdersAccess();
    if (!ok) throw new Error("Forbidden");

    const id = String(formData.get("id") ?? "").trim();
    const nextHidden = String(formData.get("hidden") ?? "").trim() === "1";

    if (!id) throw new Error("Missing order id");

    await prisma.inventoryOrder.update({
      where: { id },
      data: { hiddenFromUserLiveBoard: nextHidden },
    });

    // refresh both boards
    revalidatePath("/admin/live-orders");
    revalidatePath("/employee/live-orders");

    const h = await headers();
    redirect(safeReturnToPathFromReferer(h.get("referer")));
  }

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

  const tableWrap: CSSProperties = {
    border,
    borderRadius: 14,
    overflowX: "hidden",
    background: surface,
  };

  const table: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
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

  const btn: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 10px",
    borderRadius: 10,
    border,
    background: soft2,
    color: fg,
    fontWeight: 900,
    fontSize: 12,
    cursor: "pointer",
    textDecoration: "none",
    whiteSpace: "nowrap",
  };

  const badge = (hidden: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 999,
    border,
    fontWeight: 900,
    fontSize: 12,
    background: hidden ? "rgba(220,38,38,0.12)" : "rgba(76,175,80,0.12)",
    opacity: 0.95,
  });

  return (
    <div className="live-orders-page" style={wrap}>
      <LiveOrdersBoardControls defaultEnabled defaultIntervalSec={30} />

      <div className="live-orders-header" style={headerRow}>
        <div>
          <h1 style={h1}>Admin: Live Orders</h1>
          <div style={muted}>
            Shows last 100 orders. Use “Hide” to remove an order from the general-user Live Orders board.
          </div>
        </div>

        <div style={topLinks}>
          <Link href="/admin/inventory-orders" style={topLinkStyle}>
            Order History
          </Link>
          <Link href="/admin" style={topLinkStyle}>
            Admin
          </Link>
        </div>
      </div>

      <div className="live-orders-board" style={tableWrap}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Ordered</th>
              <th style={th}>Status</th>
              <th style={th}>Item</th>
              <th style={th}>Qty</th>
              <th style={th}>Store</th>
              <th style={th}>For User</th>
              <th style={th}>Created By</th>
              <th style={th}>Unit</th>
              <th style={th}>Ship</th>
              <th style={th}>Tax</th>
              <th style={th}>User Board</th>
              <th style={{ ...th, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {orders.map((o) => {
              const hidden = (o as any).hiddenFromUserLiveBoard === true;
              const removalDate = getLiveBoardRemovalDate(o);

              return (
                <tr key={o.id} style={rowPhaseStyle(o.status)}>
                  <td style={td}>{fmtDateTime(o.orderedAt)}</td>
                  <td style={td}>
                    <span style={{ ...mono, ...phaseTextStyle(o.status), fontWeight: 900 }}>{o.status}</span>
                  </td>
                  <td style={td}>
                    <div style={{ display: "flex", flexDirection: "column", minHeight: 42 }}>
                      <div style={{ fontWeight: 900 }}>{o.item?.name ?? "—"}</div>
                      <div style={{ ...mono, opacity: 0.8 }}>
                        {o.item?.sku ?? "—"}
                        {o.item?.partNumber ? ` · ${o.item.partNumber}` : ""}
                      </div>
                      {removalDate ? (
                        <div style={{ marginTop: 4, alignSelf: "flex-end", fontSize: 11, opacity: 0.76, whiteSpace: "nowrap" }}>
                          Will be removed on {fmtDate(removalDate)}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td style={{ ...td, ...right, fontWeight: 900 }}>{o.quantity}</td>
                  <td style={td}>
                    {o.forStore?.name ?? "—"}
                    {o.forStore?.locationNumber ? <span style={{ ...mono, opacity: 0.75 }}> · #{o.forStore.locationNumber}</span> : null}
                  </td>
                  <td style={td}>{o.forUser?.name ?? "—"}</td>
                  <td style={td}>{o.createdByUser?.name ?? "—"}</td>
                  <td style={{ ...td, ...right }}>{fmtMoney(o.unitPrice)}</td>
                  <td style={{ ...td, ...right }}>{fmtMoney(o.shippingCost)}</td>
                  <td style={{ ...td, ...right }}>{fmtMoney(o.taxCost)}</td>

                  <td style={td}>
                    <span style={badge(hidden)}>{hidden ? "HIDDEN" : "VISIBLE"}</span>
                  </td>

                  <td style={{ ...td, textAlign: "right" }}>
                    {canEdit ? (
                      <form action={setHiddenFromUserBoardAction} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={o.id} />
                        <input type="hidden" name="hidden" value={hidden ? "0" : "1"} />
                        <button type="submit" style={btn}>
                          {hidden ? "Show" : "Hide"}
                        </button>
                      </form>
                    ) : (
                      <span style={{ opacity: 0.6 }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}

            {orders.length === 0 ? (
              <tr>
                <td style={{ ...td, padding: 16 }} colSpan={12}>
                  No orders found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}