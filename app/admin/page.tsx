// app/admin/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Role, Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

type PermissionsResult = {
  allowAll: boolean;
  permissions: Set<Permission>;
};

async function requireAdmin() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const role = (session.user as unknown as { role?: Role | null } | null)?.role ?? null;
  if (role !== Role.ADMIN) redirect("/");

  return session;
}

function hasAnyPermissionLocal(perms: PermissionsResult, required: Permission[]) {
  if (perms.allowAll) return true;
  for (const p of required) {
    if (perms.permissions.has(p)) return true;
  }
  return false;
}

export default async function AdminHomePage() {
  const session = await requireAdmin();

  // loadUserPermissions returns a value that we treat as PermissionsResult here,
  // matching your actual usage across the app.
  const sessionArg = session as unknown as Parameters<typeof loadUserPermissions>[0];
  const perms = (await loadUserPermissions(sessionArg)) as unknown as PermissionsResult;

  const canItems =
    perms.allowAll ||
    hasAnyPermissionLocal(perms, [
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_EDIT_ITEMS,
      Permission.ADMIN_IMPORT_EXPORT_ITEMS,
    ]);

  const canOrders =
    perms.allowAll ||
    hasAnyPermissionLocal(perms, [
      Permission.ADMIN_VIEW_WORK_ORDERS,
      Permission.ADMIN_EDIT_WORK_ORDERS,
      Permission.ADMIN_DELETE_WORK_ORDERS,
    ]) ||
    // inventory orders often align with items permissions
    hasAnyPermissionLocal(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);

  const canUsers =
    perms.allowAll ||
    hasAnyPermissionLocal(perms, [Permission.ADMIN_VIEW_USERS, Permission.ADMIN_EDIT_USERS]);

  const canLocations =
    perms.allowAll ||
    hasAnyPermissionLocal(perms, [Permission.ADMIN_VIEW_LOCATIONS, Permission.ADMIN_EDIT_LOCATIONS]);

  const canWorkOrders =
    perms.allowAll ||
    hasAnyPermissionLocal(perms, [
      Permission.ADMIN_VIEW_WORK_ORDERS,
      Permission.ADMIN_EDIT_WORK_ORDERS,
      Permission.ADMIN_DELETE_WORK_ORDERS,
    ]);

  const canTickets =
    perms.allowAll ||
    hasAnyPermissionLocal(perms, [
      Permission.ADMIN_VIEW_MAINTENANCE_TICKETS,
      Permission.ADMIN_EXPORT_MAINTENANCE_TICKETS,
    ]);

  const wrap: CSSProperties = {
    padding: 16,
    maxWidth: 1100,
    margin: "0 auto",
  };

  const grid: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 12,
    marginTop: 12,
  };

  const card: CSSProperties = {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    background: "#fff",
    padding: 14,
  };

  const title: CSSProperties = { fontSize: 18, fontWeight: 800, margin: 0 };
  const desc: CSSProperties = {
    margin: "8px 0 0 0",
    color: "#4b5563",
    fontSize: 13,
    lineHeight: 1.35,
  };

  const linkStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #111827",
    background: "#111827",
    color: "#fff",
    fontSize: 13,
    textDecoration: "none",
    width: "fit-content",
  };

  const mutedLink: CSSProperties = {
    ...linkStyle,
    background: "#fff",
    color: "#111827",
  };

  const email = (session.user as unknown as { email?: string | null } | null)?.email ?? "—";

  return (
    <main style={wrap}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Admin</h1>
      <div style={{ marginTop: 6, color: "#6b7280", fontSize: 13 }}>Signed in: {email}</div>

      <div style={grid}>
        <div style={card}>
          <h2 style={title}>Live Orders Board</h2>
          <p style={desc}>
            Day-to-day operational board with 3 columns (ORDERED / ARRIVED / COMPLETED) and quick actions.
          </p>
          <Link href="/admin/live-orders" style={linkStyle}>
            Open Live Orders →
          </Link>
        </div>

        {canOrders ? (
          <div style={card}>
            <h2 style={title}>Inventory Orders</h2>
            <p style={desc}>
              Order history + receive/process screen. Create orders, track phases, move qty into inventory with guards.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/admin/inventory-orders" style={linkStyle}>
                Open Orders →
              </Link>
              <Link href="/admin/inventory-orders?tab=arrived" style={mutedLink}>
                Arrived / Processing →
              </Link>
            </div>
          </div>
        ) : (
          <div style={card}>
            <h2 style={title}>Inventory Orders</h2>
            <p style={desc}>You don’t have access to view this module.</p>
          </div>
        )}

        {canItems ? (
          <div style={card}>
            <h2 style={title}>Items</h2>
            <p style={desc}>Manage SKUs, costs, suppliers, min qty, and perform import/export.</p>
            <Link href="/admin/items" style={linkStyle}>
              Open Items →
            </Link>
          </div>
        ) : (
          <div style={card}>
            <h2 style={title}>Items</h2>
            <p style={desc}>You don’t have access to view this module.</p>
          </div>
        )}

        {canUsers ? (
          <div style={card}>
            <h2 style={title}>Users</h2>
            <p style={desc}>Create and manage users (admin-only).</p>
            <Link href="/admin/users" style={linkStyle}>
              Open Users →
            </Link>
          </div>
        ) : (
          <div style={card}>
            <h2 style={title}>Users</h2>
            <p style={desc}>You don’t have access to view this module.</p>
          </div>
        )}

        {canLocations ? (
          <div style={card}>
            <h2 style={title}>Locations</h2>
            <p style={desc}>Manage location list used across modules.</p>
            <Link href="/admin/locations" style={linkStyle}>
              Open Locations →
            </Link>
          </div>
        ) : (
          <div style={card}>
            <h2 style={title}>Locations</h2>
            <p style={desc}>You don’t have access to view this module.</p>
          </div>
        )}

        {canWorkOrders ? (
          <div style={card}>
            <h2 style={title}>Work Orders</h2>
            <p style={desc}>Admin view/edit of work orders.</p>
            <Link href="/admin/work-orders" style={linkStyle}>
              Open Work Orders →
            </Link>
          </div>
        ) : (
          <div style={card}>
            <h2 style={title}>Work Orders</h2>
            <p style={desc}>You don’t have access to view this module.</p>
          </div>
        )}

        {canTickets ? (
          <div style={card}>
            <h2 style={title}>Maintenance Tickets</h2>
            <p style={desc}>Admin export + reporting for maintenance tickets.</p>
            <Link href="/admin/maintenance-tickets" style={linkStyle}>
              Open Tickets →
            </Link>
          </div>
        ) : (
          <div style={card}>
            <h2 style={title}>Maintenance Tickets</h2>
            <p style={desc}>You don’t have access to view this module.</p>
          </div>
        )}
      </div>
    </main>
  );
}