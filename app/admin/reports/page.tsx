// app/admin/reports/page.tsx
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { Permission, Role } from "@prisma/client";
import {
  ADMIN_VIEW_COMPANY_VEHICLES,
  ADMIN_VIEW_MAINTENANCE_REQUESTS,
  ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
  ADMIN_VIEW_TEMPERATURE_DASHBOARD,
} from "@/app/lib/permission-constants";

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
  if (perms.allowAll) return perms;

  // Keep consistent with Orders module (reuses Items Admin perms)
  const ok = hasAnyPermission(perms, [
    Permission.ADMIN_VIEW_ITEMS,
    Permission.ADMIN_EDIT_ITEMS,
    ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
    ADMIN_VIEW_MAINTENANCE_REQUESTS,
  ]);
  if (!ok) redirect("/");

  return perms;
}

export default async function AdminReportsIndexPage() {
  const perms = await requireReportsView();

  const canPmReports = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_PREVENTATIVE_MAINTENANCE]);
  const canRequestReports = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_MAINTENANCE_REQUESTS]);
  const canTemperatureReports = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_TEMPERATURE_DASHBOARD]);
  const canFleetReports = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_COMPANY_VEHICLES]);
  const canWorkOrderReports =
    perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_WORK_ORDERS, Permission.ADMIN_EDIT_WORK_ORDERS]);
  const canItemsReports = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  const canSecurityReports = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_USERS, Permission.ADMIN_EDIT_USERS]);

  const border = "1px solid var(--border)";
  const surface = "var(--surface)";
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
    boxShadow: "var(--shadow)",
  };

  const titleStyle: React.CSSProperties = { fontWeight: 900, fontSize: 16, margin: 0 };
  const descStyle: React.CSSProperties = { opacity: 0.85, lineHeight: 1.45, margin: 0, fontSize: 13 };

  return (
    <main>
      <div style={{ maxWidth: 1260, margin: "0 auto", color: fg }}>
        <section
          style={{
            border,
            borderRadius: 16,
            background: "linear-gradient(150deg, color-mix(in srgb, var(--brand) 15%, var(--surface)) 0%, var(--surface) 70%)",
            boxShadow: "var(--shadow)",
            padding: 18,
          }}
        >
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 30, fontWeight: 900, margin: 0 }}>Reports Hub</h1>

          <Link
            href="/admin/items"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border,
              background: "var(--surface-2)",
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
              background: "var(--surface-2)",
              color: fg,
              textDecoration: "none",
              fontWeight: 900,
              opacity: 0.92,
            }}
          >
            Order History →
          </Link>
        </div>
        <p style={{ margin: "10px 0 0", color: "var(--muted)", maxWidth: 900, lineHeight: 1.5 }}>
          Centralized analytics and operational reporting for checkout history, reorder pressure, and cost movement.
        </p>
        </section>

        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
          <Link href="/admin/reports/checkout-orders" style={cardStyle}>
            <h2 style={titleStyle}>Checkout Orders</h2>
            <p style={descStyle}>
              Full searchable report of maintenance checkout tickets with all checkout fields, detailed drilldown, and
              independent of invoice generation state.
            </p>
            <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
          </Link>

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

          <Link href="/admin/reports/work-order-costs" style={cardStyle}>
            <h2 style={titleStyle}>Work Order Cost Rollup</h2>
            <p style={descStyle}>
              Summarized labor and mileage cost by work order to support budgeting and accounting reconciliation.
            </p>
            <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
          </Link>

          {canPmReports ? (
            <Link href="/admin/reports/preventative-maintenance" style={cardStyle}>
              <h2 style={titleStyle}>PM Audit & Activity</h2>
              <p style={descStyle}>
                View preventative maintenance history with who updated each PM row, when they did it, and which columns changed.
              </p>
              <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
            </Link>
          ) : null}

          {canRequestReports ? (
            <Link href="/admin/reports/maintenance-requests" style={cardStyle}>
              <h2 style={titleStyle}>Maintenance Request Reports</h2>
              <p style={descStyle}>
                Analyze maintenance issue request volume, assignment load by technician, closeout pace, and request audit events. Separate from parts checkout ticket reports.
              </p>
              <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
            </Link>
          ) : null}

          {canRequestReports ? (
            <Link href="/admin/reports/sla-breaches" style={cardStyle}>
              <h2 style={titleStyle}>SLA Breach Monitor</h2>
              <p style={descStyle}>
                Overdue and slow-close maintenance requests against response and close-hour targets.
              </p>
              <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
            </Link>
          ) : null}

          {canRequestReports || canWorkOrderReports ? (
            <Link href="/admin/reports/technician-workload" style={cardStyle}>
              <h2 style={titleStyle}>Technician Workload</h2>
              <p style={descStyle}>
                Open load and close-throughput by technician across maintenance requests and work orders.
              </p>
              <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
            </Link>
          ) : null}

          {canTemperatureReports ? (
            <Link href="/admin/reports/temperature-incidents" style={cardStyle}>
              <h2 style={titleStyle}>Temperature Incident Timeline</h2>
              <p style={descStyle}>
                Hub/device alert timeline with high/low incident counts and recent abnormal readings.
              </p>
              <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
            </Link>
          ) : null}

          {canPmReports ? (
            <Link href="/admin/reports/pm-compliance" style={cardStyle}>
              <h2 style={titleStyle}>PM Compliance Scorecard</h2>
              <p style={descStyle}>
                Completion coverage by location and year using PM field fill-rate and update activity.
              </p>
              <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
            </Link>
          ) : null}

          {canItemsReports ? (
            <Link href="/admin/reports/parts-consumption-costs" style={cardStyle}>
              <h2 style={titleStyle}>Parts Consumption + Cost</h2>
              <p style={descStyle}>
                Parts checkout quantity and estimated spend by store and item over a selected date range.
              </p>
              <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
            </Link>
          ) : null}

          {canFleetReports ? (
            <Link href="/admin/reports/fleet-tco" style={cardStyle}>
              <h2 style={titleStyle}>Fleet TCO</h2>
              <p style={descStyle}>
                Vehicle service spend, mileage deltas, and cost-per-mile trends by unit.
              </p>
              <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
            </Link>
          ) : null}

          {canSecurityReports ? (
            <Link href="/admin/reports/permission-coverage" style={cardStyle}>
              <h2 style={titleStyle}>Permission Coverage</h2>
              <p style={descStyle}>
                User access matrix showing direct grants and role/title-based permission coverage.
              </p>
              <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
            </Link>
          ) : null}

          {canSecurityReports ? (
            <Link href="/admin/reports/notification-effectiveness" style={cardStyle}>
              <h2 style={titleStyle}>Notification Effectiveness</h2>
              <p style={descStyle}>
                Delivery and read-time trends by notification type to tune alert routing behavior.
              </p>
              <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
            </Link>
          ) : null}

          <Link href="/admin/audit" style={cardStyle}>
            <h2 style={titleStyle}>Audit Trail</h2>
            <p style={descStyle}>
              Searchable activity stream of administrative and workflow events for traceability and diagnostics.
            </p>
            <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
          </Link>

          <Link href="/admin/permission-diagnostics" style={cardStyle}>
            <h2 style={titleStyle}>Permission Diagnostics</h2>
            <p style={descStyle}>
              Validate effective permission coverage by user and quickly identify missing access grants.
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