// app/admin/invoices/[id]/print/page.tsx
import { notFound } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";

export const dynamic = "force-dynamic";

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

function normalizeInvoiceId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id) return null;
  if (id === "undefined" || id === "null") return null;
  return id;
}

function isEnabled(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function vendorName(vendor: string) {
  return vendor === "SUCCESS_PLUS" ? "Success Plus" : "American Plus";
}

export default async function PrintInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ autoprint?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const invoiceId = normalizeInvoiceId(id);
  if (!invoiceId) return notFound();
  const autoPrint = isEnabled(sp.autoprint);

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      lines: { orderBy: { submittedAt: "asc" } },
    },
  });

  if (!invoice) return notFound();

  return (
    <main>
      {autoPrint ? (
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  if (window.__singleInvoicePrintTried) return;
  window.__singleInvoicePrintTried = true;
  setTimeout(function () {
    try { window.focus(); window.print(); } catch (e) {}
  }, 50);
})();`,
          }}
        />
      ) : null}

      <style>{`
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

          .sheet {
            height: 8.5in !important;
            max-height: 8.5in !important;
            width: 11in !important;
            max-width: 11in !important;
            box-sizing: border-box !important;
            padding: 0.25in !important;
            overflow: hidden !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }

          .sheetInner {
            zoom: 0.66;
          }

          table, tr, td, th { page-break-inside: avoid !important; break-inside: avoid !important; }
        }

        .sheet {
          box-sizing: border-box;
          background: #fff;
          color: #000;
          font-family: Arial, sans-serif;
          padding: 16px 20px;
          max-width: 1100px;
          margin: 0 auto;
        }

        .sheetInner {
          display: flex;
          flex-direction: column;
          min-height: calc(100vh - 32px);
        }

        table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }

        th, td {
          border: 1px solid #000;
          padding: 6px 8px;
          font-size: 14px;
          vertical-align: top;
        }

        th {
          background: #eee;
          text-align: left;
          white-space: nowrap;
        }

        .topRow {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 16px;
          flex-wrap: nowrap;
        }

        .title {
          font-size: 34px;
          font-weight: 800;
          margin: 0;
        }

        .metaRow {
          display: flex;
          justify-content: space-between;
          gap: 24px;
          margin-top: 8px;
          align-items: flex-start;
        }

        .metaLeft {
          font-size: 32px;
          line-height: 1.4;
        }

        .metaRight {
          font-size: 32px;
          line-height: 1.4;
          text-align: right;
          white-space: nowrap;
        }

        .store-large {
          font-size: 44px;
          font-weight: 900;
          margin: 14px 0 10px;
        }

        .num {
          text-align: right;
          white-space: nowrap;
        }

        .totals {
          margin-top: 16px;
          margin-left: auto;
          text-align: right;
          font-size: 32px;
          line-height: 1.4;
          font-weight: 800;
        }
      `}</style>

      <div className="no-print" style={{ padding: 10, fontSize: 12, opacity: 0.8, maxWidth: 1100, margin: "0 auto" }}>
        Single invoice print view. Press <b>Ctrl+P</b> if the print dialog does not open automatically.
      </div>

      <div id="print-root">
        <div className="sheet">
          <div className="sheetInner">
            <div className="topRow">
              <h2 className="title">{vendorName(invoice.vendor)} Invoice</h2>

              <div style={{ fontSize: 28, fontWeight: 800, whiteSpace: "nowrap" }}>
                Invoice <b>{invoice.vendorNumber}</b>
              </div>
            </div>

            <div className="metaRow">
              <div className="metaLeft">
                <div>
                  <b>Vendor #:</b> {invoice.vendorNumber}
                </div>
                <div>
                  <b>Billed to:</b> {invoice.billedTo}
                </div>
                <div>
                  <b>Date Invoiced:</b> {fmtDate(invoice.invoiceDate)}
                </div>
                <div>
                  <b>Period:</b> {fmtDate(invoice.periodStart)} – {fmtDate(invoice.periodEnd)}
                </div>
              </div>

              <div className="metaRight">
                <div>
                  Vendor # <b>{invoice.storeNumber}{invoice.vendor === "SUCCESS_PLUS" ? "SP" : "APLS"}</b>
                </div>
              </div>
            </div>

            <div className="store-large">
              Store: {invoice.storeNumber} {invoice.storeName}
            </div>

            <table>
              <colgroup>
                <col style={{ width: "12%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "9%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Date Submitted</th>
                  <th>SKU</th>
                  <th>Part #</th>
                  <th>Name</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit</th>
                  <th className="num">Subtotal</th>
                  <th className="num">Tax</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line) => (
                  <tr key={line.id}>
                    <td>{fmtDate(line.submittedAt)}</td>
                    <td>{line.sku}</td>
                    <td>{line.partNumber ?? "—"}</td>
                    <td>{line.name}</td>
                    <td className="num">{line.quantity}</td>
                    <td className="num">{money(line.unitPrice)}</td>
                    <td className="num">{money(line.lineSubtotal)}</td>
                    <td className="num">{money(line.lineTax)}</td>
                    <td className="num">{money(line.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="totals">
              <div>Subtotal: {money(invoice.subtotal)}</div>
              <div>Tax: {money(invoice.taxTotal)}</div>
              <div style={{ fontWeight: 900 }}>Total: {money(invoice.total)}</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
