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

  const now = new Date();
  await prisma.invoice.updateMany({
    where: { id: { in: invoices.map((i) => i.id) }, status: InvoiceStatus.DRAFT },
    data: { status: InvoiceStatus.ISSUED, issuedAt: now },
  });

  return (
    <main>
      <Script id="fit-and-print" strategy="afterInteractive">{`
        function fitAll() {
          const pages = document.querySelectorAll('.sheet');
          pages.forEach((page) => {
            const inner = page.querySelector('.inner');
            if (!inner) return;

            // Reset any previous scaling first
            inner.style.transform = 'scale(1)';
            inner.style.transformOrigin = 'top left';

            // Measure available box (print page content box)
            const availW = page.clientWidth;
            const availH = page.clientHeight;

            // Measure natural content size
            // scrollWidth/scrollHeight reflect unscaled size (good).
            const contentW = inner.scrollWidth;
            const contentH = inner.scrollHeight;

            if (!contentW || !contentH) return;

            const scaleW = availW / contentW;
            const scaleH = availH / contentH;

            // "As big as possible" while fitting both dimensions.
            // Subtract a tiny epsilon to avoid rounding pushing to page 2.
            let scale = Math.min(1, scaleW, scaleH);
            scale = Math.max(0.5, scale - 0.01);

            inner.style.transform = 'scale(' + scale.toFixed(4) + ')';
          });
        }

        window.addEventListener('load', () => {
          fitAll();
          // Refit once more after fonts/layout settle
          setTimeout(() => {
            fitAll();
            setTimeout(() => { try { window.print(); } catch(e) {} }, 75);
          }, 75);
        });
      `}</Script>

      <style>{`
        /* ✅ Force Letter Landscape + NARROW margins */
        @page {
          size: letter landscape;
          margin: 0.25in; /* narrow */
        }

        body {
          margin: 0;
          font-family: Arial, sans-serif;
          background: #fff !important;
          color: #000 !important;
        }

        /* Print isolation */
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
        }

        /*
          ✅ Critical: Fix each invoice to the EXACT printable area:
          Letter landscape is 11in x 8.5in
          margins 0.25in each side => printable box is:
          width: 11 - 0.5 = 10.5in
          height: 8.5 - 0.5 = 8.0in
        */
        .sheet {
          width: 10.5in;
          height: 8in;
          box-sizing: border-box;
          overflow: hidden;
          page-break-after: always;
          break-after: page;
          background: #fff;
          color: #000;
        }
        .sheet:last-child {
          page-break-after: auto;
          break-after: auto;
        }

        /* Inner padding does NOT change .sheet's fixed size (box sizing keeps it contained) */
        .inner {
          box-sizing: border-box;
          padding: 0.22in 0.25in;
          transform-origin: top left;
        }

        .topRow {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 16px;
        }

        h2 {
          margin: 0;
          font-size: 44px;
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
          font-size: 54px;
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

        /* Keep column widths stable so spacing stays consistent */
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
          // Your stored number becomes the Voucher #
          const voucherNumber = String(inv.vendorNumber ?? "").trim() || "—";

          return (
            <div key={inv.id} className="sheet">
              <div className="inner">
                <div className="topRow">
                  <h2>{vendorName(inv.vendor)} Invoice</h2>

                  {/* ✅ Vendor # top-right */}
                  <div className="topRight">
                    Vendor # <b>{vendorNumber}</b>
                  </div>
                </div>

                {/* ✅ Voucher # in meta block */}
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
            </div>
          );
        })}
      </div>
    </main>
  );
}