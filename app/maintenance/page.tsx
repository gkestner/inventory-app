import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission, Role } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { CREATE_WORK_ORDERS_FOR_OTHERS } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SessionUser = {
  email?: string | null;
  role?: Role | null;
  name?: string | null;
};

export default async function MaintenanceHomePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const user = session.user as SessionUser;
  if (!user.email) redirect("/login");

  const perms = await loadUserPermissions(session);

  const canCheckout = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_CHECKOUT, Permission.CREATE_CHECKOUT]);
  const canWorkOrders =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_WORK_ORDERS,
      Permission.CREATE_WORK_ORDERS,
      Permission.UPDATE_OWN_WORK_ORDERS,
      Permission.SUBMIT_OWN_WORK_ORDERS,
    ]);
  const canTravelLog = canWorkOrders;
  const canLiveOrders = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_LIVE_ORDERS]);
  const canOfficeEntry = perms.allowAll || hasAnyPermission(perms, [CREATE_WORK_ORDERS_FOR_OTHERS]);

  const border = "1px solid var(--border)";

  const card: React.CSSProperties = {
    border,
    borderRadius: 14,
    background: "var(--surface)",
    boxShadow: "var(--shadow)",
    padding: 14,
    display: "grid",
    gap: 8,
  };

  const action: React.CSSProperties = {
    display: "inline-block",
    textDecoration: "none",
    padding: "8px 12px",
    borderRadius: 10,
    border,
    background: "var(--surface-2)",
    color: "var(--foreground)",
    fontWeight: 800,
    width: "fit-content",
  };

  return (
    <main>
      <div>
        <section
          style={{
            border,
            borderRadius: 16,
            background: "linear-gradient(150deg, color-mix(in srgb, var(--brand) 14%, var(--surface)) 0%, var(--surface) 65%)",
            boxShadow: "var(--shadow)",
            padding: 18,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Maintenance Hub</h1>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.5 }}>
            Start your day from one place: open work orders, log travel, process part checkouts, and monitor live order flow.
          </p>
        </section>

        <section
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          {canWorkOrders ? (
            <article style={card}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Work Orders</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                Create, update, and submit active work orders with full technician workflow support.
              </p>
              <Link href="/maintenance/work-orders" style={action}>
                Open Work Orders
              </Link>
            </article>
          ) : null}

          {canOfficeEntry ? (
            <article style={card}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Work Orders (Office Entry)</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                Enter work orders from paper forms on behalf of a technician by selecting the target user.
              </p>
              <Link href="/maintenance/work-orders/office-entry" style={action}>
                Open Office Entry
              </Link>
            </article>
          ) : null}

          {canTravelLog ? (
            <article style={card}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Travel Log</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                Track travel entries tied to your field work for accurate reporting and handoff.
              </p>
              <Link href="/maintenance/travel-log" style={action}>
                Open Travel Log
              </Link>
            </article>
          ) : null}

          {canCheckout ? (
            <article style={card}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Checkout</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                Check out inventory items to stores or technicians and flag parts that need reorder.
              </p>
              <Link href="/maintenance/checkout" style={action}>
                Open Checkout
              </Link>
            </article>
          ) : null}

          {canLiveOrders ? (
            <article style={card}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Live Orders</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                Watch operational order movement in real time for immediate status visibility.
              </p>
              <Link href="/employee/live-orders" style={action}>
                Open Live Orders
              </Link>
            </article>
          ) : null}
        </section>
      </div>
    </main>
  );
}
