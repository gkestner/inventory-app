// app/admin/invoices/print-batch/page.tsx
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Script from "next/script";
import { InvoiceStatus, InvoiceVendor } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fmtDate(d: Date | null) {
  if (!d) return "N/A";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return "N/A";
  }
}

function money(n: unknown) {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "$0.00";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function vendorName(v: InvoiceVendor) {
  return v === "AMERICAN_PLUS" ? "American Plus" : "Success Plus";
}

function vendorSuffix(v: InvoiceVendor) {
  // Per your rules:
  // Success Plus => (locationNumber + SP)
  // American Plus => (locationNumber + APLS)
  return v === "AMERICAN_PLUS" ? "APLS" : "SP";
}

function storeCode(storeNumber: number | null) {
  const n = typeof storeNumber === "number" ? storeNumber : Number(storeNumber);
  if (!Number.isFinite(n)) return "00";
  return String(Math.trunc(n)).padStart(2, "0");
}

export default async function PrintInvoiceBatchPage({
  searchParams,
}: {
  searchParams: { ids?: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const idsRaw = String(searchParams.ids ?? "").trim();
  if (!idsRaw) {
    return (
      <main style={{ padding: 16 }}>
        <div style={{ fontFamily: "Arial, sans-serif" }}>Missing invoice ids.</div>
      </main>
    );
  }

  const ids = idsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const invoices = await prisma.invoice.findMany({
    where: { id: { in: ids } },
    orderBy: { invoiceDate: "asc" },
    include: {
      lines: { orderBy: { submittedAt: "asc" } },
    },
  });

  if (invoices.length === 0) {
    return (
      <main style={{ padding: 16 }}>
        <div style={{ fontFamily: "Arial, sans-serif" }}>No invoices found.</div>
      </main>
    );
  }

  // Mark as issued on print (existing behavior)
  const now = new Date();
  await prisma.invoice.updateMany({
    where: {
      id: { in: invoices.map((i) => i.id) },
      status: InvoiceStatus.DRAFT,
    },
    data: {
      status: InvoiceStatus.ISSUED,
      issuedAt: now,
    },
  });

  return (
    <main>
      {/* Best-effort auto print after navigation; Ctrl+P always works if blocked */}
      <Script id="auto-print-batch" strategy="afterInteractive">{`
(function () {
  if (window.__invoiceBatchPrintTried) return;
  window.__invoiceBatchPrintTried = true;
  setTimeout(function () {
    try { window.focus(); window.print(); } catch (e) {}
  }, 50);
})();
      `}</Script>

      <style>{`
        /* Make Chrome use a consistent printable box and stop “mystery” extra pages */
        @page {
          size: letter;
          margin: 0.25in;
        }

        @media print {
          /* Hide app chrome */
          header, nav, footer, aside { display: none !important; }
          body > :not(main) { display: none !important; }
          .no-print { display: none !important; }

          html, body {
            margin: 0 !important;
            padding: 0 !important;
            height: auto !important;
            overflow: visible !important;
          }

          main {
            margin: 0 !important;
            padding: 0 !important;
          }

          /* 1 invoice per page */
          .sheet {
            break-after: page;
            page-break-after: always;

            /* CRITICAL: prevent the old 100vh min-height from forcing an extra page */
            min-height: auto !important;
            height: auto !important;

            /* Let @page margin be the margin */
            margin: 0 !important;
            padding: 0 !important;

            max-width: none !important;
          }
          .sheet:last-child {
            break-after: auto;
            page-break-after: auto;
          }
        }

        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 0;
        }

        .no-print {
          padding: 10px 12px;
          border-bottom: 1px solid rgba(128,128,128,0.25);
          max-width: 1100px;
          margin: 0 auto;
          font-size: 12px;
          opacity: 0.8;
        }

        .sheet {
          padding: 24px 32px;
          max-width: 1100px;
          margin: 0 auto;
          /* NOTE: keep screen view comfortable, but printing overrides this */
          min-height: calc(100vh - 1in);
          display: flex;
          flex-direction: column;
          font-size: 22px;
        }

        h2 {
          margin: 0;
          font-size: 36px;
        }

        .topRow {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 16px;
          align-items: start;
        }

        .rightMeta {
          text-align: right;
          font-size: 24px;
          line-height: 1.4;
          white-space: nowrap; /* keep Vendor # ... on one line */
        }

        .leftMeta {
          font-size: 24px;
          line-height: 1.4;
        }

        .store-line {
          font-size: 48px;
          font-weight: 900;
          margin-top: 14px;
          margin-bottom: 10px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 14px;
        }

        th, td {
          border: 1px solid #000;
          padding: 6px;
          font-size: 22px;
          vertical-align: top;
        }

        th {
          background: #eee;
          text-align: left;
          white-space: nowrap;
        }

        .totals {
          margin-top: auto;
          margin-left: auto;
          text-align: right;
          font-size: 24px;
          line-height: 1.5;
          padding-top: 16px;
          white-space: nowrap;
        }
      `}</style>

      <div className="no-print">
        Printing <b>{invoices.length}</b> invoice(s). These invoices were archived (marked <b>ISSUED</b>). If the dialog didn’t open automatically, press{" "}
        <b>Ctrl+P</b>.
      </div>

      {invoices.map((inv) => {
        const vendorNum = `${storeCode(inv.storeNumber)}${vendorSuffix(inv.vendor)}`;
        const voucherNum = inv.id; // no explicit voucher field exists in schema; use invoice id so it's never blank

        return (
          <div key={inv.id} className="sheet">
            <div className="topRow">
              <div>
                <h2>{vendorName(inv.vendor)} Invoice</h2>

                <div className="leftMeta" style={{ marginTop: 8 }}>
                  <div>
                    <b>Voucher #:</b> {voucherNum}
                  </div>
                  <div>
                    <b>Period:</b> {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}
                  </div>
                </div>
              </div>

              <div className="rightMeta" style={{ marginTop: 6 }}>
                <div>
                  <b>Vendor #</b> {vendorNum}
                </div>
                <div>
                  <b>Billed to:</b> {inv.billedTo}
                </div>
                <div>
                  <b>Date Invoiced:</b> {fmtDate(inv.invoiceDate)}
                </div>
              </div>
            </div>

            <div className="store-line">
              Store: {storeCode(inv.storeNumber)} {inv.storeName}
            </div>

            <table>
              <thead>
                <tr>
                  <th>Date Submitted</th>
                  <th>SKU</th>
                  <th>Part #</th>
                  <th>Name</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Subtotal</th>
                  <th>Tax</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((line) => (
                  <tr key={line.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(line.submittedAt)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{line.sku}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{line.partNumber ?? "—"}</td>
                    <td>{line.name}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{line.quantity}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{money(line.unitPrice)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{money(line.lineSubtotal)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{money(line.lineTax)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{money(line.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="totals">
              <div>Subtotal: {money(inv.subtotal)}</div>
              <div>Tax: {money(inv.taxTotal)}</div>
              <div style={{ fontWeight: 900 }}>Total: {money(inv.total)}</div>
            </div>
          </div>
        );
      })}
    </main>
  );
}