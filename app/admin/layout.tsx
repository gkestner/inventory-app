// app/admin/layout.tsx
import type { ReactNode, CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Role, Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { loadUserPermissions, hasAnyPermission, type LoadedPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

async function requireAdmin() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const role = (session.user as unknown as { role?: Role | null } | null)?.role ?? null;
  if (role !== Role.ADMIN) redirect("/");

  return session;
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdmin();

  // load canonical permissions (this already returns LoadedPermissions)
  const sessionArg = session as unknown as Parameters<typeof loadUserPermissions>[0];
  const perms = (await loadUserPermissions(sessionArg)) as LoadedPermissions;

  const allowAll = !!perms.allowAll;

  const canItems =
    allowAll ||
    hasAnyPermission(perms, [
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_EDIT_ITEMS,
      Permission.ADMIN_IMPORT_EXPORT_ITEMS,
    ]);

  const canOrders = allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);

  const canUsers = allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_USERS, Permission.ADMIN_EDIT_USERS]);

  const canLocations =
    allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_LOCATIONS, Permission.ADMIN_EDIT_LOCATIONS]);

  const canWorkOrders =
    allowAll ||
    hasAnyPermission(perms, [
      Permission.ADMIN_VIEW_WORK_ORDERS,
      Permission.ADMIN_EDIT_WORK_ORDERS,
      Permission.ADMIN_DELETE_WORK_ORDERS,
    ]);

  const canTickets =
    allowAll ||
    hasAnyPermission(perms, [Permission.ADMIN_EXPORT_MAINTENANCE_TICKETS, Permission.ADMIN_VIEW_MAINTENANCE_TICKETS]);

  const wrap: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "260px minmax(0, 1fr)",
    minHeight: "100vh",
    background: "#f9fafb",
  };

  const sidebar: CSSProperties = {
    borderRight: "1px solid #e5e7eb",
    background: "#fff",
    padding: 14,
  };

  const main: CSSProperties = {
    padding: 0,
  };

  const brand: CSSProperties = {
    fontWeight: 900,
    fontSize: 16,
    marginBottom: 10,
  };

  const meta: CSSProperties = {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 14,
    lineHeight: 1.3,
  };

  const nav: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  };

  const linkStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "10px 10px",
    textDecoration: "none",
    color: "#111827",
    background: "#fff",
    fontSize: 13,
  };

  const pill: CSSProperties = {
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    color: "#374151",
    whiteSpace: "nowrap",
  };

  const sectionTitle: CSSProperties = {
    marginTop: 14,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: 800,
    color: "#374151",
    letterSpacing: 0.2,
  };

  const contentWrap: CSSProperties = {
    padding: 16,
  };

  const email = (session.user as unknown as { email?: string | null } | null)?.email ?? "—";

  return (
    <div style={wrap}>
      <aside style={sidebar}>
        <div style={brand}>Admin</div>
        <div style={meta}>
          <div>{email}</div>
          <div style={{ marginTop: 2 }}>Role: ADMIN</div>
        </div>

        <div style={sectionTitle}>Operations</div>
        <nav style={nav}>
          <Link href="/admin/live-orders" style={linkStyle}>
            <span>Live Orders Board</span>
            <span style={pill}>Live</span>
          </Link>

          {canOrders ? (
            <Link href="/admin/inventory-orders" style={linkStyle}>
              <span>Inventory Orders</span>
              <span style={pill}>History</span>
            </Link>
          ) : null}

          {canItems ? (
            <Link href="/admin/items" style={linkStyle}>
              <span>Items</span>
              <span style={pill}>Catalog</span>
            </Link>
          ) : null}
        </nav>

        <div style={sectionTitle}>Admin</div>
        <nav style={nav}>
          {canUsers ? (
            <Link href="/admin/users" style={linkStyle}>
              <span>Users</span>
              <span style={pill}>Security</span>
            </Link>
          ) : null}

          {canLocations ? (
            <Link href="/admin/locations" style={linkStyle}>
              <span>Locations</span>
              <span style={pill}>Setup</span>
            </Link>
          ) : null}

          {canWorkOrders ? (
            <Link href="/admin/work-orders" style={linkStyle}>
              <span>Work Orders</span>
              <span style={pill}>Ops</span>
            </Link>
          ) : null}

          {canTickets ? (
            <Link href="/admin/maintenance-tickets" style={linkStyle}>
              <span>Maintenance Tickets</span>
              <span style={pill}>Export</span>
            </Link>
          ) : null}
        </nav>

        <div style={{ marginTop: 16 }}>
          <Link href="/" style={{ ...linkStyle, justifyContent: "center" }}>
            ← Back to App
          </Link>
        </div>
      </aside>

      <section style={main}>
        <div style={contentWrap}>{children}</div>
      </section>
    </div>
  );
}