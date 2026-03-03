// app/admin/invoices/print-batch/page.tsx
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { InvoiceStatus, Permission, Role, InvoiceVendor } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  // Matches existing invoices gating in your app
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

function vendorName(vendor: InvoiceVendor) {
  return vendor === "SUCCESS_PLUS" ? "Success Plus" : "American Plus";
}

function vendorNumberFor(storeNumber: string, vendor: InvoiceVendor) {
  // Success Plus = (location number + SP)
  // American Plus = (location number + APLS)
  return `${storeNumber}${vendor === "SUCCESS_PLUS" ? "SP" : "APLS"}`;
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

  // Support both "id1,id2" and "id1%2Cid2"
  const decoded = safeDecodeOnce(s0);

  return decoded
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 200);
}

export default async function PrintInvoiceBatchPage({ searchParams }: { searchParams: { ids?: string } }) {
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

  // Archive (mark ISSUED) immediately when this print page is opened (DRAFT -> ISSUED)
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

  // Helps you confirm the deployed print template is the one you expect.
  const templateStamp = "print-batch v2026-03-02a";

  return (
    <main>
      {/* Auto-print (more reliable than next/script in some print-preview flows) */}
      <script
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: `
(function () {
  if (window.__invoiceBatchPrintTried) return;
  window.__invoiceBatchPrintTried = true;
  setTimeout(function () {
    try { window.focus(); window.print(); } catch (e) {}
  }, 50);
})();`,
        }}
      />

      <style>{`
        /* Force landscape + narrow-ish margins */
        @page { size: letter landscape; margin: 0.25in; }

        @media print {
          header, nav, footer, aside { display: none !important; }
          body > :not(main) { display: none !important; }
          .no-print { display: none !important; }

          /* 1 page per invoice */
          .sheet { break-after: page; page-break-after: always; }
          .sheet:last-child { break-after: auto; page-break-after: auto; }
        }

        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 0;
          background: #fff;
          color: #000;
        }

        .no-print {
          padding: 10px 12px;
          border-bottom: 1px solid rgba(128,128,128,0.25);
          max-width: 1100px;
          margin: 0 auto;
          font-size: 12px;
          opacity: 0.8;
        }

        /* Printable area in landscape letter with 0.25in margins:
           height = 8.5 - 0.5 = 8.0in. Keep each invoice constrained to that.
        */
        .sheet {
          box-sizing: border-box;
          height: 8in;
          max-height: 8in;
          overflow: hidden;

          max-width: 10.5in; /* 11 - 0.5 */
          margin: 0 auto;

          padding: 0;
          display: flex;
          flex-direction: column;
        }

        .top {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: baseline;
          padding-top: 0.05in;
        }

        h2 {
          margin: 0;
          font-size: 34px;
          font-weight: 800;
        }

        .meta {
          font-size: 18px;
          line-height: 1.35;
        }

        .meta b { font-weight: 800; }

        .meta-grid {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          margin-top: 8px;
        }

        .meta-left { flex: 1; }
        .meta-right { text-align: right; min-width: 220px; }

        .store-line {
          font-size: 44px;
          font-weight: 900;
          margin-top: 12px;
          margin-bottom: 10px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
          table-layout: fixed; /* ensures columns stay aligned */
        }

        th, td {
          border: 1px solid #000;
          padding: 6px 8px;
          font-size: 18px;
          vertical-align: top;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        th {
          background: #eee;
          text-align: left;
          white-space: nowrap;
        }

        .num { text-align: right; white-space: nowrap; }
        .nowrap { white-space: nowrap; }

        /* Make the highlighted table section smaller (about half overall “presence” vs the huge store line) */
        .tableWrap {
          transform-origin: top left;
          transform: scale(0.85);
          width: calc(100% / 0.85);
        }

        .totals {
          margin-top: auto;
          margin-left: auto;
          text-align: right;
          font-size: 20px;
          line-height: 1.5;
          padding-top: 10px;
        }
        .totals .grand { font-weight: 900; }
      `}</style>

      <div className="no-print">
        Printing <b>{invoices.length}</b> invoice(s). These invoices were archived (marked <b>ISSUED</b>). If the dialog didn’t open automatically, press{" "}
        <b>Ctrl+P</b>. <span style={{ marginLeft: 8 }}>• {templateStamp}</span>
      </div>

      {invoices.map((inv) => {
        const vendorNo = vendorNumberFor(inv.storeNumber, inv.vendor);
        const voucherNo = inv.vendorNumber || "N/A"; // rename: vendorNumber is now treated as “Voucher #”

        return (
          <div key={inv.id} className="sheet">
            <div className="top">
              <h2>{vendorName(inv.vendor)} Invoice</h2>
              {/* Swap places: Vendor # on the right */}
              <div className="meta">
                <b>Vendor #:</b> {vendorNo}
              </div>
            </div>

            <div className="meta meta-grid">
              <div className="meta-left">
                {/* Swap places + rename */}
                <div>
                  <b>Voucher #:</b> {voucherNo}
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
              <div className="meta-right" />
            </div>

            <div className="store-line">
              Store: {inv.storeNumber} {inv.storeName}
            </div>

            <div className="tableWrap">
              <table>
                <colgroup>
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "22%" }} />
                  <col style={{ width: "6%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "10%" }} />
                </colgroup>

                <thead>
                  <tr>
                    <th className="nowrap">Date</th>
                    <th className="nowrap">SKU</th>
                    <th className="nowrap">Part #</th>
                    <th>Name</th>
                    <th className="num">Qty</th>
                    <th className="num">Unit</th>
                    <th className="num">Subtotal</th>
                    <th className="num">Tax</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>

                <tbody>
                  {inv.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="nowrap">{fmtDate(line.submittedAt)}</td>
                      <td className="nowrap">{line.sku}</td>
                      <td className="nowrap">{line.partNumber ?? "—"}</td>
                      <td>{line.name}</td>
                      <td className="num">{line.quantity}</td>
                      <td className="num">{money(line.unitPrice)}</td>
                      <td className="num">{money(line.lineSubtotal)}</td>
                      <td className="num">{money(line.lineTax)}</td>
                      <td className="num">{money(line.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="totals">
              <div>Subtotal: {money(inv.subtotal)}</div>
              <div>Tax: {money(inv.taxTotal)}</div>
              <div className="grand">Total: {money(inv.total)}</div>
            </div>
          </div>
        );
      })}
    </main>
  );
}