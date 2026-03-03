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
  return new Date(d).toLocaleDateString();
}

function money(n: unknown) {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "$0.00";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function vendorSuffix(v: InvoiceVendor) {
  return v === "AMERICAN_PLUS" ? "APLS" : "SP";
}

function vendorName(v: InvoiceVendor) {
  return v === "AMERICAN_PLUS" ? "American Plus" : "Success Plus";
}

function storeCode(storeNumber: string | number | null | undefined) {
  if (!storeNumber) return "00";
  const digits = String(storeNumber).replace(/[^\d]/g, "");
  if (!digits) return "00";
  return String(Number(digits)).padStart(2, "0");
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
    Array.isArray(sp.ids) ? sp.ids.join(",") :
    typeof sp.ids === "string" ? sp.ids : "";

  const ids = idsRaw.split(",").map(s => s.trim()).filter(Boolean);

  if (!ids.length) {
    return <div style={{ padding: 20 }}>Missing invoice ids.</div>;
  }

  const invoices = await prisma.invoice.findMany({
    where: { id: { in: ids } },
    orderBy: { invoiceDate: "asc" },
    include: { lines: { orderBy: { submittedAt: "asc" } } },
  });

  if (!invoices.length) {
    return <div style={{ padding: 20 }}>No invoices found.</div>;
  }

  await prisma.invoice.updateMany({
    where: {
      id: { in: invoices.map(i => i.id) },
      status: InvoiceStatus.DRAFT,
    },
    data: {
      status: InvoiceStatus.ISSUED,
      issuedAt: new Date(),
    },
  });

  return (
    <>
      <Script id="auto-print" strategy="afterInteractive">
        {`setTimeout(() => window.print(), 100);`}
      </Script>

      <style>{`
        @page {
          size: letter landscape;
          margin: 0.25in;
        }

        html, body {
          margin: 0;
          padding: 0;
          font-family: Arial, sans-serif;
        }

        .sheet {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          page-break-after: always;
        }

        .sheet:last-child {
          page-break-after: auto;
        }

        .topRow {
          display: flex;
          justify-content: space-between;
        }

        h2 {
          margin: 0;
          font-size: 28px;
        }

        .leftMeta {
          margin-top: 6px;
          font-size: 16px;
        }

        .rightMeta {
          text-align: right;
        }

        .vendorLine {
          font-size: 32px;
          font-weight: 900;
          white-space: nowrap;
        }

        .storeLine {
          font-size: 40px;
          font-weight: 900;
          margin: 14px 0 10px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }

        th, td {
          border: 1px solid #000;
          padding: 6px;
          font-size: 14px;
        }

        th {
          background: #eee;
        }

        .totals {
          margin-top: 12px;
          text-align: right;
          font-size: 18px;
          font-weight: 700;
        }
      `}</style>

      {invoices.map((inv) => {
        const sc = storeCode(inv.storeNumber);
        const vendorNum = `${sc}${vendorSuffix(inv.vendor)}`;

        return (
          <div key={inv.id} className="sheet">
            <div className="topRow">
              <div>
                <h2>{vendorName(inv.vendor)} Invoice</h2>
                <div className="leftMeta">
                  <div><b>Voucher #:</b> {inv.id}</div>
                  <div><b>Period:</b> {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}</div>
                </div>
              </div>

              <div className="rightMeta">
                <div className="vendorLine">Vendor # {vendorNum}</div>
                <div><b>Billed to:</b> {inv.billedTo}</div>
                <div><b>Date Invoiced:</b> {fmtDate(inv.invoiceDate)}</div>
              </div>
            </div>

            <div className="storeLine">
              Store: {sc} {inv.storeName}
            </div>

            <table>
              <thead>
                <tr>
                  <th>Date</th>
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
                {inv.lines.map(line => (
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
              <div>Subtotal: {money(inv.subtotal)}</div>
              <div>Tax: {money(inv.taxTotal)}</div>
              <div>Total: {money(inv.total)}</div>
            </div>
          </div>
        );
      })}
    </>
  );
}