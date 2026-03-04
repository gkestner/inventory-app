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

  const shell: CSSProperties = {
    borderBottom: "1px solid rgba(128,128,128,0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
  };

  const inner: CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    maxWidth: 1400,
    margin: "0 auto",
  };

  const left: CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  };

  const brand: CSSProperties = {
    fontWeight: 900,
    letterSpacing: 0.2,
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(128,128,128,0.25)",
    textDecoration: "none",
    color: "var(--foreground)",
  };

  const linkStyle: CSSProperties = {
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(128,128,128,0.18)",
    textDecoration: "none",
    color: "var(--foreground)",
    fontWeight: 800,
    opacity: 0.92,
    whiteSpace: "nowrap",
  };

  const canWorkOrders = hasAnyPermission(perms, [Permission.VIEW_WORK_ORDERS]);
  const canCheckout = hasAnyPermission(perms, [Permission.VIEW_CHECKOUT]);

  // ✅ NEW
  const canLiveOrders = hasAnyPermission(perms, [Permission.VIEW_LIVE_ORDERS]);

  return (
    <div style={shell}>
      <div style={inner}>
        <div style={left}>
          <Link href="/" style={brand}>
            Inventory
          </Link>

          {canWorkOrders ? (
            <Link href="/maintenance/work-orders" style={linkStyle}>
              Work Orders
            </Link>
          ) : null}

          {canCheckout ? (
            <Link href="/maintenance/checkout" style={linkStyle}>
              Checkout
            </Link>
          ) : null}

          {/* ✅ NEW: Live Orders board (general users, permission-based) */}
          {canLiveOrders ? (
            <Link href="/employee/live-orders" style={linkStyle}>
              Live Orders
            </Link>
          ) : null}

          {isAdmin ? (
            <Link href="/admin" style={linkStyle}>
              Admin
            </Link>
          ) : null}
        </div>

        <LogoutSlot
          style={{
            padding: "6px 12px",
            borderRadius: 10,
            border: "1px solid rgba(128,128,128,0.25)",
            background: "var(--background)",
            color: "var(--foreground)",
            fontWeight: 800,
            cursor: "pointer",
          }}
        />
      </div>
    </div>
  );
}