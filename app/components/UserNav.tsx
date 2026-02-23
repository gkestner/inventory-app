// app/components/UserNav.tsx
import Link from "next/link";
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { Permission, Role } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * UserNav
 * - ADMIN role => allow-all (via loadUserPermissions) though typically swapped in via preview mode
 * - Non-admin => permission-gated
 */
export default async function UserNav() {
  const session = await getServerSession(authOptions);
  const perms = await loadUserPermissions(session);

  const role = (session?.user as { role?: Role | null } | undefined)?.role ?? null;
  const isEmployee = role === Role.EMPLOYEE;

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

  const groupLabel: CSSProperties = {
    fontSize: 12,
    opacity: 0.7,
    fontWeight: 900,
    marginLeft: 6,
    marginRight: -2,
    whiteSpace: "nowrap",
  };

  const canWorkOrders = hasAnyPermission(perms, [
    Permission.VIEW_WORK_ORDERS,
    Permission.CREATE_WORK_ORDERS,
    Permission.UPDATE_OWN_WORK_ORDERS,
    Permission.SUBMIT_OWN_WORK_ORDERS,
  ]);

  // Travel Log is derived from Work Orders, so gate it the same way (view permission is sufficient).
  const canTravelLog = hasAnyPermission(perms, [Permission.VIEW_WORK_ORDERS]);

  // Employees should not see Parts Checkout in nav.
  const canCheckout =
    !isEmployee && hasAnyPermission(perms, [Permission.VIEW_CHECKOUT, Permission.CREATE_CHECKOUT]);

  const homeHref = isEmployee ? "/employee" : "/maintenance";

  return (
    <div style={shell}>
      <div style={inner}>
        <div style={left}>
          <Link href={homeHref} style={brand}>
            Maintenance
          </Link>

          <span style={groupLabel}>Work</span>

          {canWorkOrders ? (
            <Link href="/maintenance/work-orders" style={linkStyle}>
              Work Orders
            </Link>
          ) : null}

          {canTravelLog ? (
            <Link href="/maintenance/travel-log" style={linkStyle}>
              Travel Log
            </Link>
          ) : null}

          {canCheckout ? (
            <Link href="/maintenance/checkout" style={linkStyle}>
              Checkout
            </Link>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {/* intentionally minimal; add more links as permission map expands */}
        </div>
      </div>
    </div>
  );
}
