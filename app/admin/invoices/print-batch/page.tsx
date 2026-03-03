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

function vendorTitle(vendor: string) {
  return vendor === "SUCCESS_PLUS" ? "Success Plus" : "American Plus";
}

function vendorSuffix(vendor: string) {
  return vendor === "SUCCESS_PLUS" ? "SP" : "APLS";
}

function storeCode(storeNumber: string | number | null | undefined) {
  const raw = String(storeNumber ?? "").trim();
  if (!raw) return "00";
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n)) return String(n).padStart(2, "0");
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return "00";
  return digits.padStart(2, "0").slice(-2);
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
      <div style={{ padding: 16 }}>
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
                <br />
                Generate invoices first, then print.
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Mark DRAFT -> ISSUED when opened
  const now = new Date();
  await prisma.invoice.updateMany({
    where: { id: { in: invoices.map((i) => i.id) }, status: InvoiceStatus.DRAFT },
    data: { status: InvoiceStatus.ISSUED, issuedAt: now },
  });

  return (
    <>
      <div id="print-root">
        <Script id="auto-print-batch" strategy="afterInteractive">{`
(function () {
  if (window.__invoiceBatchPrintTried) return;
  window.__invoiceBatchPrintTried = true;
  setTimeout(function () {
    try { window.focus(); window.print(); } catch (e) {}
  }, 200);
})();
        `}</Script>

        <style>{`
          #print-root{
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            background: #fff;
            color: #000;
            overflow: auto;
          }

          /* Letter landscape + narrow margins */
          @page {
            size: Letter landscape;
            margin: 0.25in;
          }

          @media print {
            body * { visibility: hidden !important; }
            #print-root, #print-root * { visibility: visible !important; }

            #print-root{
              position: static !important;
              inset: auto !important;
              overflow: visible !important;
            }

            .no-print { display: none !important; }

            .invoicePage { break-after: page; page-break-after: always; }
            .invoicePage:last-child { break-after: auto; page-break-after: auto; }
          }

          .no-print{
            padding: 10px 12px;
            border-bottom: 1px solid rgba(0,0,0,0.15);
            font-size: 12px;
            opacity: 0.85;
          }

          /* IMPORTANT:
             We center the invoice within the printable area using flex. */
          .invoicePage{
            width: 10.5in;
            height: 8in;
            box-sizing: border-box;
            margin: 0 auto;

            display: flex;
            align-items: center;     /* vertical centering */
            justify-content: center; /* horizontal centering */

            overflow: hidden; /* prevents tiny overflow -> extra page */
          }

          /* The real invoice content box */
          .invoiceInner{
            width: 100%;
            height: 100%;
            box-sizing: border-box;

            /* inner padding to look better while still fitting */
            padding: 0.15in;

            display: flex;
            flex-direction: column;
          }

          .headerRow{
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 18px;
            align-items: start;
          }

          .title{
            margin: 0;
            font-family: Arial, sans-serif;
            font-weight: 800;
            font-size: 26px; /* bigger */
            line-height: 1.1;
          }

          .leftMeta{
            margin-top: 8px;
            font-size: 16px; /* bigger */
            line-height: 1.4;
            font-weight: 700;
            font-family: Arial, sans-serif;
          }

          .rightMeta{
            text-align: right;
            font-family: Arial, sans-serif;
          }

          .vendorBig{
            font-weight: 900;
            font-size: 52px; /* bigger */
            line-height: 1;
            white-space: nowrap; /* ALWAYS 1 line */
          }

          .rightMetaSmall{
            margin-top: 8px;
            font-size: 16px; /* bigger */
            line-height: 1.35;
            font-weight: 700;
          }

          .storeLine{
            margin-top: 14px;
            font-family: Arial, sans-serif;
            font-weight: 900;
            font-size: 44px; /* bigger */
            line-height: 1.05;
          }

          table{
            width: 100%;
            border-collapse: collapse;
            margin-top: 14px;
            table-layout: fixed;
            font-family: Arial, sans-serif;
          }

          th, td{
            border: 1px solid #000;
            padding: 8px 8px;   /* bigger */
            font-size: 14px;    /* bigger */
            vertical-align: top;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          th{
            background: #f2f2f2;
            font-weight: 900;
          }

          /* Column sizing */
          .colDate{ width: 13%; }
          .colSku{ width: 10%; }
          .colPart{ width: 11%; }
          .colName{ width: 26%; }
          .colQty{ width: 7%; text-align: right; }
          .colUnit{ width: 11%; text-align: right; }
          .colSub{ width: 11%; text-align: right; }
          .colTax{ width: 5.5%; text-align: right; }
          .colTotal{ width: 5.5%; text-align: right; }

          .totals{
            margin-top: auto;
            margin-left: auto;
            text-align: right;
            font-family: Arial, sans-serif;
            font-size: 18px;  /* bigger */
            line-height: 1.45;
            font-weight: 900;
            padding-top: 14px;
          }
          .totals .grand{ font-weight: 900; }
        `}</style>

        <div className="no-print">
          Printing <b>{invoices.length}</b> invoice(s). These invoices were archived (marked <b>ISSUED</b>).
          If the dialog didn’t open automatically, press <b>Ctrl+P</b>.
        </div>

        {invoices.map((inv) => {
          const vNum = `${storeCode(inv.storeNumber)}${vendorSuffix(inv.vendor)}`;
          const voucherNum = inv.id;

          return (
            <div key={inv.id} className="invoicePage">
              <div className="invoiceInner">
                <div className="headerRow">
                  <div>
                    <h1 className="title">{vendorTitle(inv.vendor)} Invoice</h1>
                    <div className="leftMeta">
                      <div>Voucher #: {voucherNum}</div>
                      <div>
                        Period: {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}
                      </div>
                    </div>
                  </div>

                  <div className="rightMeta">
                    <div className="vendorBig">Vendor # {vNum}</div>
                    <div className="rightMetaSmall">
                      <div>Billed to: {inv.billedTo}</div>
                      <div>Date Invoiced: {fmtDate(inv.invoiceDate)}</div>
                    </div>
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
                      <th className="colTotal">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="colDate">{fmtDate(line.submittedAt)}</td>
                        <td className="colSku">{line.sku}</td>
                        <td className="colPart">{line.partNumber ?? "—"}</td>
                        <td className="colName" style={{ whiteSpace: "normal" }}>
                          {line.name}
                        </td>
                        <td className="colQty">{line.quantity}</td>
                        <td className="colUnit">{money(line.unitPrice)}</td>
                        <td className="colSub">{money(line.lineSubtotal)}</td>
                        <td className="colTax">{money(line.lineTax)}</td>
                        <td className="colTotal">{money(line.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="totals">
                  <div>Subtotal: {money(inv.subtotal)}</div>
                  <div>Tax: {money(inv.taxTotal)}</div>
                  <div className="grand">Total: {money(inv.total)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}