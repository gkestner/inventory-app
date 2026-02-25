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

  // Prefer permissions if your app uses them; otherwise allow ADMIN role.
  const perms = await loadUserPermissions(session);
  const role = session?.user?.role ?? null;

  const canView =
    role === Role.ADMIN ||
    perms.allowAll ||
    hasAnyPermission(perms, [
      // If you have a specific permission for this page, put it here.
      Permission.ADMIN_VIEW_WORK_ORDERS,
      Permission.ADMIN_EDIT_WORK_ORDERS,
      Permission.ADMIN_VIEW_ITEMS,
    ]);

  if (!canView) redirect("/");

  return { session, perms };
}

function fmtDate(d: Date) {
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

export default async function LiveOrdersPage() {
  await requireLiveOrdersAccess();

  // 1) Fetch recent orders (adjust filters as needed)
  const orders = await prisma.inventoryOrder.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const orderIds = orders.map((o) => o.id);

  // 2) Fetch lines separately (avoids Prisma include typing on InventoryOrder)
  // NOTE:
  // - If your model is named differently, change `inventoryOrderLine` accordingly.
  // - If your FK field is not `orderId`, change it below (common alternative: `inventoryOrderId`).
  const lines = orderIds.length
    ? await prisma.inventoryOrderLine.findMany({
        where: {
          orderId: { in: orderIds }, // <-- change to inventoryOrderId if needed
        },
        include: {
          item: true,
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const linesByOrderId = new Map<string, typeof lines>();
  for (const ln of lines) {
    const key = (ln as unknown as { orderId?: string; inventoryOrderId?: string }).orderId ?? (ln as any).inventoryOrderId;
    if (!key) continue;
    const arr = linesByOrderId.get(key) ?? [];
    arr.push(ln);
    linesByOrderId.set(key, arr);
  }

  const wrap: CSSProperties = {
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  };

  const card: CSSProperties = {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 12,
    background: "white",
  };

  const row: CSSProperties = {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "baseline",
    justifyContent: "space-between",
  };

  const muted: CSSProperties = { color: "#6b7280", fontSize: 12 };
  const h1: CSSProperties = { fontSize: 20, fontWeight: 700, margin: 0 };

  const table: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    marginTop: 10,
  };

  const th: CSSProperties = {
    textAlign: "left",
    fontSize: 12,
    color: "#374151",
    padding: "8px 6px",
    borderBottom: "1px solid #e5e7eb",
    background: "#fafafa",
  };

  const td: CSSProperties = {
    padding: "8px 6px",
    borderBottom: "1px solid #f1f5f9",
    verticalAlign: "top",
    fontSize: 13,
  };

  return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={h1}>Live Orders</h1>
          <div style={muted}>Most recent inventory orders + their lines (auto-updates on refresh).</div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/admin/inventory-orders" style={{ fontSize: 13, textDecoration: "underline" }}>
            Inventory Orders
          </Link>
          <Link href="/admin/items" style={{ fontSize: 13, textDecoration: "underline" }}>
            Items
          </Link>
        </div>
      </div>

      {orders.length === 0 ? (
        <div style={card}>
          <div style={{ fontWeight: 600 }}>No orders found</div>
          <div style={muted}>Once orders exist, they’ll appear here.</div>
        </div>
      ) : (
        orders.map((o) => {
          const oAny = o as any;
          const oLines = linesByOrderId.get(o.id) ?? [];

          const vendor = oAny.vendor ?? oAny.invoiceVendor ?? null;
          const status = oAny.status ?? oAny.phase ?? oAny.state ?? null;

          return (
            <div key={o.id} style={card}>
              <div style={row}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    Order{" "}
                    <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                      {oAny.orderNumber ?? o.id.slice(0, 8)}
                    </span>
                  </div>
                  <div style={muted}>
                    Created: {fmtDate(o.createdAt)} • Updated: {fmtDate(o.updatedAt)}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {vendor ? (
                    <span style={{ ...muted, border: "1px solid #e5e7eb", padding: "2px 8px", borderRadius: 999 }}>
                      Vendor: {String(vendor)}
                    </span>
                  ) : null}
                  {status ? (
                    <span style={{ ...muted, border: "1px solid #e5e7eb", padding: "2px 8px", borderRadius: 999 }}>
                      Status: {String(status)}
                    </span>
                  ) : null}
                </div>
              </div>

              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>SKU</th>
                    <th style={th}>Item</th>
                    <th style={th}>Qty</th>
                    <th style={th}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {oLines.length === 0 ? (
                    <tr>
                      <td style={td} colSpan={4}>
                        <span style={muted}>No lines found for this order.</span>
                      </td>
                    </tr>
                  ) : (
                    oLines.map((ln) => {
                      const lnAny = ln as any;
                      const item = lnAny.item as any | null;
                      const qty = lnAny.qty ?? lnAny.quantity ?? lnAny.orderedQty ?? null;

                      return (
                        <tr key={ln.id}>
                          <td style={td}>
                            {item?.sku ? (
                              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                                {item.sku}
                              </span>
                            ) : (
                              <span style={muted}>—</span>
                            )}
                          </td>
                          <td style={td}>
                            <div style={{ fontWeight: 600 }}>{item?.name ?? item?.description ?? "Unknown item"}</div>
                            {item?.partNumber ? <div style={muted}>Part: {item.partNumber}</div> : null}
                          </td>
                          <td style={td}>{qty ?? <span style={muted}>—</span>}</td>
                          <td style={td}>{lnAny.note ?? lnAny.notes ?? lnAny.comment ?? <span style={muted}>—</span>}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </div>
  );
}