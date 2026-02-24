// app/admin/page.tsx
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { Permission, Role } from "@prisma/client";

export const dynamic = "force-dynamic";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

export default async function AdminHomePage() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);

  const canItemsView = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  const canItemsEdit = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
  const canItemsImportExport =
    perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_IMPORT_EXPORT_ITEMS, Permission.ADMIN_EDIT_ITEMS]);

  const canUsersView = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_USERS, Permission.ADMIN_EDIT_USERS]);
  const canUsersEdit = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_USERS]);

  const canLocationsView =
    perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_LOCATIONS, Permission.ADMIN_EDIT_LOCATIONS]);
  const canLocationsEdit = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_LOCATIONS]);

  // Orders / reports reuse Items permissions per the pages we added
  const canOrders = canItemsView;
  const canReports = canItemsView;

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";

  const card: React.CSSProperties = {
    border,
    borderRadius: 16,
    padding: 14,
    background: surface,
    color: fg,
    textDecoration: "none",
    display: "grid",
    gap: 8,
    minHeight: 110,
  };

  const title: React.CSSProperties = { fontWeight: 900, fontSize: 16, margin: 0 };
  const desc: React.CSSProperties = { opacity: 0.85, lineHeight: 1.45, margin: 0, fontSize: 13 };

  const cards: Array<{ href: string; title: string; desc: string; show: boolean }> = [
    {
      href: "/admin/items",
      title: "Items",
      desc: canItemsImportExport
        ? "Manage inventory items, inline edits, import/export, and view quantities."
        : canItemsEdit
          ? "Manage inventory items and quantities."
          : "View inventory items and quantities.",
      show: canItemsView,
    },
    {
      href: "/admin/inventory-orders",
      title: "Order History",
      desc: "Create orders tied to items, phase tracking (Ordered/Arrived/Added), and quantity updates.",
      show: canOrders,
    },
    {
      href: "/admin/inventory-receiving",
      title: "Orders Received / Processing",
      desc: "Receiving-focused view (pre-filtered to Arrived). Add to inventory to update on-hand.",
      show: canOrders,
    },
    {
      href: "/admin/reports",
      title: "Reports",
      desc: "Cost comparison and order-based reporting (now vs 6 months/years prior).",
      show: canReports,
    },
    {
      href: "/admin/locations",
      title: "Locations",
      desc: canLocationsEdit ? "Create/edit store locations." : "View store locations.",
      show: canLocationsView,
    },
    {
      href: "/admin/users",
      title: "Users",
      desc: canUsersEdit ? "Create/edit users and reset passwords." : "View users.",
      show: canUsersView,
    },
  ];

  const visible = cards.filter((c) => c.show);

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto", color: fg }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0 }}>Admin</h1>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
          Signed in as{" "}
          <b>
            {typeof (session?.user as any)?.email === "string" ? (session?.user as any).email : "—"}
          </b>
        </div>

        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
          {visible.map((c) => (
            <Link key={c.href} href={c.href} style={card}>
              <h2 style={title}>{c.title}</h2>
              <p style={desc}>{c.desc}</p>
              <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
            </Link>
          ))}

          {visible.length === 0 ? (
            <div style={{ ...card, textDecoration: "none" }}>
              <h2 style={title}>No admin modules available</h2>
              <p style={desc}>Your account doesn’t have permissions for any admin pages.</p>
            </div>
          ) : null}
        </div>

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
          Tip: the new workflow is <b>Order History</b> → <b>Orders Received</b> → <b>Reports</b>.
        </div>
      </div>
    </main>
  );
}