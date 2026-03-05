// app/maintenance/layout.tsx
import type { ReactNode, CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission, Role } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SessionUser = {
  email?: string | null;
  role?: Role | null;
  name?: string | null;
};

function isAllowed(role: Role | null | undefined) {
  // ✅ MAINTENANCE is allowed into /maintenance
  return role === Role.EMPLOYEE || role === Role.MAINTENANCE || role === Role.MANAGER || role === Role.ADMIN;
}

export default async function MaintenanceLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const user = session.user as SessionUser;

  const email = (user.email ?? "").trim().toLowerCase();
  if (!email) redirect("/login");

  if (!isAllowed(user.role)) redirect("/login");

  const perms = await loadUserPermissions(session);

  // ✅ Checkout is permission-based ONLY (no role special-casing)
  const canCheckout = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_CHECKOUT, Permission.CREATE_CHECKOUT]);

  // ✅ Work Orders are permission-based ONLY
  const canWorkOrders =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_WORK_ORDERS,
      Permission.CREATE_WORK_ORDERS,
      Permission.UPDATE_OWN_WORK_ORDERS,
      Permission.SUBMIT_OWN_WORK_ORDERS,
    ]);

  // ✅ Travel Log is treated as part of Work Orders permissions (no VIEW_TRAVEL_LOG exists)
  const canTravelLog = canWorkOrders;

  // ✅ NEW: Live Orders board
  const canLiveOrders = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_LIVE_ORDERS]);

  const shell: CSSProperties = {
    color: "var(--foreground)",
  };

  const inner: CSSProperties = {
    maxWidth: 1100,
  };

  const left: CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  };

  const pill = (): CSSProperties => ({
    whiteSpace: "nowrap",
  });

  return (
    <div>
      <nav className="site-nav-shell" style={shell}>
        <div className="site-nav-inner" style={inner}>
          <div style={left}>
            <Link href="/maintenance" className="site-brand" style={pill()}>
              Maintenance
            </Link>

            {/* ✅ Only show Work Orders + Travel Log if permitted */}
            {canWorkOrders ? (
              <>
                <Link href="/maintenance/work-orders" className="site-link" style={pill()}>
                  Work Orders
                </Link>

                {canTravelLog ? (
                  <Link href="/maintenance/travel-log" className="site-link" style={pill()}>
                    Travel Log
                  </Link>
                ) : null}
              </>
            ) : null}

            {/* ✅ Only show Checkout if permitted */}
            {canCheckout ? (
              <Link href="/maintenance/checkout" className="site-link" style={pill()}>
                Checkout
              </Link>
            ) : null}

            {/* ✅ NEW: Live Orders board (permission-based) */}
            {canLiveOrders ? (
              <Link href="/employee/live-orders" className="site-link" style={pill()}>
                Live Orders
              </Link>
            ) : null}
          </div>

          {/* right-side items (logout button etc.) can stay where you already render them elsewhere */}
        </div>
      </nav>

      {children}
    </div>
  );
}