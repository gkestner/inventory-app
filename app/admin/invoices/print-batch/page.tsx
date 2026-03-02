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

function vendorName(vendor: string) {
  return vendor === "SUCCESS_PLUS" ? "Success Plus" : "American Plus";
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
    <main>
      <Script id="auto-print-batch" strategy="afterInteractive">{`
        setTimeout(function () {
          try { window.print(); } catch (e) {}
        }, 75);
      `}</Script>

      <style>{`
        /* ✅ FORCE LANDSCAPE */
        @page {
          size: landscape;
          margin: 0.5in;
        }

        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 0;
          background: #fff !important;
          color: #000 !important;
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
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            background: #fff !important;
            color: #000 !important;
          }

          .page {
            page-break-after: always;
          }

          .page:last-child {
            page-break-after: auto;
          }
        }

        .sheet {
          padding: 24px 32px;
          max-width: 1400px;
          margin: 0 auto;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          font-size: 18px;
          background: #fff;
          color: #000;
        }

        h2 {
          margin: 0;
          font-size: 32px;
        }

        .meta {
          font-size: 18px;
          line-height: 1.4;
        }

        .store-line {
          font-size: 36px;
          font-weight: 900;
          margin-top: 12px;
          margin-bottom: 12px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 12px;
        }

        th, td {
          border: 1px solid #000;
          padding: 6px;
          font-size: 16px;
          vertical-align: top;
        }

        th {
          background: #eee;
          text-align: left;
        }

        .totals {
          margin-top: auto;
          margin-left: auto;
          text-align: right;
          font-size: 18px;
          line-height: 1.5;
          padding-top: 16px;
          font-weight: 700;
        }
      `}</style>

      <div className="printArea">
        {invoices.map((inv, idx) => {
          const isLast = idx === invoices.length - 1;

          return (
            <div key={inv.id} className={isLast ? "sheet" : "sheet page"}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <h2>{vendorName(inv.vendor)} Invoice</h2>
                <div className="meta">
                  Invoice <b>{inv.vendorNumber}</b>
                </div>
              </div>

              <div className="meta" style={{ marginTop: 8 }}>
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
          );
        })}
      </div>
    </main>
  );
}