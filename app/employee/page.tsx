// app/employee/page.tsx
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { VIEW_INVENTORY } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

type SessionUser = {
  email?: string | null;
};

export default async function EmployeeHomePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const user = session.user as SessionUser;
  const email = (user.email ?? "").trim().toLowerCase();
  if (!email) redirect("/");

  const perms = await loadUserPermissions(session);
  const canWorkOrders =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_WORK_ORDERS,
      Permission.CREATE_WORK_ORDERS,
      Permission.UPDATE_OWN_WORK_ORDERS,
      Permission.SUBMIT_OWN_WORK_ORDERS,
    ]);
  const canTravelLog = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_WORK_ORDERS]);
  const canInventory = perms.allowAll || hasAnyPermission(perms, [VIEW_INVENTORY, Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);

  const canSeeEmployeeDashboard =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_HOME,
      Permission.VIEW_CHECKOUT,
      VIEW_INVENTORY,
      Permission.VIEW_ROOM_DIAGRAMS,
      Permission.EDIT_QUICK_COUNT,
      Permission.VIEW_LIVE_ORDERS,
    ]) ||
    canWorkOrders;

  if (!canSeeEmployeeDashboard) redirect("/");

  const dbUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true },
  });

  if (!dbUser) redirect("/");

  const tickets = await prisma.partsCheckoutTicket.findMany({
    where: { createdByUserId: dbUser.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      status: true,
      storeName: true,
      quantity: true,
      nameSnapshot: true,
      createdAt: true,
    },
  });

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--surface)";
  const fg = "var(--foreground)";

  return (
    <main>
      <div style={{ maxWidth: 1100, margin: "0 auto", color: fg }}>
      <section
        style={{
          border,
          borderRadius: 16,
          background: "linear-gradient(150deg, color-mix(in srgb, var(--brand) 14%, var(--surface)) 0%, var(--surface) 68%)",
          boxShadow: "var(--shadow)",
          padding: 18,
        }}
      >
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Employee Dashboard</h1>
      <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.5 }}>
        Fast access to your daily tasks and recent ticket activity.
      </p>
      </section>

      <div
        style={{
          marginTop: 16,
          padding: 16,
          border,
          borderRadius: 14,
          background: surface,
          boxShadow: "var(--shadow)",
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 800 }}>Quick Actions</h2>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {canWorkOrders ? (
            <Link
              href="/work-orders"
              style={{
                display: "inline-block",
                padding: "8px 14px",
                borderRadius: 10,
                border,
                background: "var(--surface-2)",
                color: "var(--foreground)",
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              Work Orders
            </Link>
          ) : null}

          {canTravelLog ? (
            <Link
              href="/travel-log"
              style={{
                display: "inline-block",
                padding: "8px 14px",
                borderRadius: 10,
                border,
                background: "var(--surface-2)",
                color: "var(--foreground)",
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              Travel Log
            </Link>
          ) : null}

          {canInventory ? (
            <Link
              href="/inventory"
              style={{
                display: "inline-block",
                padding: "8px 14px",
                borderRadius: 10,
                border,
                background: "var(--surface-2)",
                color: "var(--foreground)",
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              Inventory
            </Link>
          ) : null}

          {!canWorkOrders && !canTravelLog ? (
            <p style={{ margin: 0, opacity: 0.75, fontSize: 14 }}>
              You currently do not have permission to open Work Orders or Travel Log.
            </p>
          ) : null}
        </div>
      </div>

      <div
        style={{
          marginTop: 20,
          padding: 16,
          border,
          borderRadius: 14,
          background: surface,
          boxShadow: "var(--shadow)",
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 800 }}>My Recent Tickets</h2>

        {tickets.length === 0 ? (
          <p style={{ marginTop: 10, opacity: 0.8 }}>No recent tickets.</p>
        ) : (
          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Part", "Store", "Qty", "Status", "Created"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: 8,
                        borderBottom: border,
                        fontSize: 13,
                        opacity: 0.85,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id}>
                    <td style={{ padding: 8, borderBottom: border }}>{t.nameSnapshot}</td>
                    <td style={{ padding: 8, borderBottom: border }}>{t.storeName}</td>
                    <td style={{ padding: 8, borderBottom: border }}>{t.quantity}</td>
                    <td style={{ padding: 8, borderBottom: border }}>{t.status}</td>
                    <td style={{ padding: 8, borderBottom: border }}>
                      {new Date(t.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>
    </main>
  );
}