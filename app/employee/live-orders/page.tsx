// app/employee/live-orders/page.tsx
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

type AppSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
    name?: string | null;
  } | null;
} | null;

async function requireLiveOrdersView() {
  const session = (await getServerSession(authOptions)) as AppSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  const ok = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_LIVE_ORDERS]);

  if (!ok) redirect("/");

  return { session, perms };
}

function fmtDate(d: Date | null | undefined) {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function rowPhaseStyle(phase: string): CSSProperties {
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

function phaseLabel(s: string): string {
  if (s === "ORDERED") return "ORDERED";
  if (s === "ARRIVED") return "ARRIVED";
  return "ADDED TO INVENTORY";
}

export default async function EmployeeLiveOrdersPage() {
  await requireLiveOrdersView();

  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const orders = await prisma.inventoryOrder.findMany({
    where: {
      hiddenFromUserLiveBoard: false,
      OR: [
        { status: { not: "ADDED_TO_INVENTORY" } },
        {
          status: "ADDED_TO_INVENTORY",
          OR: [
            { addedToInventoryAt: { gte: twoWeeksAgo } },
            {
              addedToInventoryAt: null,
              orderedAt: { gte: twoWeeksAgo },
            },
          ],
        },
      ],
    },
    orderBy: { orderedAt: "desc" },
    take: 200,
    select: {
      id: true,
      status: true,
      orderedAt: true,
      addedToInventoryAt: true,
      quantity: true,
      item: { select: { sku: true, name: true } },
    },
  });

  const border = "1px solid rgba(128,128,128,0.25)";
  const fg = "var(--foreground)";
  const surface = "var(--background)";
  const soft = "rgba(255,255,255,0.03)";

  const wrap: CSSProperties = { padding: 16, color: fg, display: "grid", gap: 12 };

  const header: CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  };

  const title: CSSProperties = { fontSize: 20, fontWeight: 900, margin: 0 };
  const muted: CSSProperties = { opacity: 0.75, fontSize: 12, lineHeight: 1.35 };

  const tableWrap: CSSProperties = { border, borderRadius: 14, overflowX: "hidden", background: surface };
  const table: CSSProperties = { width: "100%", borderCollapse: "collapse" };

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

  return (
    <div style={wrap}>
      <div style={header}>
        <div>
          <h1 style={title}>Live Orders</h1>
          <div style={muted}>Shows Ordered → Arrived → Added to Inventory. Added items stay visible here for 14 days.</div>
        </div>

        <Link
          href="/"
          style={{
            textDecoration: "none",
            padding: "8px 10px",
            borderRadius: 10,
            border,
            background: surface,
            color: fg,
            fontWeight: 900,
            opacity: 0.92,
          }}
        >
          Home
        </Link>
      </div>

      <div style={tableWrap}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Ordered Date</th>
              <th style={th}>Item</th>
              <th style={th}>Qty</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} style={rowPhaseStyle(o.status)}>
                <td style={td}>{fmtDate(o.orderedAt)}</td>
                <td style={td}>
                  <div style={{ fontWeight: 900 }}>{o.item?.name ?? "—"}</div>
                  <div style={{ ...mono, opacity: 0.8 }}>{o.item?.sku ?? "—"}</div>
                </td>
                <td style={{ ...td, fontWeight: 900 }}>{o.quantity}</td>
                <td style={{ ...td, fontWeight: 900 }}>{phaseLabel(o.status)}</td>
              </tr>
            ))}
            {orders.length === 0 ? (
              <tr>
                <td style={{ ...td, padding: 16 }} colSpan={4}>
                  No visible orders.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}