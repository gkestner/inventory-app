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
        setTimeout(() => {
          try { window.print(); } catch(e) {}
        }, 100);
      `}</Script>

      <style>{`
        /* Back to original stable print behavior */
        @page {
          size: landscape;
          margin: 0.5in;
        }

        body {
          margin: 0;
          font-family: Arial, sans-serif;
          background: #fff !important;
          color: #000 !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
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
          padding: 24px 32px;
          max-width: 1400px;
          margin: 0 auto;
          background: #fff;
          color: #000;
        }

        .topRow {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }

        h2 {
          font-size: 36px;
          margin: 0;
          font-weight: 800;
        }

        .topRight {
          font-size: 16px;
          font-weight: 800;
        }

        .meta {
          font-size: 18px;
          margin-top: 8px;
          line-height: 1.4;
        }

        .storeLine {
          font-size: 48px;
          font-weight: 900;
          margin: 18px 0 12px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
        }

        th, td {
          border: 1px solid #000;
          padding: 8px;
          font-size: 18px;
        }

        th {
          background: #eee;
          font-weight: 800;
        }

        .totals {
          margin-top: 16px;
          text-align: right;
          font-size: 20px;
          font-weight: 900;
        }
      `}</style>

      <div className="printArea">
        {invoices.map((inv) => {
          const vendorNumber = computeVendorNumber(inv.vendor, String(inv.storeNumber));
          const voucherNumber = inv.vendorNumber || "—";

          return (
            <div key={inv.id} className="sheet">
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
          );
        })}
      </div>
    </main>
  );
}