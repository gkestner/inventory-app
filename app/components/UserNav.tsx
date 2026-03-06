// app/components/UserNav.tsx
import Link from "next/link";
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { Permission } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { CREATE_WORK_ORDERS_FOR_OTHERS } from "@/app/lib/permission-constants";
import SignOutButton from "@/app/components/SignOutButton";

export const dynamic = "force-dynamic";

/**
 * UserNav
 * - ADMIN role => allow-all
 * - Non-admin => permission-gated
 */
export default async function UserNav() {
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

  const linkStyle: CSSProperties = {
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

  const canWorkOrders =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_WORK_ORDERS,
      Permission.CREATE_WORK_ORDERS,
      CREATE_WORK_ORDERS_FOR_OTHERS,
      Permission.UPDATE_OWN_WORK_ORDERS,
      Permission.SUBMIT_OWN_WORK_ORDERS,
    ]);

  const canOfficeEntry = perms.allowAll || hasAnyPermission(perms, [CREATE_WORK_ORDERS_FOR_OTHERS]);

  const canTravelLog = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_WORK_ORDERS]);

  const canCheckout = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_CHECKOUT, Permission.CREATE_CHECKOUT]);

  const homeHref = canWorkOrders || canOfficeEntry || canCheckout ? "/maintenance" : "/";

  return (
    <div className="site-nav-shell" style={shell}>
      <div className="site-nav-inner" style={inner}>
        <div style={left}>
          <Link href={homeHref} className="site-brand" style={brand}>
            Maintenance
          </Link>

          <span style={groupLabel}>Work</span>

          {canWorkOrders && (
            <Link href="/maintenance/work-orders" className="site-link" style={linkStyle}>
              Work Orders
            </Link>
          )}

          {canOfficeEntry && (
            <Link href="/maintenance/work-orders/office-entry" className="site-link" style={linkStyle}>
              Office Entry
            </Link>
          )}

          {canTravelLog && (
            <Link href="/maintenance/travel-log" className="site-link" style={linkStyle}>
              Travel Log
            </Link>
          )}

          {canCheckout && (
            <Link href="/maintenance/checkout" className="site-link" style={linkStyle}>
              Checkout
            </Link>
          )}
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

          <SignOutButton
            label="Logout"
            callbackUrl="/login"
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