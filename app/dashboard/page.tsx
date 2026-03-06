import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission } from "@prisma/client";
import type { CSSProperties } from "react";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import {
  CREATE_RECEIPTS,
  CREATE_WORK_ORDERS_FOR_OTHERS,
  VIEW_COMPANY_VEHICLE_LOG,
  VIEW_EQUIPMENT_TRACKING,
  VIEW_MAINTENANCE_REQUESTS,
  VIEW_PREVENTATIVE_MAINTENANCE,
  VIEW_RECEIPTS,
  VIEW_TEMPERATURE_DASHBOARD,
} from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SessionShape = {
  user?: {
    email?: string | null;
    name?: string | null;
  } | null;
} | null;

export default async function DashboardPage() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);

  const canMaintenanceHub =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_HOME,
      Permission.VIEW_WORK_ORDERS,
      Permission.CREATE_WORK_ORDERS,
      CREATE_WORK_ORDERS_FOR_OTHERS,
      Permission.UPDATE_OWN_WORK_ORDERS,
      Permission.SUBMIT_OWN_WORK_ORDERS,
      Permission.VIEW_CHECKOUT,
      Permission.CREATE_CHECKOUT,
      Permission.VIEW_LIVE_ORDERS,
      VIEW_PREVENTATIVE_MAINTENANCE,
      VIEW_EQUIPMENT_TRACKING,
      VIEW_COMPANY_VEHICLE_LOG,
      VIEW_MAINTENANCE_REQUESTS,
      VIEW_TEMPERATURE_DASHBOARD,
      VIEW_RECEIPTS,
      CREATE_RECEIPTS,
    ]);

  const canAdmin =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_VIEW_USERS,
      Permission.ADMIN_VIEW_LOCATIONS,
      Permission.ADMIN_VIEW_WORK_ORDERS,
      Permission.ADMIN_VIEW_MAINTENANCE_TICKETS,
    ]);

  const card: CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 14,
    background: "var(--surface)",
    boxShadow: "var(--shadow)",
    padding: 14,
    display: "grid",
    gap: 8,
  };

  const action: CSSProperties = {
    display: "inline-block",
    textDecoration: "none",
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--surface-2)",
    color: "var(--foreground)",
    fontWeight: 800,
    width: "fit-content",
  };

  return (
    <main style={{ padding: 16 }}>
      <section
        style={{
          border: "1px solid var(--border)",
          borderRadius: 16,
          background: "linear-gradient(150deg, color-mix(in srgb, var(--brand) 12%, var(--surface)) 0%, var(--surface) 70%)",
          boxShadow: "var(--shadow)",
          padding: 18,
          marginBottom: 14,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Dashboard</h1>
        <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
          Welcome{session.user?.name ? `, ${session.user.name}` : ""}. Choose a workspace below.
        </p>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {canMaintenanceHub ? (
          <article style={card}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Maintenance</h2>
            <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.45 }}>
              Work orders, checkout, PM lists, equipment tracking, and operations tools.
            </p>
            <Link href="/maintenance" style={action}>
              Open Maintenance Hub
            </Link>
          </article>
        ) : null}

        {canAdmin ? (
          <article style={card}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Admin</h2>
            <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.45 }}>
              Administrative tools for inventory, users, locations, reporting, and audits.
            </p>
            <Link href="/admin" style={action}>
              Open Admin
            </Link>
          </article>
        ) : null}

        <article style={card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Notifications</h2>
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.45 }}>
            Review unread alerts and workflow updates assigned to your account.
          </p>
          <Link href="/notifications" style={action}>
            Open Notifications
          </Link>
        </article>

        <article style={card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Settings</h2>
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.45 }}>
            Manage your profile and interface preferences.
          </p>
          <Link href="/settings" style={action}>
            Open Settings
          </Link>
        </article>
      </section>
    </main>
  );
}
