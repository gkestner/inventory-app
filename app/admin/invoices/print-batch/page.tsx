// app/admin/invoices/print-batch/page.tsx
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { InvoiceStatus, Permission, Role, InvoiceVendor } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

async function requireInvoicesView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  const ok = hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) redirect("/");
}

function money(n: Decimal | null) {
  if (!n) return "$0.00";
  const x = Number(n);
  if (!Number.isFinite(x)) return "$0.00";
  return x.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US");
}

function vendorName(vendor: InvoiceVendor) {
  return vendor === "SUCCESS_PLUS" ? "Success Plus" : "American Plus";
}

function vendorNumberFor(storeNumber: string, vendor: InvoiceVendor) {
  // Success Plus = (location number + SP)
  // American Plus = (location number + APLS)
  const sn = String(storeNumber ?? "").trim();
  if (!sn) return "—";
  return `${sn}${vendor === "SUCCESS_PLUS" ? "SP" : "APLS"}`;
}

function safeDecodeOnce(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function parseIds(raw: string | undefined): string[] {
  const s0 = String(raw ?? "").trim();
  if (!s0) return [];
  const decoded = safeDecodeOnce(s0);
  return decoded
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 200);
}

export default async function PrintInvoiceBatchPage({ searchParams }: { searchParams: { ids?: string } }) {
  await requireInvoicesView();

  const ids = parseIds(searchParams.ids);

  const invoices =
    ids.length > 0
      ? await prisma.invoice
          .findMany({
            where: { id: { in: ids } },
            include: { lines: { orderBy: { submittedAt: "asc" } } },
          })
          .then((rows) => {
            const map = new Map(rows.map((r) => [r.id, r]));
            return ids.map((id) => map.get(id)).filter(Boolean) as typeof rows;
          })
      : await prisma.invoice.findMany({
          where: { status: InvoiceStatus.DRAFT },
          orderBy: { createdAt: "asc" },
          take: 200,
          include: { lines: { orderBy: { submittedAt: "asc" } } },
        });

  if (invoices.length === 0) {
    return (
      <main style={{ padding: 24 }}>
        <div
          style={{
            padding: 16,
            maxWidth: 900,
            margin: "0 auto",
            borderRadius: 14,
            border: "1px solid rgba(128,128,128,0.25)",
            background: "var(--background)",
            color: "var(--foreground)",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 900 }}>Invoice Batch Print</div>
          <div style={{ marginTop: 10, opacity: 0.85, lineHeight: 1.6 }}>
            {ids.length > 0 ? (
              <>
                No invoices found for the provided <b>ids</b>.
              </>
            ) : (
              <>
                No invoices are currently in <b>DRAFT</b>.
              </>
            )}
          </div>
        </div>
      </main>
    );
  }

  // Mark DRAFT invoices as ISSUED when opening this print page
  const now = new Date();
  await prisma.invoice.updateMany({
    where: { id: { in: invoices.map((i) => i.id) }, status: InvoiceStatus.DRAFT },
    data: { status: InvoiceStatus.ISSUED, issuedAt: now },
  });

  const templateStamp = "print-batch v2026-03-02h";

  // Keep normal screen styling here; print rules override via CSS below
  const sheet: CSSProperties = {
    boxSizing: "border-box",
    background: "#fff",
    color: "#000",
    fontFamily: "Arial, sans-serif",
    padding: "16px 20px",
  };

  const topRow: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 16,
    flexWrap: "nowrap",
  };

  const title: CSSProperties = {
    fontSize: 34, // (your current request: smaller title)
    fontWeight: 800,
    margin: 0,
  };

  const meta: CSSProperties = {
    fontSize: 32,
    lineHeight: 1.4,
    marginTop: 8,
  };

  const storeLine: CSSProperties = {
    fontSize: 44,
    fontWeight: 900,
    margin: "14px 0 10px",
  };

  const tableStyle: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: "fixed",
  };

  const thBase: CSSProperties = {
    border: "1px solid #000",
    padding: "6px 8px",
    background: "#eee",
    fontWeight: 800,
    textAlign: "left",
    whiteSpace: "nowrap",
    fontSize: 14,
  };

  const tdBase: CSSProperties = {
    border: "1px solid #000",
    padding: "6px 8px",
    fontSize: 14,
    verticalAlign: "top",
  };

  const num: CSSProperties = { textAlign: "right", whiteSpace: "nowrap" };

  const totals: CSSProperties = {
    marginTop: 16,
    marginLeft: "auto",
    textAlign: "right",
    fontSize: 32,
    lineHeight: 1.4,
    fontWeight: 800,
  };

  return (
    <main>
      <script
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: `
(function () {
  if (window.__invoiceBatchPrintTried) return;
  window.__invoiceBatchPrintTried = true;
  setTimeout(function () {
    try { window.focus(); window.print(); } catch (e) {}
  }, 50);
})();`,
        }}
      />

      <style>{`
        /*
          ✅ Chrome “Default margins” is not reliably controllable via CSS.
          So we set page margin to 0 and implement our own narrow padding inside the page.
          This makes print output deterministic.
        */
        @page { size: letter landscape; margin: 0; }

        @media print {
          body * { visibility: hidden !important; }
          #print-root, #print-root * { visibility: visible !important; }

          #print-root {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }

          .no-print { display: none !important; }

          /*
            ✅ HARD RULE: one invoice = one physical page.
            Letter landscape page height is 8.5in. We set the sheet to exactly that.
          */
          .sheet {
            height: 8.5in !important;
            max-height: 8.5in !important;
            width: 11in !important;
            max-width: 11in !important;

            box-sizing: border-box !important;

            /* Our own "narrow margins" inside the page */
            padding: 0.25in !important;

            /* Prevent spill creating another page */
            overflow: hidden !important;

            break-after: page;
            page-break-after: always;
          }
          .sheet:last-child { break-after: auto; page-break-after: auto; }

          /*
            ✅ CRITICAL: use zoom (Chrome paginates with zoom, not transform)
            Tuned to fit your large meta/totals reliably on one page.
          */
          .sheetInner {
            zoom: 0.66;
          }

          /* Help Chrome avoid weird mid-row pagination logic */
          table, tr, td, th { page-break-inside: avoid !important; break-inside: avoid !important; }
        }
      `}</style>

      <div className="no-print" style={{ padding: 10, fontSize: 12, opacity: 0.8, maxWidth: 1100, margin: "0 auto" }}>
        Printing <b>{invoices.length}</b> invoice(s). If the print dialog doesn’t open automatically, press <b>Ctrl+P</b>. • {templateStamp}
      </div>

      <div id="print-root">
        {invoices.map((inv) => {
          const vendorNo = vendorNumberFor(inv.storeNumber, inv.vendor);
          const voucherNo = inv.vendorNumber || "N/A";

          return (
            <div key={inv.id} className="sheet" style={sheet}>
              <div className="sheetInner">
                <div style={topRow}>
                  <h2 style={title}>{vendorName(inv.vendor)} Invoice</h2>

                  <div style={{ fontSize: 28, fontWeight: 800, whiteSpace: "nowrap" }}>
                    Vendor # <b>{vendorNo}</b>
                  </div>
                </div>

                <div style={meta}>
                  <div>
                    <b>Voucher #:</b> {voucherNo}
                  </div>
                  <div>
                    <b>Billed to:</b> {inv.billedTo}
                  </div>
                  <div>
                    <b>Date Invoiced:</b> {fmtDate(inv.invoiceDate)}
                  </div>
                  <div>
                    <b>Period:</b> {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}
                  </div>
                </div>

                <div style={storeLine}>
                  Store: {inv.storeNumber} {inv.storeName}
                </div>

                <table style={tableStyle}>
                  <colgroup>
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "8%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "22%" }} />
                    <col style={{ width: "6%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "8%" }} />
                    <col style={{ width: "10%" }} />
                  </colgroup>

                  <thead>
                    <tr>
                      <th style={thBase}>Date</th>
                      <th style={thBase}>SKU</th>
                      <th style={thBase}>Part #</th>
                      <th style={thBase}>Name</th>
                      <th style={{ ...thBase, ...num }}>Qty</th>
                      <th style={{ ...thBase, ...num }}>Unit</th>
                      <th style={{ ...thBase, ...num }}>Subtotal</th>
                      <th style={{ ...thBase, ...num }}>Tax</th>
                      <th style={{ ...thBase, ...num }}>Total</th>
                    </tr>
                  </thead>

                  <tbody>
                    {inv.lines.map((line) => (
                      <tr key={line.id}>
                        <td style={tdBase}>{fmtDate(line.submittedAt)}</td>
                        <td style={tdBase}>{line.sku}</td>
                        <td style={tdBase}>{line.partNumber ?? "—"}</td>
                        <td style={tdBase}>{line.name}</td>
                        <td style={{ ...tdBase, ...num }}>{line.quantity}</td>
                        <td style={{ ...tdBase, ...num }}>{money(line.unitPrice)}</td>
                        <td style={{ ...tdBase, ...num }}>{money(line.lineSubtotal)}</td>
                        <td style={{ ...tdBase, ...num }}>{money(line.lineTax)}</td>
                        <td style={{ ...tdBase, ...num }}>{money(line.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={totals}>
                  <div>Subtotal: {money(inv.subtotal)}</div>
                  <div>Tax: {money(inv.taxTotal)}</div>
                  <div style={{ fontWeight: 900 }}>Total: {money(inv.total)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}