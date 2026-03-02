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

function parseIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return decodeURIComponent(raw)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export default async function PrintInvoiceBatchPage({
  searchParams,
}: {
  searchParams: { ids?: string };
}) {
  await requireInvoicesView();

  const ids = parseIds(searchParams.ids);

  const invoices = await prisma.invoice.findMany({
    where: ids.length ? { id: { in: ids } } : { status: InvoiceStatus.DRAFT },
    include: { lines: { orderBy: { submittedAt: "asc" } } },
  });

  if (!invoices.length) {
    return <main style={{ padding: 24 }}>No invoices available.</main>;
  }

  const now = new Date();
  await prisma.invoice.updateMany({
    where: { id: { in: invoices.map((i) => i.id) }, status: InvoiceStatus.DRAFT },
    data: { status: InvoiceStatus.ISSUED, issuedAt: now },
  });

  return (
    <main>
      <Script id="auto-print" strategy="afterInteractive">{`
        function fitInvoice() {
          const sheets = document.querySelectorAll('.sheet');
          sheets.forEach(sheet => {
            const maxHeight = sheet.offsetHeight;
            const content = sheet.querySelector('.inner');
            if (!content) return;

            let scale = 1;
            while (content.scrollHeight > maxHeight && scale > 0.75) {
              scale -= 0.01;
              content.style.transform = "scale(" + scale + ")";
              content.style.transformOrigin = "top left";
            }
          });
        }

        window.addEventListener('load', () => {
          fitInvoice();
          setTimeout(() => window.print(), 100);
        });
      `}</Script>

      <style>{`
        /* LANDSCAPE + NARROW MARGINS */
        @page {
          size: landscape;
          margin: 0.25in;
        }

        body {
          margin: 0;
          font-family: Arial, sans-serif;
          background: #fff !important;
          color: #000 !important;
        }

        @media print {
          body * { visibility: hidden !important; }

          .printArea, .printArea * {
            visibility: visible !important;
          }

          .printArea {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }

          .sheet {
            page-break-after: always;
            break-after: page;
          }

          .sheet:last-child {
            page-break-after: auto;
          }
        }

        .sheet {
          width: 100%;
          height: 100vh;
          box-sizing: border-box;
          overflow: hidden;
          padding: 0.25in;
        }

        .inner {
          transform-origin: top left;
        }

        .topRow {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }

        h2 {
          font-size: 48px;
          margin: 0;
        }

        .topRight {
          font-size: 22px;
          font-weight: 700;
        }

        .meta {
          font-size: 22px;
          line-height: 1.4;
          margin-top: 10px;
        }

        .storeLine {
          font-size: 60px;
          font-weight: 900;
          margin: 18px 0 12px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
          table-layout: fixed;
        }

        th, td {
          border: 2px solid #000;
          padding: 10px;
          font-size: 22px;
        }

        th {
          background: #eee;
          font-weight: 800;
        }

        .totals {
          margin-top: 14px;
          text-align: right;
          font-size: 26px;
          font-weight: 900;
          line-height: 1.4;
        }
      `}</style>

      <div className="printArea">
        {invoices.map((inv) => {
          const vendorNumber = computeVendorNumber(inv.vendor, String(inv.storeNumber));
          const voucherNumber = inv.vendorNumber || "—";

          return (
            <div key={inv.id} className="sheet">
              <div className="inner">
                <div className="topRow">
                  <h2>{vendorName(inv.vendor)} Invoice</h2>
                  <div className="topRight">
                    Vendor # <b>{vendorNumber}</b>
                  </div>
                </div>

                <div className="meta">
                  <div><b>Voucher #:</b> {voucherNumber}</div>
                  <div><b>Billed to:</b> {inv.billedTo}</div>
                  <div><b>Date Invoiced:</b> {fmtDate(inv.invoiceDate)}</div>
                  <div><b>Period:</b> {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}</div>
                </div>

                <div className="storeLine">
                  Store: {inv.storeNumber} {inv.storeName}
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
                    {inv.lines.map((line) => (
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
            </div>
          );
        })}
      </div>
    </main>
  );
}