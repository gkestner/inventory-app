// app/admin/reports/page.tsx
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { Permission, Role } from "@prisma/client";
import {
  ADMIN_VIEW_REPORT_FLEET_TCO,
  ADMIN_VIEW_REPORT_NOTIFICATION_EFFECTIVENESS,
  ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS,
  ADMIN_VIEW_REPORT_PERMISSION_COVERAGE,
  ADMIN_VIEW_REPORT_PM_COMPLIANCE,
  ADMIN_VIEW_REPORT_SLA_BREACHES,
  ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD,
  ADMIN_VIEW_REPORT_TEMPERATURE_INCIDENTS,
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

type ReportsSearchParams = {
  q?: string;
};

function matchesQuery(query: string, ...parts: string[]) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = parts.join(" ").toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every((t) => haystack.includes(t));
}

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
    ADMIN_VIEW_REPORT_SLA_BREACHES,
    ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD,
    ADMIN_VIEW_REPORT_TEMPERATURE_INCIDENTS,
    ADMIN_VIEW_REPORT_PM_COMPLIANCE,
    ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS,
    ADMIN_VIEW_REPORT_FLEET_TCO,
    ADMIN_VIEW_REPORT_PERMISSION_COVERAGE,
    ADMIN_VIEW_REPORT_NOTIFICATION_EFFECTIVENESS,
  ]);
  if (!ok) redirect("/");

  return perms;
}

