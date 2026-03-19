// app/admin/invoices/preview/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { InvoiceVendor, PartsCheckoutStatus, Permission, Role } from "@prisma/client";
import { loadVendorPricingAndTaxConfig, evaluatePartsPriceFormula, evaluateTaxFormula } from "../actions";

export const dynamic = "force-dynamic";

type AdminSession = {
  user?: { id?: string | null; email?: string | null; role?: Role | null } | null;
} | null;

async function requireView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");
  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;
  const ok = hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) redirect("/");
}

function money(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US");
}

function parseDateOnly(s: string, endOfDay = false): Date | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const iso = endOfDay ? `${trimmed}T23:59:59.999` : `${trimmed}T00:00:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function round2(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function vendorLabel(v: InvoiceVendor) {
  return v === InvoiceVendor.AMERICAN_PLUS ? "American Plus" : "Success Plus";
}

function normalizeVendor(v: unknown): InvoiceVendor {
  return String(v ?? "").toUpperCase() === "AMERICAN_PLUS"
    ? InvoiceVendor.AMERICAN_PLUS
    : InvoiceVendor.SUCCESS_PLUS;
}

function effectiveTicketVendor(ticket: {
  vendorSnapshot?: unknown;
  item?: { vendor?: unknown } | null;
}): InvoiceVendor {
  return normalizeVendor(ticket.item?.vendor ?? ticket.vendorSnapshot);
}

function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

type SearchParams = {
  storeId?: string;
  from?: string;
  to?: string;
  vendor?: string;
};

type SearchParamsProp = Promise<SearchParams> | SearchParams;

type PreviewLine = {
  id: string;
  submittedAt: Date;
  sku: string;
  partNumber: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  lineSubtotal: number;
  lineTax: number;
  lineTotal: number;
  taxable: boolean;
};

type VendorGroup = {
  vendor: InvoiceVendor;
  storeName: string;
  storeNumber: string;
  lines: PreviewLine[];
  subtotal: number;
  taxTotal: number;
  total: number;
};

export default async function InvoicePreviewPage({
  searchParams,
}: {
  searchParams?: SearchParamsProp;
}) {
  await requireView();

  const sp: SearchParams = (searchParams instanceof Promise ? await searchParams : searchParams) ?? {};
  const storeId = String(sp.storeId ?? "").trim();
  const fromStr = String(sp.from ?? "").trim();
  const toStr = String(sp.to ?? "").trim();
  const vendorFilter = String(sp.vendor ?? "").trim().toUpperCase();

  if (!storeId || !fromStr || !toStr) return notFound();

  const from = parseDateOnly(fromStr, false);
  const to = parseDateOnly(toStr, true);
  if (!from || !to) return notFound();

  // Load tickets + store info
  const [tickets, location] = await Promise.all([
    prisma.partsCheckoutTicket.findMany({
      where: {
        storeId,
        status: PartsCheckoutStatus.OPEN,
        invoicedAt: null,
        voidedAt: null,
        createdAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        skuSnapshot: true,
        partNumberSnapshot: true,
        nameSnapshot: true,
        quantity: true,
        taxableSnapshot: true,
        costSnapshot: true,
        vendorSnapshot: true,
        createdAt: true,
        item: { select: { vendor: true } },
      },
      orderBy: [{ createdAt: "asc" }],
      take: 5000,
    }),
    prisma.location.findUnique({
      where: { id: storeId },
      select: { name: true, locationNumber: true },
    }),
  ]);

  if (!location) return notFound();

  const storeNumber = String(location.locationNumber ?? "").trim();
  const storeName = location.name;

  // Group by effective vendor
  const byVendor = new Map<InvoiceVendor, typeof tickets>();
  for (const t of tickets) {
    const v = effectiveTicketVendor(t);
    // Apply vendor filter if specified
    if (vendorFilter === "AMERICAN_PLUS" && v !== InvoiceVendor.AMERICAN_PLUS) continue;
    if (vendorFilter === "SUCCESS_PLUS" && v !== InvoiceVendor.SUCCESS_PLUS) continue;
    const arr = byVendor.get(v) ?? [];
    arr.push(t);
    byVendor.set(v, arr);
  }

  // Calculate line items per vendor group
  const vendorGroups: VendorGroup[] = [];

  for (const [vendor, vTickets] of byVendor.entries()) {
    const cfg = await loadVendorPricingAndTaxConfig(vendor);

    const lines: PreviewLine[] = [];
    let subtotalCents = 0;
    let taxCents = 0;

    for (const t of vTickets) {
      const cost = Math.max(0, toNum(t.costSnapshot));
      const qty = Math.max(0, toNum(t.quantity));

      let unitPrice = 0;
      try {
        unitPrice = round2(
          await evaluatePartsPriceFormula(cfg.partsPriceFormula, {
            cost,
            partsUpchargePct: cfg.partsUpchargePct,
          })
        );
      } catch {
        unitPrice = round2(cost);
      }

      const lineSubtotal = round2(unitPrice * qty);

      let lineTax = 0;
      if (t.taxableSnapshot) {
        try {
          lineTax = round2(
            await evaluateTaxFormula(cfg.taxFormula, {
              lineSubtotal,
              taxRatePct: cfg.taxRatePct,
              quantity: qty,
              unitPrice,
            })
          );
        } catch {
          lineTax = 0;
        }
      }

      const lineTotal = round2(lineSubtotal + lineTax);

      subtotalCents += Math.round(lineSubtotal * 100);
      taxCents += Math.round(lineTax * 100);

      lines.push({
        id: t.id,
        submittedAt: t.createdAt,
        sku: t.skuSnapshot,
        partNumber: t.partNumberSnapshot ?? null,
        name: t.nameSnapshot,
        quantity: qty,
        unitPrice,
        lineSubtotal,
        lineTax,
        lineTotal,
        taxable: t.taxableSnapshot,
      });
    }

    vendorGroups.push({
      vendor,
      storeName,
      storeNumber,
      lines,
      subtotal: subtotalCents / 100,
      taxTotal: taxCents / 100,
      total: (subtotalCents + taxCents) / 100,
    });
  }

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";

  const btn = {
    padding: "10px 14px",
    borderRadius: 12,
    border,
    background: surface,
    color: fg,
    fontWeight: 900,
    cursor: "pointer",
    lineHeight: 1,
    textDecoration: "none",
    display: "inline-block",
  } as const;

  const backHref = `/admin/invoices?from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}${vendorFilter ? `&vendor=${vendorFilter}` : ""}`;

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto", color: fg }}>
        {/* Header */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>Invoice Preview (not yet generated)</h1>
          <Link href={backHref} style={btn}>
            ← Back to Invoices
          </Link>
        </div>

        <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 16 }}>
          Store: <b>{storeNumber} {storeName}</b> &nbsp;|&nbsp; Window: <b>{fromStr}</b> → <b>{toStr}</b>
          &nbsp;|&nbsp; This is an <b>estimate</b> based on current vendor pricing settings. Final amounts are set when invoices are generated.
        </div>

        {vendorGroups.length === 0 ? (
          <div
            style={{
              padding: 20,
              borderRadius: 14,
              border,
              background: surface,
              opacity: 0.8,
            }}
          >
            No pending tickets found for this store in the selected window.
          </div>
        ) : (
          vendorGroups.map((group) => (
            <div
              key={group.vendor}
              style={{ marginBottom: 24, border, borderRadius: 14, background: surface, overflow: "hidden" }}
            >
              {/* Invoice header mimicking the print layout */}
              <div
                style={{
                  padding: "16px 20px",
                  borderBottom: border,
                  background: "rgba(33,150,243,0.06)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontSize: 20, fontWeight: 900 }}>
                    {vendorLabel(group.vendor)} Invoice — PREVIEW
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.75, fontStyle: "italic" }}>
                    Estimated · not yet generated
                  </div>
                </div>
                <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6 }}>
                  <div>
                    <b>Store:</b> {group.storeNumber} {group.storeName}
                  </div>
                  <div>
                    <b>Period:</b> {fromStr} – {toStr}
                  </div>
                  <div>
                    <b>Tickets:</b> {group.lines.length}
                  </div>
                </div>
              </div>

              {/* Line items table */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {[
                        "Date Submitted",
                        "SKU",
                        "Part #",
                        "Name",
                        "Qty",
                        "Unit Price",
                        "Subtotal",
                        "Tax",
                        "Total",
                      ].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: "left",
                            padding: "8px 12px",
                            borderBottom: border,
                            fontSize: 12,
                            opacity: 0.85,
                            whiteSpace: "nowrap",
                            background: "rgba(128,128,128,0.06)",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.lines.map((line, i) => (
                      <tr
                        key={line.id}
                        style={{
                          borderBottom: border,
                          background: i % 2 === 0 ? "transparent" : "rgba(128,128,128,0.03)",
                        }}
                      >
                        <td style={{ padding: "8px 12px", whiteSpace: "nowrap", fontSize: 13 }}>
                          {fmtDate(line.submittedAt)}
                        </td>
                        <td style={{ padding: "8px 12px", whiteSpace: "nowrap", fontSize: 13 }}>
                          {line.sku}
                        </td>
                        <td style={{ padding: "8px 12px", whiteSpace: "nowrap", fontSize: 13 }}>
                          {line.partNumber ?? "—"}
                        </td>
                        <td style={{ padding: "8px 12px", fontSize: 13 }}>{line.name}</td>
                        <td style={{ padding: "8px 12px", whiteSpace: "nowrap", fontSize: 13 }}>
                          {line.quantity}
                        </td>
                        <td style={{ padding: "8px 12px", whiteSpace: "nowrap", fontSize: 13 }}>
                          {money(line.unitPrice)}
                        </td>
                        <td style={{ padding: "8px 12px", whiteSpace: "nowrap", fontSize: 13 }}>
                          {money(line.lineSubtotal)}
                        </td>
                        <td style={{ padding: "8px 12px", whiteSpace: "nowrap", fontSize: 13 }}>
                          {money(line.lineTax)}
                          {!line.taxable ? (
                            <span style={{ fontSize: 11, opacity: 0.6 }}> (exempt)</span>
                          ) : null}
                        </td>
                        <td style={{ padding: "8px 12px", whiteSpace: "nowrap", fontWeight: 900, fontSize: 13 }}>
                          {money(line.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals footer */}
              <div
                style={{
                  padding: "14px 20px",
                  borderTop: border,
                  display: "flex",
                  justifyContent: "flex-end",
                }}
              >
                <div style={{ textAlign: "right", lineHeight: 1.8, fontSize: 14 }}>
                  <div>
                    Subtotal: <b>{money(group.subtotal)}</b>
                  </div>
                  <div>
                    Tax: <b>{money(group.taxTotal)}</b>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 900, marginTop: 4 }}>
                    Estimated Total: {money(group.total)}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
