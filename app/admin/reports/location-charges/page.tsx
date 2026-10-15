import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission, Prisma } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { locationChargesQuery } from "@/app/lib/location-charges-report";

export const dynamic = "force-dynamic";

type SearchParams = {
  locationId?: string;
  from?: string;
  to?: string;
  q?: string;
  status?: string;
  page?: string;
};

const PAGE_SIZE = 100;
const border = "1px solid var(--border)";

function money(value: Prisma.Decimal | null | undefined): string {
  return Number(value ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function reportHref(sp: SearchParams, page: number): string {
  const params = new URLSearchParams();
  for (const key of ["locationId", "from", "to", "q", "status"] as const) {
    if (sp[key]) params.set(key, sp[key]);
  }
  params.set("page", String(page));
  return `/admin/reports/location-charges?${params.toString()}`;
}

export default async function LocationChargesReportPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS])) {
    redirect("/");
  }

  const sp = (await searchParams) ?? {};
  const { locationId, fromRaw, toRaw, q, status, dateError, where } = locationChargesQuery(sp);
  const requestedPage = Number(sp.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const [locations, coverage] = await Promise.all([
    prisma.location.findMany({
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, locationNumber: true, active: true },
    }),
    prisma.invoiceLine.aggregate({ _count: { _all: true }, _min: { submittedAt: true } }),
  ]);
  const locationError = Boolean(locationId && !locations.some((location) => location.id === locationId));

  const [totals, lines] = dateError || locationError
    ? [{ _count: { _all: 0 }, _sum: { quantity: null, lineSubtotal: null, lineTax: null, lineTotal: null } }, []] as const
    : await Promise.all([
        prisma.invoiceLine.aggregate({
          where,
          _count: { _all: true },
          _sum: { quantity: true, lineSubtotal: true, lineTax: true, lineTotal: true },
        }),
        prisma.invoiceLine.findMany({
          where,
          orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
          select: {
            id: true, submittedAt: true, sku: true, partNumber: true, name: true,
            quantity: true, unitPrice: true, lineSubtotal: true, lineTax: true, lineTotal: true,
            checkoutId: true,
            invoice: {
              select: {
                id: true, storeName: true, storeNumber: true, vendor: true,
                status: true, invoiceDate: true,
              },
            },
          },
        }),
      ]);

  const pageCount = Math.ceil(totals._count._all / PAGE_SIZE);

  return (
    <main style={{ maxWidth: 1450, margin: "0 auto", padding: 16, color: "var(--foreground)", display: "grid", gap: 14 }}>
      <section style={{ border, borderRadius: 14, background: "var(--surface)", padding: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 28, margin: 0 }}>Items Charged to Locations</h1>
          <Link href="/admin/reports">← Reports Hub</Link>
        </div>
        <p style={{ color: "var(--muted)", marginBottom: 0 }}>
          Invoice line items, including checkout parts and manual entries. Dates filter the original checkout or manual entry date.
          Draft invoices are pending; voided invoices are excluded by default. Checkouts without an invoice line appear in the checkout report instead.
        </p>
        <p style={{ color: "var(--muted)", marginBottom: 0 }}>
          Available charge history: {coverage._count._all.toLocaleString()} lines
          {coverage._min.submittedAt ? ` since ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium" }).format(coverage._min.submittedAt)}` : ""}.
          {" "}<Link href="/admin/reports/parts-checkout-by-location">View checkout history</Link>
        </p>
      </section>

      <form method="get" style={{ border, borderRadius: 14, background: "var(--surface)", padding: 16, display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 5 }}>Location
            <select name="locationId" defaultValue={locationError ? "" : locationId} style={{ padding: 9, borderRadius: 8, border }}>
              <option value="">All locations</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.locationNumber ? `${location.locationNumber} — ` : ""}{location.name}{location.active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 5 }}>From
            <input type="date" name="from" defaultValue={fromRaw} style={{ padding: 9, borderRadius: 8, border }} />
          </label>
          <label style={{ display: "grid", gap: 5 }}>To
            <input type="date" name="to" defaultValue={toRaw} style={{ padding: 9, borderRadius: 8, border }} />
          </label>
          <label style={{ display: "grid", gap: 5 }}>Invoice status
            <select name="status" defaultValue={status} style={{ padding: 9, borderRadius: 8, border }}>
              <option value="active">All except voided</option>
              <option value="all">All statuses</option>
              <option value="DRAFT">Draft / pending</option>
              <option value="ISSUED">Issued</option>
              <option value="PAID">Paid</option>
              <option value="VOIDED">Voided</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 5 }}>Search within report
            <input type="search" name="q" defaultValue={q} placeholder="Item, SKU, part #, invoice, location" style={{ padding: 9, borderRadius: 8, border }} />
          </label>
        </div>
        {dateError ? <p role="alert" style={{ color: "#dc2626", margin: 0 }}>Enter valid dates with From on or before To.</p> : null}
        {locationError ? <p role="alert" style={{ color: "#dc2626", margin: 0 }}>That location is no longer available. Choose a location and apply the filters again.</p> : null}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button type="submit" style={{ padding: "9px 14px", borderRadius: 8, border, fontWeight: 800 }}>Apply filters</button>
          <Link href="/admin/reports/location-charges">Reset</Link>
        </div>
      </form>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        {[
          ["Line items", totals._count._all.toLocaleString("en-US")],
          ["Quantity", Number(totals._sum.quantity ?? 0).toLocaleString("en-US")],
          ["Subtotal", money(totals._sum.lineSubtotal)],
          ["Tax", money(totals._sum.lineTax)],
          ["Total", money(totals._sum.lineTotal)],
        ].map(([label, value]) => (
          <article key={label} style={{ border, borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
            <strong style={{ fontSize: 22 }}>{value}</strong>
          </article>
        ))}
      </section>

      <section style={{ border, borderRadius: 14, background: "var(--surface)", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1050 }}>
          <thead><tr>
            {["Charge date", "Location", "Item", "SKU / Part #", "Source", "Status", "Qty", "Unit price", "Subtotal", "Tax", "Total", "Invoice"].map((heading) => (
              <th key={heading} scope="col" style={{ textAlign: "left", padding: 10, borderBottom: border, whiteSpace: "nowrap" }}>{heading}</th>
            ))}
          </tr></thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap" }}>{line.submittedAt.toLocaleDateString("en-US", { timeZone: "America/New_York" })}</td>
                <td style={{ padding: 10, borderBottom: border }}>{line.invoice.storeNumber ? `${line.invoice.storeNumber} — ` : ""}{line.invoice.storeName}</td>
                <td style={{ padding: 10, borderBottom: border, fontWeight: 700 }}>{line.name}</td>
                <td style={{ padding: 10, borderBottom: border }}>{line.sku || "—"}<br />{line.partNumber || "—"}</td>
                <td style={{ padding: 10, borderBottom: border }}>{line.checkoutId ? "Checkout" : "Manual"}</td>
                <td style={{ padding: 10, borderBottom: border }}>{line.invoice.status}</td>
                <td style={{ padding: 10, borderBottom: border }}>{line.quantity}</td>
                <td style={{ padding: 10, borderBottom: border }}>{money(line.unitPrice)}</td>
                <td style={{ padding: 10, borderBottom: border }}>{money(line.lineSubtotal)}</td>
                <td style={{ padding: 10, borderBottom: border }}>{money(line.lineTax)}</td>
                <td style={{ padding: 10, borderBottom: border, fontWeight: 700 }}>{money(line.lineTotal)}</td>
                <td style={{ padding: 10, borderBottom: border, fontFamily: "monospace", fontSize: 11 }} title={line.invoice.id}>{line.invoice.id.slice(0, 12)}…</td>
              </tr>
            ))}
            {lines.length === 0 ? <tr><td colSpan={12} style={{ padding: 16, color: "var(--muted)" }}>No charged items match these filters.</td></tr> : null}
          </tbody>
        </table>
      </section>

      {pageCount > 1 ? (
        <nav aria-label="Report pages" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {page > 1 ? <Link href={reportHref(sp, page - 1)}>← Previous</Link> : null}
          <span>Page {page} of {pageCount} · {totals._count._all.toLocaleString("en-US")} matching lines</span>
          {page < pageCount ? <Link href={reportHref(sp, page + 1)}>Next →</Link> : null}
        </nav>
      ) : null}
    </main>
  );
}
