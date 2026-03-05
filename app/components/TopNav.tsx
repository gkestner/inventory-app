// app/components/TopNav.tsx
import Link from "next/link";
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { Permission } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import LogoutSlot from "@/app/components/LogoutSlot";

export const dynamic = "force-dynamic";

export default async function TopNav() {
  const session = await getServerSession(authOptions);
  const perms = await loadUserPermissions(session);

  const shell: CSSProperties = { color: "var(--foreground)" };

  const inner: CSSProperties = {};

  const left: CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  };

  const brand: CSSProperties = {};

  const linkStyle: CSSProperties = { whiteSpace: "nowrap" };

  const canWorkOrders = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_WORK_ORDERS]);
  const canCheckout = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_CHECKOUT, Permission.CREATE_CHECKOUT]);

  // ✅ NEW: Live Orders board (general users)
  const canLiveOrders = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_LIVE_ORDERS]);

  const canAdmin =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_VIEW_USERS,
      Permission.ADMIN_VIEW_LOCATIONS,
      Permission.ADMIN_VIEW_WORK_ORDERS,
      Permission.ADMIN_VIEW_MAINTENANCE_TICKETS,
    ]);

  return (
    <div className="site-nav-shell" style={shell}>
      <div className="site-nav-inner" style={inner}>
        <div style={left}>
          <Link href="/" className="site-brand" style={brand}>
            Inventory
          </Link>

          {canWorkOrders ? (
            <Link href="/maintenance/work-orders" className="site-link" style={linkStyle}>
              Work Orders
            </Link>
          ) : null}

          {canCheckout ? (
            <Link href="/maintenance/checkout" className="site-link" style={linkStyle}>
              Checkout
            </Link>
          ) : null}

          {canLiveOrders ? (
            <Link href="/employee/live-orders" className="site-link" style={linkStyle}>
              Live Orders
            </Link>
          ) : null}

          {canAdmin ? (
            <Link href="/admin" className="site-link" style={linkStyle}>
              Admin
            </Link>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link
            href="/settings"
            className="site-link"
            style={{
              padding: "6px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            Settings
          </Link>

          <LogoutSlot
            style={{
              padding: "6px 12px",
              borderRadius: 10,
              border: "1px solid color-mix(in srgb, var(--brand) 55%, var(--border))",
              background: "linear-gradient(160deg, var(--brand-2) 0%, var(--brand) 100%)",
              color: "var(--brand-contrast)",
              fontWeight: 800,
              cursor: "pointer",
            }}
          />
        </div>
      </div>
    </div>
  );
}