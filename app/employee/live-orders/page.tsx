// app/employee/live-orders/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fmtDate(d: Date | null | undefined) {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

type Phase = "ORDERED" | "ARRIVED" | "ADDED_TO_INVENTORY";

function statusLabel(s: string): string {
  if (s === "ORDERED") return "Ordered";
  if (s === "ARRIVED") return "Arrived";
  if (s === "ADDED_TO_INVENTORY") return "Added to Inventory";
  return s;
}

function statusPillStyle(status: string): CSSProperties {
  const border = "1px solid rgba(128,128,128,0.25)";
  const soft = "rgba(255,255,255,0.03)";

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
    whiteSpace: "nowrap",
  };

  if (status === "ORDERED") return { ...base, background: "rgba(255,193,7,0.12)" };
  if (status === "ARRIVED") return { ...base, background: "rgba(33,150,243,0.12)" };
  if (status === "ADDED_TO_INVENTORY") return { ...base, background: "rgba(76,175,80,0.14)" };
  return base;
}

function rowHighlightStyle(status: string): CSSProperties {
  // Subtle row tint to match “phase” highlighting while keeping it readable.
  if (status === "ORDERED") return { background: "rgba(255,193,7,0.06)" };
  if (status === "ARRIVED") return { background: "rgba(33,150,243,0.06)" };
  if (status === "ADDED_TO_INVENTORY") return { background: "rgba(76,175,80,0.06)" };
  return {};
}

async function requireEmployeeLiveOrdersView() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  const ok = hasAnyPermission(perms, [Permission.VIEW_LIVE_ORDERS]);
  if (!ok) redirect("/");
}

export default async function EmployeeLiveOrdersPage() {
  await requireEmployeeLiveOrdersView();

  const orders = await prisma.inventoryOrder.findMany({
    orderBy: { orderedAt: "desc" },
    take: 200,
    select: {
      id: true,
      orderedAt: true,
      status: true,
      quantity: true,
      item: {
        select: {
          sku: true,
          name: true,
          partNumber: true,
        },
      },
    },
  });

  const border = "1px solid rgba(128,128,128,0.25)";
  const fg = "var(--foreground)";
  const surface = "var(--background)";
  const soft = "rgba(255,255,255,0.03)";

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

  const topLinks: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap" };
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

  const card: CSSProperties = { border, borderRadius: 14, padding: 14, background: surface };

  const tableWrap: CSSProperties = { border, borderRadius: 14, overflowX: "auto", background: surface };
  const table: CSSProperties = { width: "100%", borderCollapse: "collapse", minWidth: 760 };

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

  const mono: CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" };

  return (
    <div style={wrap}>
      <div style={headerRow}>
        <div>
          <h1 style={h1}>Live Orders</h1>
          <div style={muted}>Read-only board: ordered date, item, quantity, and status (Ordered / Arrived / Added to Inventory).</div>
        </div>

        <div style={topLinks}>
          <Link href="/employee" style={topLinkStyle}>
            Employee Dashboard
          </Link>
        </div>
      </div>

      {orders.length === 0 ? (
        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 6, opacity: 0.9 }}>No orders found</div>
          <div style={muted}>Once orders exist, they’ll appear here.</div>
        </div>
      ) : (
        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Ordered</th>
                <th style={th}>Status</th>
                <th style={th}>Item</th>
                <th style={th}>Qty</th>
              </tr>
            </thead>

            <tbody>
              {orders.map((o) => {
                const s = String(o.status ?? "—");
                const label = statusLabel(s);

                return (
                  <tr key={o.id} style={rowHighlightStyle(s)}>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDate(o.orderedAt)}</td>

                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <span style={statusPillStyle(s)}>{label}</span>
                    </td>

                    <td style={td}>
                      <div style={{ fontWeight: 900, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span style={mono}>{o.item.sku}</span>
                        <span>{o.item.name}</span>
                      </div>

                      {o.item.partNumber ? (
                        <div style={{ marginTop: 4, fontSize: 12, opacity: 0.72, lineHeight: 1.35 }}>
                          Part: {o.item.partNumber}
                        </div>
                      ) : null}
                    </td>

                    <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 900 }}>{o.quantity}</td>
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