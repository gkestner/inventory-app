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
    const shell: CSSProperties = { padding: 16 };
    const card: CSSProperties = {
      padding: 16,
      maxWidth: 900,
      margin: "0 auto",
      borderRadius: 14,
      border: "1px solid rgba(128,128,128,0.25)",
      background: "var(--background)",
      color: "var(--foreground)",
    };

    return (
      <main style={shell}>
        <div style={card}>
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
(function () {
  if (window.__invoiceBatchPrintTried) return;
  window.__invoiceBatchPrintTried = true;
  setTimeout(function () {
    try { window.focus(); window.print(); } catch (e) {}
  }, 50);
})();
      `}</Script>

      <style>{`
        @page { margin: 0.5in; }

        /* Screen defaults (still force black-on-white for clarity) */
        html, body {
          background: #fff !important;
          color: #000 !important;
        }

        /*
          ✅ PRINT FIX:
          Do NOT use "body > :not(main)" — layout wrappers can make that hide everything.
          Instead: hide everything via visibility, then show only the print area.
        */
        @media print {
          /* Hide everything */
          body * {
            visibility: hidden !important;
          }

          /* Show ONLY the printable area */
          .printArea, .printArea * {
            visibility: visible !important;
          }

          /* Place printable area at top-left */
          .printArea {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            background: #fff !important;
            color: #000 !important;
          }

          /* Prevent accidental dark theme printing */
          html, body {
            background: #fff !important;
            color: #000 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .no-print { display: none !important; }

          .page { page-break-after: always; }
          .page:last-child { page-break-after: auto; }
        }

        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 0;
        }

        .no-print {
          padding: 10px 12px;
          border-bottom: 1px solid rgba(128,128,128,0.25);
          max-width: 1100px;
          margin: 0 auto;
          font-size: 12px;
          opacity: 0.8;
          color: #000;
          background: #fff;
        }

        .sheet {
          padding: 24px 32px;
          max-width: 1100px;
          margin: 0 auto;
          min-height: calc(100vh - 1in);
          display: flex;
          flex-direction: column;
          font-size: 22px;
          color: #000;
          background: #fff;
        }

        h2 {
          margin: 0;
          font-size: 36px;
        }

        .meta {
          font-size: 24px;
          line-height: 1.4;
        }

        .store-line {
          font-size: 48px;
          font-weight: 900;
          margin-top: 14px;
          margin-bottom: 10px;
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
          color: #000;
        }

        th {
          background: #eee;
          text-align: left;
          white-space: nowrap;
        }

        .totals {
          margin-top: auto;
          margin-left: auto;
          text-align: right;
          font-size: 24px;
          line-height: 1.5;
          padding-top: 16px;
          color: #000;
        }
      `}</style>

      <div className="no-print">
        Printing <b>{invoices.length}</b> invoice(s). These invoices were archived (marked <b>ISSUED</b>).
        If the dialog didn’t open automatically, press <b>Ctrl+P</b>.
      </div>

      {/* ✅ This wrapper is what we force-visible in @media print */}
      <div className="printArea">
        {invoices.map((inv, idx) => {
          const isLast = idx === invoices.length - 1;

          return (
            <div key={inv.id} className={isLast ? "sheet" : "sheet page"}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline" }}>
                <h2>{vendorName(inv.vendor)} Invoice</h2>
                <div className="meta">
                  Invoice <b>{inv.vendorNumber}</b>
                </div>
              </div>

              <div className="meta" style={{ marginTop: 8 }}>
                <div>
                  <b>Vendor #:</b> {inv.vendorNumber}
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

              <div className="store-line">
                Store: {inv.storeNumber} {inv.storeName}
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
                  {inv.lines.map((line) => (
                    <tr key={line.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(line.submittedAt)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{line.sku}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{line.partNumber ?? "—"}</td>
                      <td>{line.name}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{line.quantity}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{money(line.unitPrice)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{money(line.lineSubtotal)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{money(line.lineTax)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{money(line.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="totals">
                <div>Subtotal: {money(inv.subtotal)}</div>
                <div>Tax: {money(inv.taxTotal)}</div>
                <div style={{ fontWeight: 900 }}>Total: {money(inv.total)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}