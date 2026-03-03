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
  return v === "AMERICAN_PLUS" ? "APLS" : "SP";
}

/**
 * storeNumber appears to be string-like (ex "03", "55", or "55 CLINTWOOD").
 * Extract digits and pad to 2.
 */
function storeCode(storeNumber: string | number | null | undefined) {
  if (storeNumber === null || storeNumber === undefined) return "00";
  const raw = String(storeNumber).trim();
  const digitsOnly = raw.replace(/[^\d]/g, "");
  if (!digitsOnly) return "00";
  const n = Number(digitsOnly);
  if (!Number.isFinite(n)) return "00";
  return String(Math.trunc(n)).padStart(2, "0");
}

type SearchParams = {
  ids?: string | string[];
};

export default async function PrintInvoiceBatchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const sp = await searchParams;

  const idsRaw =
    Array.isArray(sp.ids) ? sp.ids.join(",") : typeof sp.ids === "string" ? sp.ids : "";

  const idsClean = idsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (idsClean.length === 0) {
    return (
      <main style={{ padding: 16, fontFamily: "Arial, sans-serif" }}>
        Missing invoice ids.
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
          Expected URL like: <code>/admin/invoices/print-batch?ids=ID1,ID2</code>
        </div>
      </main>
    );
  }

  const invoices = await prisma.invoice.findMany({
    where: { id: { in: idsClean } },
    orderBy: { invoiceDate: "asc" },
    include: {
      lines: { orderBy: { submittedAt: "asc" } },
    },
  });

  if (invoices.length === 0) {
    return (
      <main style={{ padding: 16, fontFamily: "Arial, sans-serif" }}>
        No invoices found.
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
    <div className="printRoot">
      {/* Auto-print */}
      <Script id="auto-print-batch" strategy="afterInteractive">{`
(function () {
  if (window.__invoiceBatchPrintTried) return;
  window.__invoiceBatchPrintTried = true;
  setTimeout(function () {
    try { window.focus(); window.print(); } catch (e) {}
  }, 80);
})();
      `}</Script>

      <style>{`
        /* Force landscape + narrow margins */
        @page {
          size: letter landscape;
          margin: 0.25in;
        }

        /* ---- Print visibility technique (works with Next layout wrappers) ---- */
        @media print {
          html, body { height: auto !important; }
          body * { visibility: hidden !important; }
          .printRoot, .printRoot * { visibility: visible !important; }

          .printRoot {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }

          .noPrintHint { display: none !important; }
        }

        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 0;
          background: #fff;
          color: #000;
        }

        .noPrintHint {
          padding: 10px 12px;
          border-bottom: 1px solid rgba(0,0,0,0.15);
          max-width: 1100px;
          margin: 0 auto;
          font-size: 12px;
          opacity: 0.8;
        }

        /* One invoice “sheet” */
        .sheet {
          padding: 18px 22px;
          max-width: 1100px;
          margin: 0 auto;
          box-sizing: border-box;
        }

        .topRow {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 16px;
          align-items: start;
        }

        h2 {
          margin: 0;
          font-size: 28px;
          font-weight: 800;
        }

        .leftMeta {
          margin-top: 8px;
          font-size: 16px;
          line-height: 1.35;
        }

        .rightMeta {
          margin-top: 6px;
          text-align: right;
          font-size: 16px;
          line-height: 1.35;
          white-space: nowrap; /* Vendor # always one line */
        }

        .storeLine {
          font-size: 40px;
          font-weight: 900;
          margin-top: 14px;
          margin-bottom: 10px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
        }

        th, td {
          border: 1px solid #000;
          padding: 6px 6px;
          font-size: 14px;
          vertical-align: top;
        }

        th {
          background: #eee;
          text-align: left;
          white-space: nowrap;
        }

        .totals {
          margin-top: 12px;
          margin-left: auto;
          width: fit-content;
          text-align: right;
          font-size: 18px;
          line-height: 1.35;
          font-weight: 700;
          white-space: nowrap;
        }
      `}</style>

      <div className="noPrintHint">
        Printing <b>{invoices.length}</b> invoice(s). If the dialog doesn’t open automatically, press <b>Ctrl+P</b>.
      </div>

      {invoices.map((inv, idx) => {
        const sc = storeCode(inv.storeNumber as unknown as string | number | null);
        const vendorNum = `${sc}${vendorSuffix(inv.vendor)}`;
        const voucherNum = inv.id; // never blank

        const isLast = idx === invoices.length - 1;

        // ✅ This is the important part: do NOT rely on :last-child.
        // Apply break AFTER every invoice except the last -> prevents blank trailing page.
        const sheetStyle: React.CSSProperties = {
          breakAfter: isLast ? "auto" : "page",
          pageBreakAfter: isLast ? "auto" : "always",
        };

        return (
          <div key={inv.id} className="sheet" style={sheetStyle}>
            <div className="topRow">
              <div>
                <h2>{vendorName(inv.vendor)} Invoice</h2>

                <div className="leftMeta">
                  <div>
                    <b>Voucher #:</b> {voucherNum}
                  </div>
                  <div>
                    <b>Period:</b> {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}
                  </div>
                </div>
              </div>

              <div className="rightMeta">
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

            <div className="storeLine">
              Store: {sc} {inv.storeName}
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
    </div>
  );
}