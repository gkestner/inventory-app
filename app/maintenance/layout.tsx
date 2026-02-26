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
  role?: Role;
  name?: string | null;
};

function isAllowed(role: Role | undefined) {
  return role === Role.EMPLOYEE || role === Role.MANAGER || role === Role.ADMIN;
}

export default async function MaintenanceLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const user = session.user as SessionUser;

  const email = (user.email ?? "").trim().toLowerCase();
  if (!email) redirect("/");

  if (!isAllowed(user.role)) redirect("/");

  const perms = await loadUserPermissions(session);

  // Match your existing rules from app/maintenance/page.tsx
  const canCheckout =
    user.role !== Role.EMPLOYEE && hasAnyPermission(perms, [Permission.VIEW_CHECKOUT, Permission.CREATE_CHECKOUT]);

  const canWorkOrders =
    user.role === Role.EMPLOYEE ||
    hasAnyPermission(perms, [
      Permission.VIEW_WORK_ORDERS,
      Permission.CREATE_WORK_ORDERS,
      Permission.UPDATE_OWN_WORK_ORDERS,
      Permission.SUBMIT_OWN_WORK_ORDERS,
    ]);

  // Travel Log is currently treated as part of the "work" area.
  // If you later add a dedicated permission for Travel Log, swap this condition accordingly.
  const canTravelLog = canWorkOrders;

  const shell: CSSProperties = {
    borderBottom: "1px solid rgba(128,128,128,0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
  };

  const inner: CSSProperties = {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "10px 16px",
    display: "flex",
    gap: 10,
    alignItems: "center",
    justifyContent: "space-between",
  };

  const left: CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  };

  const pill = (active?: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 12px",
    borderRadius: 10,
    border: "1px solid rgba(128,128,128,0.25)",
    textDecoration: "none",
    color: "var(--foreground)",
    fontWeight: 800,
    opacity: active ? 1 : 0.9,
  });

  return (
    <div>
      <nav style={shell}>
        <div style={inner}>
          <div style={left}>
            <Link href="/maintenance" style={pill()}>
              Maintenance
            </Link>

            {/* Only show "Work" area tabs if permitted */}
            {canWorkOrders ? (
              <>
                <Link href="/maintenance/work-orders" style={pill()}>
                  Work Orders
                </Link>

                {canTravelLog ? (
                  <Link href="/maintenance/travel-log" style={pill()}>
                    Travel Log
                  </Link>
                ) : null}
              </>
            ) : null}

            {/* Only show Checkout if permitted */}
            {canCheckout ? (
              <Link href="/maintenance/checkout" style={pill()}>
                Checkout
              </Link>
            ) : null}
          </div>

          {/* Keep whatever else you might already render on the right (logout button usually lives elsewhere)
              If your logout button is part of another layout, this won't interfere. */}
        </div>
      </nav>

      {children}
    </div>
  );
}