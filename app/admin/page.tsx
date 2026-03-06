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
  if (role === Role.ADMIN) return session;

  const perms = await loadUserPermissions(session as unknown as Parameters<typeof loadUserPermissions>[0]);
  const hasAdminAccess =
    perms.allowAll ||
    hasAnyPermissionLocal(perms as unknown as PermissionsResult, [
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_VIEW_USERS,
      Permission.ADMIN_VIEW_LOCATIONS,
      Permission.ADMIN_VIEW_WORK_ORDERS,
      Permission.ADMIN_VIEW_MAINTENANCE_TICKETS,
    ]);

  if (!hasAdminAccess) redirect("/");

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
    hasAnyPermissionLocal(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS, Permission.ADMIN_IMPORT_EXPORT_ITEMS]);

  const canOrders =
    perms.allowAll ||
    hasAnyPermissionLocal(perms, [Permission.ADMIN_VIEW_WORK_ORDERS, Permission.ADMIN_EDIT_WORK_ORDERS, Permission.ADMIN_DELETE_WORK_ORDERS]) ||
    // inventory orders often align with items permissions
    hasAnyPermissionLocal(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);

  const canUsers = perms.allowAll || hasAnyPermissionLocal(perms, [Permission.ADMIN_VIEW_USERS, Permission.ADMIN_EDIT_USERS]);

  const canLocations = perms.allowAll || hasAnyPermissionLocal(perms, [Permission.ADMIN_VIEW_LOCATIONS, Permission.ADMIN_EDIT_LOCATIONS]);

  const canWorkOrders =
    perms.allowAll ||
    hasAnyPermissionLocal(perms, [Permission.ADMIN_VIEW_WORK_ORDERS, Permission.ADMIN_EDIT_WORK_ORDERS, Permission.ADMIN_DELETE_WORK_ORDERS]);

  const canTickets =
    perms.allowAll ||
    hasAnyPermissionLocal(perms, [Permission.ADMIN_VIEW_MAINTENANCE_TICKETS, Permission.ADMIN_EXPORT_MAINTENANCE_TICKETS]);

  const canPreventativeMaintenance = canWorkOrders || canLocations || canTickets;

  const grid: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 12,
    marginTop: 14,
  };

  const border = "1px solid var(--border)";
  const surface = "var(--surface)";
  const fg = "var(--foreground)";
  const soft = "var(--surface-2)";

  const card: CSSProperties = {
    border,
    borderRadius: 14,
    background: surface,
    padding: 14,
    boxShadow: "var(--shadow)",
    display: "grid",
    gap: 6,
  };

  const title: CSSProperties = { fontSize: 16, fontWeight: 900, margin: 0, color: fg };
  const desc: CSSProperties = {
    margin: "8px 0 0 0",
    opacity: 0.82,
    fontSize: 13,
    lineHeight: 1.35,
    color: fg,
  };

  const linkStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    padding: "10px 12px",
    borderRadius: 12,
    border,
    background: "linear-gradient(160deg, var(--brand-2) 0%, var(--brand) 100%)",
    color: "var(--brand-contrast)",
    fontSize: 13,
    textDecoration: "none",
    width: "fit-content",
    fontWeight: 900,
  };

  const mutedLink: CSSProperties = {
    ...linkStyle,
    background: soft,
    color: fg,
    opacity: 0.92,
  };

  const email = (session.user as unknown as { email?: string | null } | null)?.email ?? "—";

  return (
    <main>
      <div>
        <section
          style={{
            border,
            borderRadius: 16,
            background: "linear-gradient(155deg, color-mix(in srgb, var(--brand) 16%, var(--surface)) 0%, var(--surface) 68%)",
            boxShadow: "var(--shadow)",
            padding: 18,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 950, lineHeight: 1.05 }}>Admin Operations Center</h1>
          <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 14 }}>Signed in: {email}</div>
          <p style={{ margin: "10px 0 0", maxWidth: 900, lineHeight: 1.55, color: "var(--muted)" }}>
            Manage inventory, users, reporting, locations, and maintenance workflows from a unified command surface.
          </p>
        </section>

        <div style={grid}>
        <div style={card}>
          <h2 style={title}>Live Orders Board</h2>
          <p style={desc}>Day-to-day operational board with 3 columns (ORDERED / ARRIVED / COMPLETED) and quick actions.</p>
          <Link href="/admin/live-orders" style={linkStyle}>
            Open Live Orders →
          </Link>
        </div>

        {canOrders ? (
          <div style={card}>
            <h2 style={title}>Inventory Orders</h2>
            <p style={desc}>Order history + receive/process screen. Create orders, track phases, move qty into inventory with guards.</p>
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

        {canPreventativeMaintenance ? (
          <div style={card}>
            <h2 style={title}>Preventative Maintenance</h2>
            <p style={desc}>Annual PM matrix by location with technician grouping based on primary Maintenance assignments.</p>
            <Link href="/admin/preventative-maintenance" style={linkStyle}>
              Open PM List →
            </Link>
          </div>
        ) : (
          <div style={card}>
            <h2 style={title}>Preventative Maintenance</h2>
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
      </div>
    </main>
  );
}