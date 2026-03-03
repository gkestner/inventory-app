// app/admin/invoices/print-batch/page.tsx
import Script from "next/script";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { InvoiceStatus, Permission, Role } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

export const dynamic = "force-dynamic";

type AdminSession = {
  user?: { id?: string | null; email?: string | null; role?: Role | null } | null;
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

function vendorName(vendor: string) {
  return vendor === "SUCCESS_PLUS" ? "Success Plus" : "American Plus";
}

function computeVendorNumber(vendor: string, storeNumber: string) {
  const sn = String(storeNumber ?? "").trim();
  if (!sn) return "—";
  return vendor === "SUCCESS_PLUS" ? `${sn}SP` : `${sn}APLS`;
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

export default async function PrintInvoiceBatchPage({
  searchParams,
}: {
  searchParams: { ids?: string };
}) {
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
        <div>No invoices available to print.</div>
      </main>
    );
  }

  // Mark printed invoices as ISSUED (atomic batch update)
  const now = new Date();
  await prisma.invoice.updateMany({
    where: { id: { in: invoices.map((i) => i.id) }, status: InvoiceStatus.DRAFT },
    data: { status: InvoiceStatus.ISSUED, issuedAt: now },
  });

  return (
    <main>
      {/* Auto-print after layout */}
      <Script id="auto-print" strategy="afterInteractive">{`
        window.addEventListener('load', () => {
          // slight delay lets Chrome layout settle before print
          setTimeout(() => {
            try { window.print(); } catch(e) {}
          }, 120);
        });
      `}</Script>

      <style>{`
        /* ✅ True paper definition */
        @page {
          size: letter landscape;
          margin: 0; /* IMPORTANT: avoid browser’s unpredictable printable-area box */
        }

        html, body {
          margin: 0;
          padding: 0;
          background: #fff !important;
          color: #000 !important;
          font-family: Arial, sans-serif;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        @media print {
          body * { visibility: hidden !important; }
          .printArea, .printArea * { visibility: visible !important; }

          .printArea {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            background: #fff !important;
            color: #000 !important;
          }

          /* Force exactly 1 page per invoice */
          .sheet {
            break-after: page;
            page-break-after: always;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .sheet:last-of-type {
            break-after: auto;
            page-break-after: auto;
          }
        }

        /*
          ✅ Fixed to the real paper size.
          Letter landscape is 11in x 8.5in.
          We simulate NARROW MARGINS using padding inside the sheet.
        */
        .sheet {
          width: 11in;
          height: 8.5in;
          box-sizing: border-box;
          overflow: hidden;
          background: #fff;
          color: #000;
          /* narrow margins */
          padding: 0.25in;
          /* reserve a little extra top room so if Headers/Footers are ON,
             Chrome’s page number won’t collide as badly */
          padding-top: 0.32in;
        }

        .topRow {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 18px;
        }

        h2 {
          margin: 0;
          font-size: 46px;
          font-weight: 900;
          line-height: 1.05;
        }

        .topRight {
          font-size: 18px;
          font-weight: 900;
          white-space: nowrap;
        }

        .meta {
          font-size: 18px;
          line-height: 1.35;
          margin-top: 10px;
          font-weight: 700;
        }

        .storeLine {
          font-size: 56px;
          font-weight: 900;
          margin: 12px 0 10px;
          line-height: 1.05;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 6px;
          table-layout: fixed;
        }

        th, td {
          border: 2px solid #000;
          padding: 10px 10px;
          font-size: 18px;
          vertical-align: top;
        }

        th {
          background: #eee;
          font-weight: 900;
          text-align: left;
          white-space: nowrap;
        }

        /* Stable column widths => stable spacing */
        .colDate { width: 12%; }
        .colSku  { width: 8%; }
        .colPart { width: 10%; }
        .colName { width: 28%; }
        .colQty  { width: 6%; }
        .colUnit { width: 12%; }
        .colSub  { width: 12%; }
        .colTax  { width: 6%; }
        .colTot  { width: 6%; }

        td.nameCell {
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .totals {
          margin-top: 10px;
          text-align: right;
          font-size: 20px;
          font-weight: 900;
          line-height: 1.3;
        }
      `}</style>

      <div className="printArea">
        {invoices.map((inv) => {
          const vendorNumber = computeVendorNumber(inv.vendor, String(inv.storeNumber ?? ""));
          // Stored vendorNumber becomes Voucher #
          const voucherNumber = String(inv.vendorNumber ?? "").trim() || "—";

          return (
            <div key={inv.id} className="sheet">
              <div className="topRow">
                <h2>{vendorName(inv.vendor)} Invoice</h2>
                <div className="topRight">
                  Vendor # <b>{vendorNumber}</b>
                </div>
              </div>

              <div className="meta">
                <div>
                  <b>Voucher #:</b> {voucherNumber}
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

              <div className="storeLine">
                Store: {inv.storeNumber} {inv.storeName}
              </div>

              <table>
                <colgroup>
                  <col className="colDate" />
                  <col className="colSku" />
                  <col className="colPart" />
                  <col className="colName" />
                  <col className="colQty" />
                  <col className="colUnit" />
                  <col className="colSub" />
                  <col className="colTax" />
                  <col className="colTot" />
                </colgroup>
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
                  {inv.lines.map((line) => (
                    <tr key={line.id}>
                      <td>{fmtDate(line.submittedAt)}</td>
                      <td>{line.sku}</td>
                      <td>{line.partNumber ?? "—"}</td>
                      <td className="nameCell">{line.name}</td>
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
      </div>
    </main>
  );
}