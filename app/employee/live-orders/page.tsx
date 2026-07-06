// app/employee/live-orders/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import LiveOrdersBoardControls from "@/app/components/LiveOrdersBoardControls";
import { Permission, Role } from "@prisma/client";
import {
  buildLiveOrderWaiterMap,
  isUserWaitingForLiveOrder,
  setLiveOrderNotificationPreference,
} from "@/app/lib/live-order-notifications";
import { loadAppConfig } from "@/app/lib/app-config";

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

async function resolveSessionUserId(session: AppSession): Promise<string> {
  const id = session?.user?.id ?? null;
  if (id) return id;

  const email = session?.user?.email ?? null;
  if (!email) return "";

  const exact = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (exact?.id) return exact.id;

  const insensitive = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  return insensitive?.id ?? "";
}

function safeReturnToPathFromReferer(referer: string | null): string {
  if (!referer) return "/employee/live-orders";
  try {
    const url = new URL(referer);
    const path = `${url.pathname}${url.search}`;
    return path.startsWith("/") ? path : "/employee/live-orders";
  } catch {
    return "/employee/live-orders";
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

function rowPhaseStyle(phase: string): CSSProperties {
  const orderedBg = "var(--order-ordered-bg, rgba(255, 193, 7, 0.20))";
  const arrivedBg = "var(--order-arrived-bg, rgba(33, 150, 243, 0.20))";
  const addedBg = "var(--order-added-bg, rgba(76, 175, 80, 0.24))";
  const cancelledBg = "rgba(244,67,54,0.16)";

  const orderedBar = "var(--order-ordered-bar, rgba(255, 193, 7, 0.92))";
  const arrivedBar = "var(--order-arrived-bar, rgba(33, 150, 243, 0.92))";
  const addedBar = "var(--order-added-bar, rgba(76, 175, 80, 0.95))";
  const cancelledBar = "rgba(244,67,54,0.92)";

  if (phase === "ORDERED") {
    return { background: orderedBg, borderLeft: `8px solid ${orderedBar}`, boxShadow: `inset 0 0 0 1px ${orderedBar}` };
  }
  if (phase === "ARRIVED") {
    return { background: arrivedBg, borderLeft: `8px solid ${arrivedBar}`, boxShadow: `inset 0 0 0 1px ${arrivedBar}` };
  }
  if (phase === "CANCELLED") {
    return { background: cancelledBg, borderLeft: `8px solid ${cancelledBar}`, boxShadow: `inset 0 0 0 1px ${cancelledBar}` };
  }
  return { background: addedBg, borderLeft: `8px solid ${addedBar}`, boxShadow: `inset 0 0 0 1px ${addedBar}` };
}

function phaseTextStyle(phase: string): CSSProperties {
  if (phase === "ORDERED") return { color: "var(--order-ordered-bar, rgba(255, 193, 7, 0.98))" };
  if (phase === "ARRIVED") return { color: "var(--order-arrived-bar, rgba(33, 150, 243, 0.98))" };
  if (phase === "CANCELLED") return { color: "rgba(244,67,54,0.98)" };
  return { color: "var(--order-added-bar, rgba(76, 175, 80, 0.98))" };
}

function phaseLabel(s: string): string {
  if (s === "ORDERED") return "ORDERED";
  if (s === "ARRIVED") return "ARRIVED";
  if (s === "CANCELLED") return "CANCELLED";
  return "ADDED TO INVENTORY";
}

function getLiveBoardRemovalDate(
  order: { status: string; addedToInventoryAt: Date | null; cancelledAt?: Date | null; orderedAt: Date },
  retentionDays: number,
): Date | null {
  if (order.status !== "ADDED_TO_INVENTORY" && order.status !== "CANCELLED") return null;
  const anchor = order.status === "CANCELLED" ? order.cancelledAt ?? order.orderedAt : order.addedToInventoryAt ?? order.orderedAt;
  return new Date(anchor.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

export default async function EmployeeLiveOrdersPage() {
  const { session } = await requireLiveOrdersView();
  const currentUserId = await resolveSessionUserId(session);
  if (!currentUserId) redirect("/");

  const { config: appConfig } = await loadAppConfig();
  const retentionDays = appConfig.liveOrdersAddedRetentionDays;

  async function toggleLiveOrderNotificationAction(formData: FormData) {
    "use server";

    const { session: actionSession } = await requireLiveOrdersView();
    const userId = await resolveSessionUserId(actionSession);
    if (!userId) throw new Error("Could not resolve your user id.");

    const orderId = String(formData.get("orderId") ?? "").trim();
    const enabled = String(formData.get("enabled") ?? "").trim() === "1";
    if (!orderId) throw new Error("Missing order id.");

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, uiPreferences: true },
    });
    if (!existingUser) throw new Error("User not found.");

    await prisma.user.update({
      where: { id: userId },
      data: {
        uiPreferences: setLiveOrderNotificationPreference(existingUser.uiPreferences, orderId, enabled),
      },
    });

    revalidatePath("/employee/live-orders");
    revalidatePath("/admin/live-orders");

    const h = await headers();
    redirect(safeReturnToPathFromReferer(h.get("referer")));
  }

  const now = new Date();
  const retentionCutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  const orders = await prisma.inventoryOrder.findMany({
    where: {
      hiddenFromUserLiveBoard: false,
      OR: [
        { status: { in: ["ORDERED", "ARRIVED"] } },
        {
          status: "ADDED_TO_INVENTORY",
          OR: [
            { addedToInventoryAt: { gte: retentionCutoff } },
            {
              addedToInventoryAt: null,
              orderedAt: { gte: retentionCutoff },
            },
          ],
        },
        {
          status: "CANCELLED",
          OR: [
            { cancelledAt: { gte: retentionCutoff } },
            {
              cancelledAt: null,
              orderedAt: { gte: retentionCutoff },
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
      cancelledAt: true,
      cancelReason: true,
      quantity: true,
      item: { select: { sku: true, name: true } },
    },
  });

  const waitlistUsers = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true, uiPreferences: true },
  });
  const waitersByOrderId = buildLiveOrderWaiterMap(
    waitlistUsers,
    orders.map((order) => order.id),
  );

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
    <div className="live-orders-page" style={wrap}>
      <LiveOrdersBoardControls defaultEnabled defaultIntervalSec={30} />

      <div className="live-orders-header" style={header}>
        <div>
          <h1 style={title}>Live Orders</h1>
          <div style={muted}>Shows Ordered → Arrived → Added to Inventory. Added items stay visible here for {retentionDays} day{retentionDays === 1 ? "" : "s"}.</div>
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

      <div className="live-orders-board" style={tableWrap}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Ordered Date</th>
              <th style={th}>Item</th>
              <th style={th}>Qty</th>
              <th style={th}>Status</th>
              <th className="live-orders-interactive" style={th}>Notify Me</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const canSubscribe = o.status !== "ADDED_TO_INVENTORY" && o.status !== "CANCELLED";
              const currentUserWaiting = isUserWaitingForLiveOrder(
                waitlistUsers.find((user) => user.id === currentUserId)?.uiPreferences,
                o.id,
              );
              const waiters = waitersByOrderId[o.id] ?? [];

              return (
                <tr key={o.id} style={rowPhaseStyle(o.status)}>
                  <td style={td}>{fmtDate(o.orderedAt)}</td>
                  <td style={td}>
                    <div style={{ display: "flex", flexDirection: "column", minHeight: 42, gap: 4 }}>
                      <div style={{ fontWeight: 900 }}>{o.item?.name ?? "—"}</div>
                      <div style={{ ...mono, opacity: 0.8 }}>{o.item?.sku ?? "—"}</div>
                      {o.status === "CANCELLED" ? (
                        <div style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                          Cancel reason: {o.cancelReason || "No reason entered"}
                        </div>
                      ) : null}
                      <div className="live-orders-interactive" style={{ fontSize: 11, opacity: 0.78, lineHeight: 1.35 }}>
                        {waiters.length > 0 ? `Waiting: ${waiters.map((waiter) => waiter.name).join(", ")}` : "No one is waiting for notifications yet."}
                      </div>
                      {getLiveBoardRemovalDate(o, retentionDays) ? (
                        <div style={{ marginTop: 4, alignSelf: "flex-end", fontSize: 11, opacity: 0.76, whiteSpace: "nowrap" }}>
                          Will be removed on {fmtDate(getLiveBoardRemovalDate(o, retentionDays))}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td style={{ ...td, fontWeight: 900 }}>{o.quantity}</td>
                  <td style={{ ...td, ...phaseTextStyle(o.status), fontWeight: 900 }}>{phaseLabel(o.status)}</td>
                  <td className="live-orders-interactive" style={{ ...td, whiteSpace: "nowrap" }}>
                    {canSubscribe ? (
                      <form action={toggleLiveOrderNotificationAction}>
                        <input type="hidden" name="orderId" value={o.id} />
                        <input type="hidden" name="enabled" value={currentUserWaiting ? "0" : "1"} />
                        <button
                          type="submit"
                          style={{
                            padding: "8px 10px",
                            borderRadius: 10,
                            border,
                            background: currentUserWaiting ? "rgba(76,175,80,0.18)" : soft,
                            color: fg,
                            fontWeight: 900,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {currentUserWaiting ? "Waiting for updates" : "Notify me"}
                        </button>
                      </form>
                    ) : (
                      <span style={{ opacity: 0.72, fontWeight: 900 }}>{o.status === "CANCELLED" ? "Cancelled" : "Already in stock"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {orders.length === 0 ? (
              <tr>
                <td style={{ ...td, padding: 16 }} colSpan={5}>
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
