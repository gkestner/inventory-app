// app/maintenance/page.tsx
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { Permission, Role } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

type SessionUser = {
  email?: string | null;
  role?: Role;
  name?: string | null;
};

function isAllowed(role: Role | undefined) {
  return role === Role.EMPLOYEE || role === Role.MANAGER || role === Role.ADMIN;
}

export default async function MaintenanceHomePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const user = session.user as SessionUser;

  const email = (user.email ?? "").trim().toLowerCase();
  if (!email) redirect("/");

  if (!isAllowed(user.role)) redirect("/");

  const perms = await loadUserPermissions(session);

  const canCheckout =
    user.role !== Role.EMPLOYEE && hasAnyPermission(perms, [Permission.VIEW_CHECKOUT, Permission.CREATE_CHECKOUT]);
  const canWorkOrders = user.role === Role.EMPLOYEE || hasAnyPermission(perms, [Permission.VIEW_WORK_ORDERS]);

  // ✅ Don’t rely on session.user.id (may not exist). Resolve user id from DB by email.
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
  const surface = "var(--background)";
  const fg = "var(--foreground)";

  return (
    <main style={{ padding: 24, maxWidth: 1000, margin: "0 auto", color: fg }}>
      <h1 style={{ fontSize: 24, fontWeight: 900 }}>Maintenance</h1>

      <div
        style={{
          marginTop: 16,
          padding: 16,
          border,
          borderRadius: 12,
          background: surface,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 800 }}>Quick Actions</h2>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {canCheckout ? (
            <Link
              href="/maintenance/checkout"
              style={{
                display: "inline-block",
                padding: "8px 14px",
                borderRadius: 10,
                border,
                background: surface,
                color: fg,
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              Checkout Parts
            </Link>
          ) : null}

          {canWorkOrders ? (
            <Link
              href="/maintenance/work-orders"
              style={{
                display: "inline-block",
                padding: "8px 14px",
                borderRadius: 10,
                border,
                background: surface,
                color: fg,
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              Work Orders
            </Link>
          ) : null}

          {!canCheckout && !canWorkOrders ? (
            <p style={{ margin: 0, opacity: 0.75, fontSize: 14 }}>
              You currently do not have permission to open Checkout or Work Orders.
            </p>
          ) : null}
        </div>
      </div>

      <div
        style={{
          marginTop: 20,
          padding: 16,
          border,
          borderRadius: 12,
          background: surface,
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
    </main>
  );
}
