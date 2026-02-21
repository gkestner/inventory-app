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

export default async function PrintInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoiceId = normalizeInvoiceId(id);
  if (!invoiceId) return notFound();

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      lines: { orderBy: { submittedAt: "asc" } },
    },
  });

  if (!invoice) return notFound();

  return (
    <main>
      <style>{`
        @page { margin: 0.5in; }

        @media print {
          header, nav, footer, aside { display: none !important; }
          body > :not(main) { display: none !important; }
          .no-print { display: none !important; }

          .sheet {
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
          }
        }

        .sheet {
          padding: 24px 32px;
          font-family: Arial, sans-serif;
          max-width: 1100px;
          margin: 0 auto;
          min-height: calc(100vh - 1in);
          display: flex;
          flex-direction: column;
          font-size: 22px;
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

        .meta {
          font-size: 24px;
          line-height: 1.4;
        }

        /* 🔥 Now 2x instead of 3x */
        .store-large {
          font-size: 48px;   /* ~2x normal size */
          font-weight: 900;
          margin-top: 14px;
          margin-bottom: 10px;
        }

        .totals {
          margin-top: auto;
          margin-left: auto;
          text-align: right;
          font-size: 24px;
          line-height: 1.5;
          padding-top: 16px;
        }
      `}</style>

      <div className="sheet">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 36 }}>
            {invoice.vendor === "SUCCESS_PLUS"
              ? "Success Plus"
              : "American Plus"}{" "}
            Invoice
          </h2>
          <div className="meta">
            Invoice <b>{invoice.vendorNumber}</b>
          </div>
        </div>

        <div className="meta" style={{ marginTop: 8 }}>
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
            <b>Period:</b> {fmtDate(invoice.periodStart)} –{" "}
            {fmtDate(invoice.periodEnd)}
          </div>
        </div>

        <div className="store-large">
          Store: {invoice.storeNumber} {invoice.storeName}
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
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <td>{fmtDate(line.submittedAt)}</td>
                <td>{line.sku}</td>
                <td>{line.partNumber ?? "—"}</td>
                <td>{line.name}</td>
                <td>{line.quantity}</td>
                <td>{money(line.unitPrice)}</td>
                <td>{money(line.lineSubtotal)}</td>
                <td>{money(line.lineTax)}</td>
                <td>{money(line.lineTotal)}</td>
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
    </main>
  );
}
