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
  if (vendor === "SUCCESS_PLUS") return `${sn}SP`;
  return `${sn}APLS`;
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
            // Preserve requested order
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

  // Archive (DRAFT -> ISSUED) when opened
  const now = new Date();
  await prisma.invoice.updateMany({
    where: { id: { in: invoices.map((i) => i.id) }, status: InvoiceStatus.DRAFT },
    data: { status: InvoiceStatus.ISSUED, issuedAt: now },
  });

  return (
    <main>
      <Script id="auto-print" strategy="afterInteractive">{`
        setTimeout(() => { try { window.print(); } catch(e) {} }, 100);
      `}</Script>

      <style>{`
        /* ✅ LANDSCAPE + fixed margins */
        @page {
          size: landscape;
          margin: 0.5in;
        }

        body {
          margin: 0;
          background: #fff !important;
          color: #000 !important;
          font-family: Arial, sans-serif;
        }

        /*
          ✅ Print isolation + EXACTLY 1 PAGE PER INVOICE
          With Letter landscape and 0.5in margins:
          printable area is 10.0in (W) x 7.5in (H)
        */
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

          .sheet {
            /* Force each invoice to occupy exactly one printed page */
            width: 10in !important;
            height: 7.5in !important;
            box-sizing: border-box !important;
            overflow: hidden !important;

            page-break-after: always !important;
            break-after: page !important;
          }
          .sheet:last-child {
            page-break-after: auto !important;
            break-after: auto !important;
          }
        }

        /*
          ✅ "As big as possible on 1 page"
          We keep it large but tuned to never spill beyond 7.5in height.
          If you later add more lines per invoice, we can auto-shrink via a scale,
          but for now this maximizes size while staying 1 page.
        */

        .sheet {
          /* For on-screen view; print overrides to 10in x 7.5in */
          padding: 0.35in 0.45in;
          box-sizing: border-box;
          background: #fff;
          color: #000;
        }

        .topRow {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 16px;
        }

        h2 {
          margin: 0;
          font-size: 44px; /* BIG, but safe */
          font-weight: 800;
        }

        .topRight {
          font-size: 18px;
          font-weight: 800;
          white-space: nowrap;
        }

        .meta {
          font-size: 20px;
          line-height: 1.35;
          margin-top: 10px;
        }

        .storeLine {
          font-size: 52px;
          font-weight: 900;
          margin: 14px 0 12px;
          line-height: 1.05;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 8px;
          table-layout: fixed;
        }

        th, td {
          border: 2px solid #000;
          padding: 10px 10px;
          font-size: 20px;
          vertical-align: top;
        }

        th {
          background: #eee;
          font-weight: 800;
          text-align: left;
          white-space: nowrap;
        }

        /* Let Name wrap so the table fits width without shrinking text */
        .colDate { width: 12%; }
        .colSku { width: 8%; }
        .colPart { width: 10%; }
        .colName { width: 26%; }
        .colQty { width: 6%; }
        .colUnit { width: 12%; }
        .colSub { width: 12%; }
        .colTax { width: 7%; }
        .colTot { width: 7%; }

        td.nameCell {
          white-space: normal;
          word-break: break-word;
        }

        .totals {
          margin-top: 12px;
          text-align: right;
          font-size: 22px;
          font-weight: 900;
          line-height: 1.35;
        }
      `}</style>

      <div className="printArea">
        {invoices.map((inv) => {
          const computedVendorNumber = computeVendorNumber(inv.vendor, String(inv.storeNumber ?? ""));
          const voucherNumber = (inv.vendorNumber ?? "").trim() || "—"; // reuse existing stored number, but label as Voucher #

          return (
            <div key={inv.id} className="sheet">
              <div className="topRow">
                <h2>{vendorName(inv.vendor)} Invoice</h2>

                {/* ✅ SWAPPED: top-right is Vendor # */}
                <div className="topRight">
                  Vendor # <b>{computedVendorNumber}</b>
                </div>
              </div>

              <div className="meta">
                {/* ✅ SWAPPED: meta now contains Voucher # */}
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
                <thead>
                  <tr>
                    <th className="colDate">Date</th>
                    <th className="colSku">SKU</th>
                    <th className="colPart">Part #</th>
                    <th className="colName">Name</th>
                    <th className="colQty">Qty</th>
                    <th className="colUnit">Unit</th>
                    <th className="colSub">Subtotal</th>
                    <th className="colTax">Tax</th>
                    <th className="colTot">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="colDate">{fmtDate(line.submittedAt)}</td>
                      <td className="colSku">{line.sku}</td>
                      <td className="colPart">{line.partNumber ?? "—"}</td>
                      <td className="colName nameCell">{line.name}</td>
                      <td className="colQty">{line.quantity}</td>
                      <td className="colUnit">{money(line.unitPrice)}</td>
                      <td className="colSub">{money(line.lineSubtotal)}</td>
                      <td className="colTax">{money(line.lineTax)}</td>
                      <td className="colTot">{money(line.lineTotal)}</td>
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