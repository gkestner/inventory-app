// app/components/TopNav.tsx
import Link from "next/link";
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { Permission, Role } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import LogoutSlot from "@/app/components/LogoutSlot";

export const dynamic = "force-dynamic";

export default async function TopNav() {
  const session = await getServerSession(authOptions);
  const perms = await loadUserPermissions(session);

  const role = (session?.user as { role?: Role | null } | undefined)?.role ?? null;
  const isAdmin = role === Role.ADMIN;

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

  const canWorkOrders = hasAnyPermission(perms, [Permission.VIEW_WORK_ORDERS]);
  const canCheckout = hasAnyPermission(perms, [Permission.VIEW_CHECKOUT]);

  // ✅ NEW: Live Orders board (general users)
  const canLiveOrders = hasAnyPermission(perms, [Permission.VIEW_LIVE_ORDERS]);

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

          {isAdmin ? (
            <Link href="/admin" className="site-link" style={linkStyle}>
              Admin
            </Link>
          ) : null}
        </div>

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
  );
}