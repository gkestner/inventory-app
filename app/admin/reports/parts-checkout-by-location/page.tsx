import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS } from "@/app/lib/permission-constants";
import { prisma } from "@/app/lib/prisma";
import { partsCheckoutLocationReport, type PartsLocationFilters } from "@/app/lib/parts-checkout-location-report";

export const dynamic = "force-dynamic";

const border = "1px solid var(--border)";
const cell = { padding: "9px 12px", borderBottom: border };

function locationLabel(name: string, number: string | null) {
  return number ? `${number} — ${name}` : name;
}

function reportLink(filters: PartsLocationFilters, itemId?: string) {
  const params = new URLSearchParams();
  for (const key of ["from", "to", "category"] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  if (itemId) params.set("itemId", itemId);
  return `/admin/reports/parts-checkout-by-location?${params}`;
}

export default async function PartsCheckoutByLocationPage({
  searchParams,
}: {
  searchParams?: Promise<PartsLocationFilters>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const permissions = await loadUserPermissions(session);
  if (!permissions.allowAll && !hasAnyPermission(permissions, [
    ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS, Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS,
  ])) redirect("/");

  const [report, coverage, voidedCount] = await Promise.all([
    partsCheckoutLocationReport((await searchParams) ?? {}),
    prisma.partsCheckoutTicket.aggregate({ _count: { _all: true }, _min: { createdAt: true } }),
    prisma.partsCheckoutTicket.count({ where: { status: "VOIDED" } }),
  ]);
  const selectedItem = report.filters.itemId
    ? await prisma.item.findUnique({
        where: { id: report.filters.itemId },
        select: { id: true, name: true, sku: true, partNumber: true },
      })
    : null;
  const invalidItem = Boolean(report.filters.itemId && !selectedItem);

  return (
    <main style={{ maxWidth: 1450, margin: "0 auto", padding: 16, display: "grid", gap: 14 }}>
      <section style={{ border, borderRadius: 14, padding: 16, background: "var(--surface)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>Parts Checked Out by Location</h1>
          <Link href="/admin/reports">Reports Hub</Link>
        </div>
        <p style={{ color: "var(--muted)", marginBottom: 0 }}>
          Quantities from Maintenance Tickets (Parts Checkout). Dates use ticket checkout time. Voided tickets and return records are excluded. Categories reflect the item&apos;s current category.
        </p>
        <p style={{ color: "var(--muted)", marginBottom: 0 }}>
          Available ticket history: {coverage._count._all.toLocaleString()} records
          {coverage._min.createdAt ? ` since ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium" }).format(coverage._min.createdAt)}` : ""}.
          {` ${voidedCount.toLocaleString()} voided or return records are excluded from usage totals.`}
          {" "}<Link href="/admin/reports/checkout-orders">View every ticket status</Link>
        </p>
      </section>

      <form method="get" style={{ border, borderRadius: 14, padding: 16, background: "var(--surface)", display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 5 }}>From date
            <input type="date" name="from" defaultValue={report.filters.from} style={{ padding: 9, borderRadius: 8, border }} />
          </label>
          <label style={{ display: "grid", gap: 5 }}>To date
            <input type="date" name="to" defaultValue={report.filters.to} style={{ padding: 9, borderRadius: 8, border }} />
          </label>
          <label style={{ display: "grid", gap: 5 }}>Item category contains
            <input type="search" name="category" defaultValue={report.filters.category} placeholder="Type any part of a category" style={{ padding: 9, borderRadius: 8, border }} />
          </label>
          {selectedItem ? (
            <div style={{ display: "grid", gap: 5 }}>
              <span>Selected item</span>
              <strong>{selectedItem.name} ({selectedItem.partNumber || selectedItem.sku})</strong>
              <input type="hidden" name="itemId" value={selectedItem.id} />
              <Link href={reportLink(report.filters)}>Clear item selection</Link>
            </div>
          ) : (
            <label style={{ display: "grid", gap: 5 }}>Item search
              <input type="search" name="q" defaultValue={report.filters.q} placeholder="Item #, SKU, part #, name, description…" style={{ padding: 9, borderRadius: 8, border }} />
            </label>
          )}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button type="submit" style={{ padding: "9px 16px", borderRadius: 8, border, fontWeight: 800 }}>Run Report</button>
          <Link href="/admin/reports/parts-checkout-by-location">Clear all filters</Link>
        </div>
        {report.dateError ? <p role="alert" style={{ color: "#b42318", margin: 0 }}>{report.dateError}</p> : null}
        {invalidItem ? <p role="alert" style={{ color: "#b42318", margin: 0 }}>The selected item no longer exists. Clear the selection to search again.</p> : null}
      </form>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <article style={{ border, borderRadius: 12, background: "var(--surface)", padding: 14 }}>
          <div style={{ color: "var(--muted)" }}>Total parts checked out</div>
          <strong style={{ fontSize: 30 }}>{report.totalQuantity.toLocaleString()}</strong>
        </article>
        <article style={{ border, borderRadius: 12, background: "var(--surface)", padding: 14 }}>
          <div style={{ color: "var(--muted)" }}>Checkout tickets</div>
          <strong style={{ fontSize: 30 }}>{report.totalTickets.toLocaleString()}</strong>
        </article>
        <article style={{ border, borderRadius: 12, background: "var(--surface)", padding: 14 }}>
          <div style={{ color: "var(--muted)" }}>Locations with matching checkouts</div>
          <strong style={{ fontSize: 30 }}>{report.locationTotals.length.toLocaleString()}</strong>
        </article>
      </section>

      <section style={{ border, borderRadius: 14, background: "var(--surface)", overflowX: "auto" }}>
        <h2 style={{ padding: 14, margin: 0 }}>Totals by location</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={cell}>Location</th><th style={cell}>Parts checked out</th><th style={cell}>Tickets</th></tr></thead>
          <tbody>
            {report.locationTotals.map((row) => <tr key={row.locationId}>
              <td style={cell}>{locationLabel(row.location, row.locationNumber)}</td>
              <td style={cell}>{row.quantity.toLocaleString()}</td>
              <td style={cell}>{row.tickets.toLocaleString()}</td>
            </tr>)}
            {report.locationTotals.length === 0 ? <tr><td colSpan={3} style={cell}>No checkouts match these filters.</td></tr> : null}
            {report.locationTotals.length > 0 ? <tr><th style={cell}>All locations</th><th style={cell}>{report.totalQuantity.toLocaleString()}</th><th style={cell}>{report.totalTickets.toLocaleString()}</th></tr> : null}
          </tbody>
        </table>
      </section>

      <section style={{ border, borderRadius: 14, background: "var(--surface)", overflowX: "auto" }}>
        <h2 style={{ padding: 14, margin: 0 }}>Items by location</h2>
        <p style={{ padding: "0 14px", color: "var(--muted)" }}>Search to find matching items, then choose Select item to see that item alone.</p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["Location", "Item #", "SKU", "Part #", "Item", "Category", "Parts checked out", "Tickets", ""].map((heading) => <th key={heading} style={cell}>{heading}</th>)}</tr></thead>
          <tbody>
            {report.rows.map((row) => <tr key={`${row.locationId}:${row.itemId}`}>
              <td style={cell}>{locationLabel(row.location, row.locationNumber)}</td>
              <td style={cell}>{row.labelNumber ?? "—"}</td>
              <td style={cell}>{row.sku}</td>
              <td style={cell}>{row.partNumber || "—"}</td>
              <td style={cell}>{row.item}</td>
              <td style={cell}>{row.category || "Uncategorized"}</td>
              <td style={cell}>{row.quantity.toLocaleString()}</td>
              <td style={cell}>{row.tickets.toLocaleString()}</td>
              <td style={cell}><Link href={reportLink(report.filters, row.itemId)}>Select item</Link></td>
            </tr>)}
            {report.rows.length === 0 ? <tr><td colSpan={9} style={cell}>No matching items.</td></tr> : null}
          </tbody>
        </table>
      </section>
    </main>
  );
}
