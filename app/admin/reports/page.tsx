// app/admin/reports/page.tsx
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

async function requireReportsView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  // Keep consistent with Orders module (reuses Items Admin perms)
  const ok = hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) redirect("/");
}

export default async function AdminReportsIndexPage() {
  await requireReportsView();

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";

  const cardStyle: React.CSSProperties = {
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

  const titleStyle: React.CSSProperties = { fontWeight: 900, fontSize: 16, margin: 0 };
  const descStyle: React.CSSProperties = { opacity: 0.85, lineHeight: 1.45, margin: 0, fontSize: 13 };

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto", color: fg }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Admin: Reports</h1>

          <Link
            href="/admin/items"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border,
              background: surface,
              color: fg,
              textDecoration: "none",
              fontWeight: 900,
            }}
          >
            ← Items
          </Link>

          <Link
            href="/admin/inventory-orders"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border,
              background: surface,
              color: fg,
              textDecoration: "none",
              fontWeight: 900,
              opacity: 0.92,
            }}
          >
            Order History →
          </Link>
        </div>

        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
          <Link href="/admin/reports/needs-ordering" style={cardStyle}>
            <h2 style={titleStyle}>Items Needing Order</h2>
            <p style={descStyle}>
              Live reorder queue for active items where available qty is below minimum. Includes optional Ignore/Unignore
              controls for non-actionable rows.
            </p>
            <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
          </Link>

          <Link href="/admin/reports/item-cost-history" style={cardStyle}>
            <h2 style={titleStyle}>Item Cost History</h2>
            <p style={descStyle}>
              Compare current item cost vs a prior point in time (last order before date) or average cost over a window
              (6/12/24+ months).
            </p>
            <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
          </Link>

          <Link href="/admin/inventory-orders" style={cardStyle}>
            <h2 style={titleStyle}>Order History</h2>
            <p style={descStyle}>
              Chronological order sheet with phase colors (Ordered / Arrived / Added to Inventory), supplier, totals, and
              who/where it’s for.
            </p>
            <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
          </Link>

          <Link href="/admin/inventory-receiving" style={cardStyle}>
            <h2 style={titleStyle}>Orders Received / Processing</h2>
            <p style={descStyle}>
              Receiving-focused view (pre-filtered to ARRIVED). Mark items as added to inventory to update on-hand.
            </p>
            <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
          </Link>
        </div>

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
          Tip: bookmark <code>/admin/reports</code> as your reporting hub.
        </div>
      </div>
    </main>
  );
}