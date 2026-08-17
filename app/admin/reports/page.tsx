// app/admin/reports/page.tsx
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { Permission, Role } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { parseReportHubPreferences } from "@/app/lib/user-preferences";
import ReportsHubClient, { type ReportHubSection } from "./ReportsHubClient";
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

  const session = (await getServerSession(authOptions)) as AdminSession;
  const userId = String(session?.user?.id ?? "").trim();
  const email = String(session?.user?.email ?? "").trim().toLowerCase();
  const sidebarUser = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { uiPreferences: true } })
    : email
      ? await prisma.user.findUnique({ where: { email }, select: { uiPreferences: true } })
      : null;
  const reportHubPrefs = parseReportHubPreferences(sidebarUser?.uiPreferences) ?? { sectionOrder: {} };

  const sections: ReportHubSection[] = [
    {
      key: "inventory",
      title: "Inventory & Ordering",
      items: [
        ...(canItemsReports && matchesQuery(query, "checkout orders tickets")
          ? [
              {
                key: "checkout-orders",
                title: "Checkout Orders",
                description: "Full searchable report of maintenance checkout tickets with all checkout fields and detailed drilldown.",
                href: "/admin/reports/checkout-orders",
              },
            ]
          : []),
        ...(canItemsReports && matchesQuery(query, "items not checked out stale unused no checkout slow moving")
          ? [
              {
                key: "items-not-checked-out",
                title: "Items Not Checked Out",
                description: "Find active parts with no checkout activity in a selected 12-month window, including all-time last checkout age.",
                href: "/admin/reports/items-not-checked-out",
              },
            ]
          : []),
        ...(canItemsReports && matchesQuery(query, "items needing order reorder queue")
          ? [
              {
                key: "needs-ordering",
                title: "Items Needing Order",
                description: "Live reorder queue for active items below minimum with Ignore/Unignore controls.",
                href: "/admin/reports/needs-ordering",
              },
            ]
          : []),
        ...(canItemsReports && matchesQuery(query, "min qty suggested minimum differences mismatch")
          ? [
              {
                key: "min-qty-differences",
                title: "Min Qty Differences",
                description: "Review items where current min qty differs from the suggested stock for the next 3 months and copy the suggestion row by row.",
                href: "/admin/reports/min-qty-differences",
              },
            ]
          : []),
        ...(canItemsReports && matchesQuery(query, "item cost history pricing")
          ? [
              {
                key: "item-cost-history",
                title: "Item Cost History",
                description: "Compare current item cost against prior points in time or selected averaging windows.",
                href: "/admin/reports/item-cost-history",
              },
            ]
          : []),
        ...(canItemsReports && matchesQuery(query, "scanner count untouched unscanned looked up not scanned")
          ? [
              {
                key: "scanner-count-untouched",
                title: "Scanner Count Untouched Parts",
                description: "Parts you have not looked up or updated from scanner count since the last reset, with reset control for the next pass.",
                href: "/admin/reports/scanner-count-untouched",
              },
            ]
          : []),
        ...(canItemsReports && matchesQuery(query, "order history inventory orders")
          ? [
              {
                key: "order-history",
                title: "Order History",
                description: "Chronological order sheet with phase states, supplier totals, and destination context.",
                href: "/admin/inventory-orders",
              },
            ]
          : []),
        ...(canItemsReports && matchesQuery(query, "orders received processing inventory receiving")
          ? [
              {
                key: "inventory-receiving",
                title: "Orders Received / Processing",
                description: "Receiving-focused view for ARRIVED orders with add-to-inventory workflow.",
                href: "/admin/inventory-receiving",
              },
            ]
          : []),
        ...((canPartsConsumptionReport || canItemsReports) && matchesQuery(query, "parts consumption cost checkout spend")
          ? [
              {
                key: "parts-consumption-costs",
                title: "Parts Consumption + Cost",
                description: "Checkout quantity and spend analysis by store and item over a selected date range.",
                href: "/admin/reports/parts-consumption-costs",
              },
            ]
          : []),
      ],
    },
    {
      key: "maintenance",
      title: "Maintenance Operations",
      items: [
        ...(canWorkOrderReports && matchesQuery(query, "work order cost rollup labor mileage")
          ? [
              {
                key: "work-order-costs",
                title: "Work Order Cost Rollup",
                description: "Summarized labor and mileage cost by work order for budget and reconciliation.",
                href: "/admin/reports/work-order-costs",
              },
            ]
          : []),
        ...(canRequestReports && matchesQuery(query, "maintenance request reports assignment closeout")
          ? [
              {
                key: "maintenance-requests",
                title: "Maintenance Request Reports",
                description: "Volume, assignment load, closeout pace, and maintenance request audit events.",
                href: "/admin/reports/maintenance-requests",
              },
            ]
          : []),
        ...(canSlaBreachReport && matchesQuery(query, "sla breach response close")
          ? [
              {
                key: "sla-breaches",
                title: "SLA Breach Monitor",
                description: "Overdue and slow-close requests compared to response and close-hour targets.",
                href: "/admin/reports/sla-breaches",
              },
            ]
          : []),
        ...((canTechnicianWorkloadReport || canRequestReports || canWorkOrderReports) && matchesQuery(query, "technician workload throughput open closed")
          ? [
              {
                key: "technician-workload",
                title: "Technician Workload",
                description: "Open load and close-throughput by technician across requests and work orders.",
                href: "/admin/reports/technician-workload",
              },
            ]
          : []),
      ],
    },
    {
      key: "pm",
      title: "Preventative Maintenance & Compliance",
      items: [
        ...(canPmReports && matchesQuery(query, "pm audit activity preventative maintenance")
          ? [
              {
                key: "preventative-maintenance",
                title: "PM Audit & Activity",
                description: "History of PM row updates, actors, timestamps, and changed fields.",
                href: "/admin/reports/preventative-maintenance",
              },
            ]
          : []),
        ...((canPmComplianceReport || canPmReports) && matchesQuery(query, "pm compliance scorecard")
          ? [
              {
                key: "pm-compliance",
                title: "PM Compliance Scorecard",
                description: "Completion coverage by location and year based on PM fill-rate and activity.",
                href: "/admin/reports/pm-compliance",
              },
            ]
          : []),
      ],
    },
    {
      key: "temperature-fleet",
      title: "Temperature & Fleet",
      items: [
        ...((canTemperatureIncidentsReport || canTemperatureReports) && matchesQuery(query, "temperature incident timeline mocreo hub device")
          ? [
              {
                key: "temperature-incidents",
                title: "Temperature Incident Timeline",
                description: "Hub/device alert timeline with high/low incident counts and abnormal readings.",
                href: "/admin/reports/temperature-incidents",
              },
            ]
          : []),
        ...((canFleetTcoReport || canFleetReports) && matchesQuery(query, "fleet tco vehicles cost per mile")
          ? [
              {
                key: "fleet-tco",
                title: "Fleet TCO",
                description: "Vehicle service spend, mileage deltas, and cost-per-mile trends by unit.",
                href: "/admin/reports/fleet-tco",
              },
            ]
          : []),
      ],
    },
    {
      key: "security",
      title: "Security & Administration",
      items: [
        ...((canPermissionCoverageReport || canSecurityReports) && matchesQuery(query, "permission coverage access matrix role title")
          ? [
              {
                key: "permission-coverage",
                title: "Permission Coverage",
                description: "User access matrix with direct grants and role/title permission coverage.",
                href: "/admin/reports/permission-coverage",
              },
            ]
          : []),
        ...((canNotificationEffectivenessReport || canSecurityReports) && matchesQuery(query, "notification effectiveness delivery read time")
          ? [
              {
                key: "notification-effectiveness",
                title: "Notification Effectiveness",
                description: "Delivery/read trends by notification type for routing optimization.",
                href: "/admin/reports/notification-effectiveness",
              },
            ]
          : []),
        ...(canSecurityReports && matchesQuery(query, "audit trail activity stream")
          ? [
              {
                key: "audit",
                title: "Audit Trail",
                description: "Searchable activity stream for administrative and workflow traceability.",
                href: "/admin/audit",
              },
            ]
          : []),
        ...(canSecurityReports && matchesQuery(query, "permission diagnostics")
          ? [
              {
                key: "permission-diagnostics",
                title: "Permission Diagnostics",
                description: "Validate effective coverage and find missing grants quickly.",
                href: "/admin/permission-diagnostics",
              },
            ]
          : []),
      ],
    },
  ];

  const border = "1px solid var(--border)";
  const fg = "var(--foreground)";

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

        <ReportsHubClient sections={sections} initialSectionOrder={reportHubPrefs.sectionOrder} />

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
          Tip: bookmark <code>/admin/reports</code> as your reporting hub.
        </div>
      </div>
    </main>
  );
}