export default async function AdminReportsIndexPage({
  searchParams,
}: {
  searchParams?: Promise<ReportsSearchParams>;
}) {
  const perms = await requireReportsView();
  const sp = (await searchParams) ?? {};
  const query = String(sp.q ?? "").trim();

  const canPmReports = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_PREVENTATIVE_MAINTENANCE]);
  const canRequestReports = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_MAINTENANCE_REQUESTS]);
  const canTemperatureReports = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_TEMPERATURE_DASHBOARD]);
  const canFleetReports = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_COMPANY_VEHICLES]);
  const canWorkOrderReports =
    perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_WORK_ORDERS, Permission.ADMIN_EDIT_WORK_ORDERS]);
  const canItemsReports = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  const canSecurityReports = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_USERS, Permission.ADMIN_EDIT_USERS]);
  const canSlaBreachReport = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_REPORT_SLA_BREACHES]);
  const canTechnicianWorkloadReport =
    perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD]);
  const canTemperatureIncidentsReport =
    perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_REPORT_TEMPERATURE_INCIDENTS]);
  const canPmComplianceReport = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_REPORT_PM_COMPLIANCE]);
  const canPartsConsumptionReport =
    perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS]);
  const canFleetTcoReport = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_REPORT_FLEET_TCO]);
  const canPermissionCoverageReport =
    perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_REPORT_PERMISSION_COVERAGE]);
  const canNotificationEffectivenessReport =
    perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_REPORT_NOTIFICATION_EFFECTIVENESS]);

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

          {canItemsReports ? (
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
          ) : null}

          {canItemsReports ? (
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
          ) : null}
        </div>
        <p style={{ margin: "10px 0 0", color: "var(--muted)", maxWidth: 900, lineHeight: 1.5 }}>
          Centralized analytics and operational reporting for checkout history, reorder pressure, and cost movement.
        </p>

        <form method="get" style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search reports by name or keyword"
            aria-label="Search reports"
            style={{
              minWidth: 260,
              flex: "1 1 320px",
              padding: "10px 12px",
              borderRadius: 12,
              border,
              background: "var(--surface-2)",
              color: fg,
            }}
          />
          <button
            type="submit"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border,
              background: "var(--surface-2)",
              color: fg,
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Search
          </button>
          {query ? (
            <Link
              href="/admin/reports"
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
              Clear
            </Link>
          ) : null}
        </form>
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, margin: "0 0 8px" }}>Inventory & Ordering</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {canItemsReports && matchesQuery(query, "checkout orders tickets") ? (
              <Link href="/admin/reports/checkout-orders" style={cardStyle}>
                <h2 style={titleStyle}>Checkout Orders</h2>
                <p style={descStyle}>Full searchable report of maintenance checkout tickets with all checkout fields and detailed drilldown.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}

            {canItemsReports && matchesQuery(query, "items needing order reorder queue") ? (
              <Link href="/admin/reports/needs-ordering" style={cardStyle}>
                <h2 style={titleStyle}>Items Needing Order</h2>
                <p style={descStyle}>Live reorder queue for active items below minimum with Ignore/Unignore controls.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}

            {canItemsReports && matchesQuery(query, "min qty suggested minimum differences mismatch") ? (
              <Link href="/admin/reports/min-qty-differences" style={cardStyle}>
                <h2 style={titleStyle}>Min Qty Differences</h2>
                <p style={descStyle}>Review items where current min qty differs from the suggested 30-day minimum and copy the suggestion row by row.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}

            {canItemsReports && matchesQuery(query, "item cost history pricing") ? (
              <Link href="/admin/reports/item-cost-history" style={cardStyle}>
                <h2 style={titleStyle}>Item Cost History</h2>
                <p style={descStyle}>Compare current item cost against prior points in time or selected averaging windows.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}

            {canItemsReports && matchesQuery(query, "scanner count untouched unscanned looked up not scanned") ? (
              <Link href="/admin/reports/scanner-count-untouched" style={cardStyle}>
                <h2 style={titleStyle}>Scanner Count Untouched Parts</h2>
                <p style={descStyle}>Parts you have not looked up or updated from scanner count since the last reset, with reset control for the next pass.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}

            {canItemsReports && matchesQuery(query, "order history inventory orders") ? (
              <Link href="/admin/inventory-orders" style={cardStyle}>
                <h2 style={titleStyle}>Order History</h2>
                <p style={descStyle}>Chronological order sheet with phase states, supplier totals, and destination context.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}

            {canItemsReports && matchesQuery(query, "orders received processing inventory receiving") ? (
              <Link href="/admin/inventory-receiving" style={cardStyle}>
                <h2 style={titleStyle}>Orders Received / Processing</h2>
                <p style={descStyle}>Receiving-focused view for ARRIVED orders with add-to-inventory workflow.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}

            {(canPartsConsumptionReport || canItemsReports) && matchesQuery(query, "parts consumption cost checkout spend") ? (
              <Link href="/admin/reports/parts-consumption-costs" style={cardStyle}>
                <h2 style={titleStyle}>Parts Consumption + Cost</h2>
                <p style={descStyle}>Checkout quantity and spend analysis by store and item over a selected date range.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}
          </div>
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, margin: "0 0 8px" }}>Maintenance Operations</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {canWorkOrderReports && matchesQuery(query, "work order cost rollup labor mileage") ? (
              <Link href="/admin/reports/work-order-costs" style={cardStyle}>
                <h2 style={titleStyle}>Work Order Cost Rollup</h2>
                <p style={descStyle}>Summarized labor and mileage cost by work order for budget and reconciliation.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}

            {canRequestReports && matchesQuery(query, "maintenance request reports assignment closeout") ? (
              <Link href="/admin/reports/maintenance-requests" style={cardStyle}>
                <h2 style={titleStyle}>Maintenance Request Reports</h2>
                <p style={descStyle}>Volume, assignment load, closeout pace, and maintenance request audit events.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}

            {canSlaBreachReport && matchesQuery(query, "sla breach response close") ? (
              <Link href="/admin/reports/sla-breaches" style={cardStyle}>
                <h2 style={titleStyle}>SLA Breach Monitor</h2>
                <p style={descStyle}>Overdue and slow-close requests compared to response and close-hour targets.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}

            {(canTechnicianWorkloadReport || canRequestReports || canWorkOrderReports) && matchesQuery(query, "technician workload throughput open closed") ? (
              <Link href="/admin/reports/technician-workload" style={cardStyle}>
                <h2 style={titleStyle}>Technician Workload</h2>
                <p style={descStyle}>Open load and close-throughput by technician across requests and work orders.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}
          </div>
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, margin: "0 0 8px" }}>Preventative Maintenance & Compliance</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {canPmReports && matchesQuery(query, "pm audit activity preventative maintenance") ? (
              <Link href="/admin/reports/preventative-maintenance" style={cardStyle}>
                <h2 style={titleStyle}>PM Audit & Activity</h2>
                <p style={descStyle}>History of PM row updates, actors, timestamps, and changed fields.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}

            {(canPmComplianceReport || canPmReports) && matchesQuery(query, "pm compliance scorecard") ? (
              <Link href="/admin/reports/pm-compliance" style={cardStyle}>
                <h2 style={titleStyle}>PM Compliance Scorecard</h2>
                <p style={descStyle}>Completion coverage by location and year based on PM fill-rate and activity.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}
          </div>
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, margin: "0 0 8px" }}>Temperature & Fleet</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {(canTemperatureIncidentsReport || canTemperatureReports) && matchesQuery(query, "temperature incident timeline mocreo hub device") ? (
              <Link href="/admin/reports/temperature-incidents" style={cardStyle}>
                <h2 style={titleStyle}>Temperature Incident Timeline</h2>
                <p style={descStyle}>Hub/device alert timeline with high/low incident counts and abnormal readings.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}

            {(canFleetTcoReport || canFleetReports) && matchesQuery(query, "fleet tco vehicles cost per mile") ? (
              <Link href="/admin/reports/fleet-tco" style={cardStyle}>
                <h2 style={titleStyle}>Fleet TCO</h2>
                <p style={descStyle}>Vehicle service spend, mileage deltas, and cost-per-mile trends by unit.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}
          </div>
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, margin: "0 0 8px" }}>Security & Administration</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {(canPermissionCoverageReport || canSecurityReports) && matchesQuery(query, "permission coverage access matrix role title") ? (
              <Link href="/admin/reports/permission-coverage" style={cardStyle}>
                <h2 style={titleStyle}>Permission Coverage</h2>
                <p style={descStyle}>User access matrix with direct grants and role/title permission coverage.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}

            {(canNotificationEffectivenessReport || canSecurityReports) && matchesQuery(query, "notification effectiveness delivery read time") ? (
              <Link href="/admin/reports/notification-effectiveness" style={cardStyle}>
                <h2 style={titleStyle}>Notification Effectiveness</h2>
                <p style={descStyle}>Delivery/read trends by notification type for routing optimization.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}

            {canSecurityReports && matchesQuery(query, "audit trail activity stream") ? (
              <Link href="/admin/audit" style={cardStyle}>
                <h2 style={titleStyle}>Audit Trail</h2>
                <p style={descStyle}>Searchable activity stream for administrative and workflow traceability.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}

            {canSecurityReports && matchesQuery(query, "permission diagnostics") ? (
              <Link href="/admin/permission-diagnostics" style={cardStyle}>
                <h2 style={titleStyle}>Permission Diagnostics</h2>
                <p style={descStyle}>Validate effective coverage and find missing grants quickly.</p>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Open →</div>
              </Link>
            ) : null}
          </div>
        </section>

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
          Tip: bookmark <code>/admin/reports</code> as your reporting hub.
        </div>
      </div>
    </main>
  );
}