import Link from "next/link";
import { Permission } from "@prisma/client";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS } from "@/app/lib/permission-constants";
import { prisma } from "@/app/lib/prisma";
import {
  partsCheckoutLocationDetails, partsLocationSearchParams, type PartsLocationFilters,
} from "@/app/lib/parts-checkout-location-report";

export const dynamic = "force-dynamic";

const border = "1px solid var(--border)";
const cell = { padding: "9px 12px", borderBottom: border };

function money(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function LocationCheckoutDetailsPage({
  params, searchParams,
}: {
  params: Promise<{ locationId: string }>;
  searchParams?: Promise<PartsLocationFilters>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const permissions = await loadUserPermissions(session);
  if (!permissions.allowAll && !hasAnyPermission(permissions, [
    ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS, Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS,
  ])) redirect("/");

  const { locationId } = await params;
  const filters = (await searchParams) ?? {};
  const [location, report] = await Promise.all([
    prisma.location.findUnique({ where: { id: locationId }, select: { name: true, locationNumber: true } }),
    partsCheckoutLocationDetails(filters, locationId),
  ]);
  if (!location) notFound();
  const backHref = `/admin/reports/parts-checkout-by-location?${partsLocationSearchParams(report.filters)}`;
  const locationName = location.locationNumber ? `${location.locationNumber} — ${location.name}` : location.name;

  return (
    <main style={{ maxWidth: 1450, margin: "0 auto", padding: 16, display: "grid", gap: 14 }}>
      <section style={{ border, borderRadius: 14, background: "var(--surface)", padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>{locationName}: Parts Checkout Details</h1>
          <Link href={backHref}>← All locations</Link>
        </div>
        <p style={{ color: "var(--muted)", marginBottom: 0 }}>
          All matching Maintenance Tickets are shown below, grouped by checkout date in Eastern time. Total cost is the cost recorded at checkout × quantity; invoice numbers come from linked invoices.
        </p>
        <p style={{ color: "var(--muted)", marginBottom: 0 }}>
          Dates: {report.filters.from || "all"} to {report.filters.to || "all"}
          {report.filters.category ? ` · Category contains: ${report.filters.category}` : ""}
          {report.filters.q ? ` · Item search: ${report.filters.q}` : ""}
          {report.filters.itemId ? " · One selected item" : ""}
        </p>
      </section>

      {report.dateError ? <p role="alert" style={{ color: "#b42318" }}>{report.dateError}</p> : null}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        {[
          ["Parts checked out", report.totalQuantity.toLocaleString()],
          ["Checkout tickets", report.totalTickets.toLocaleString()],
          ["Total parts cost", money(report.totalCostCents)],
        ].map(([label, value]) => (
          <article key={label} style={{ border, borderRadius: 12, background: "var(--surface)", padding: 14 }}>
            <div style={{ color: "var(--muted)" }}>{label}</div>
            <strong style={{ fontSize: 28 }}>{value}</strong>
          </article>
        ))}
      </section>
      {report.missingCostTickets > 0 ? (
        <p style={{ margin: 0, color: "var(--muted)" }}>
          {report.missingCostTickets.toLocaleString()} checkout {report.missingCostTickets === 1 ? "ticket has" : "tickets have"} no recorded cost and cannot be included in dollar totals.
        </p>
      ) : null}

      {report.days.map((day) => (
        <section key={day.date} style={{ border, borderRadius: 14, background: "var(--surface)", overflowX: "auto" }}>
          <h2 style={{ padding: 14, margin: 0, fontSize: 20 }}>{day.date}</h2>
          <table style={{ width: "100%", minWidth: 940, borderCollapse: "collapse" }}>
            <thead><tr>
              {["Checked out at", "Item", "Checked out by", "Invoice #", "Quantity", "Total cost"].map((heading) => (
                <th key={heading} scope="col" style={{ ...cell, textAlign: "left" }}>{heading}</th>
              ))}
            </tr></thead>
            <tbody>
              {day.rows.map((row) => (
                <tr key={row.id}>
                  <td style={cell}>{row.checkedOutAt.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })}</td>
                  <td style={cell}><strong>{row.item}</strong><br /><small>{row.sku}{row.partNumber ? ` · ${row.partNumber}` : ""}</small></td>
                  <td style={cell}>{row.checkedOutBy}</td>
                  <td style={cell}>{row.invoiceNumber || "Not invoiced"}</td>
                  <td style={cell}>{row.quantity.toLocaleString()}</td>
                  <td style={cell}>{row.costCents === null ? "—" : money(row.costCents)}</td>
                </tr>
              ))}
              <tr>
                <th colSpan={4} style={{ ...cell, textAlign: "right" }}>Daily total</th>
                <th style={{ ...cell, textAlign: "left" }}>{day.quantity.toLocaleString()}</th>
                <th style={{ ...cell, textAlign: "left" }}>{money(day.costCents)}</th>
              </tr>
            </tbody>
          </table>
          {day.missingCostTickets > 0 ? <p style={{ padding: "0 14px", color: "var(--muted)" }}>Cost unavailable for {day.missingCostTickets} ticket(s) on this date.</p> : null}
        </section>
      ))}
      {report.days.length === 0 && !report.dateError ? (
        <section style={{ border, borderRadius: 14, background: "var(--surface)", padding: 16 }}>No checkouts match these filters at this location.</section>
      ) : null}
    </main>
  );
}
