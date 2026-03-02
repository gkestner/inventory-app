// app/admin/invoices/print-batch/page.tsx
import type { CSSProperties } from "react";
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

function parseIds(raw: string | undefined): string[] {
  const s = decodeURIComponent(String(raw ?? "")).trim();
  if (!s) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
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
        setTimeout(() => window.print(), 100);
      `}</Script>

      <style>{`
        /* LANDSCAPE + fixed margins */
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

        /* Reliable print isolation */
        @media print {
          body * {
            visibility: hidden !important;
          }

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

        /* 2x SIZING STARTS HERE */

        .sheet {
          width: 100%;
          min-height: 100vh;
          padding: 40px 60px;
          box-sizing: border-box;
        }

        h2 {
          margin: 0;
          font-size: 64px;   /* 2x */
        }

        .meta {
          font-size: 36px;   /* 2x */
          line-height: 1.5;
          margin-top: 16px;
        }

        .store-line {
          font-size: 72px;   /* BIG header */
          font-weight: 900;
          margin: 30px 0;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 30px;
        }

        th, td {
          border: 2px solid #000;
          padding: 14px 16px;
          font-size: 32px;   /* 2x */
          white-space: nowrap;
        }

        th {
          background: #eee;
          font-weight: 700;
        }

        .totals {
          margin-top: 40px;
          text-align: right;
          font-size: 40px;   /* 2x */
          font-weight: 900;
          line-height: 1.6;
        }
      `}</style>

      <div className="printArea">
        {invoices.map((inv) => (
          <div key={inv.id} className="sheet">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h2>{vendorName(inv.vendor)} Invoice</h2>
              <div className="meta">
                Invoice <b>{inv.vendorNumber}</b>
              </div>
            </div>

            <div className="meta">
              <div><b>Vendor #:</b> {inv.vendorNumber}</div>
              <div><b>Billed to:</b> {inv.billedTo}</div>
              <div><b>Date Invoiced:</b> {fmtDate(inv.invoiceDate)}</div>
              <div><b>Period:</b> {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}</div>
            </div>

            <div className="store-line">
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
        ))}
      </div>
    </main>
  );
}