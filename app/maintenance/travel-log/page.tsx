// app/admin/invoices/print-batch/page.tsx
import Script from "next/script";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { InvoiceStatus, Permission, Role } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import type { CSSProperties } from "react";

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
  try {
    return decodeURIComponent(raw)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  } catch {
    return raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
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

  // Mark as issued (atomic)
  const now = new Date();
  await prisma.invoice.updateMany({
    where: { id: { in: invoices.map((i) => i.id) }, status: InvoiceStatus.DRAFT },
    data: { status: InvoiceStatus.ISSUED, issuedAt: now },
  });

  // --- Inline styles (guaranteed to apply) ---
  const sheet: CSSProperties = {
    padding: "24px 32px",
    maxWidth: 1400,
    margin: "0 auto",
    background: "#fff",
    color: "#000",
    fontFamily: "Arial, sans-serif",
  };

  const topRow: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 12,
  };

  const h2Style: CSSProperties = { fontSize: 36, margin: 0, fontWeight: 800 };
  const topRight: CSSProperties = { fontSize: 16, fontWeight: 800, whiteSpace: "nowrap" };

  const meta: CSSProperties = { fontSize: 18, marginTop: 8, lineHeight: 1.4 };

  const storeLine: CSSProperties = {
    fontSize: 48,
    fontWeight: 900,
    margin: "18px 0 12px",
    lineHeight: 1.05,
  };

  // ✅ Table at 75% size relative to the rest
  const tableStyle: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    marginTop: 10,
    fontSize: "75%", // <- this is the 0.75 sizing
  };

  const thBase: CSSProperties = {
    border: "1px solid #000",
    padding: "6px 8px",
    background: "#eee",
    fontWeight: 800,
    textAlign: "left",
    whiteSpace: "nowrap",
  };

  const tdBase: CSSProperties = {
    border: "1px solid #000",
    padding: "6px 8px",
    verticalAlign: "top",
  };

  const numCell: CSSProperties = {
    textAlign: "right",
    whiteSpace: "nowrap",
  };

  const totals: CSSProperties = { marginTop: 16, textAlign: "right", fontSize: 20, fontWeight: 900 };

  return (
    <main>
      <Script id="auto-print" strategy="afterInteractive">{`
        setTimeout(() => { try { window.print(); } catch(e) {} }, 100);
      `}</Script>

      <style>{`
        @page { size: landscape; margin: 0.5in; }

        body {
          margin: 0;
          background: #fff !important;
          color: #000 !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        @media print {
          body * { visibility: hidden !important; }
          .printArea, .printArea * { visibility: visible !important; }

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
            break-after: auto;
          }
        }
      `}</style>

      <div className="printArea">
        {invoices.map((inv) => {
          const vendorNumber = computeVendorNumber(inv.vendor, String(inv.storeNumber));
          const voucherNumber = String(inv.vendorNumber ?? "").trim() || "—";

          return (
            <div key={inv.id} className="sheet" style={sheet}>
              <div style={topRow}>
                <h2 style={h2Style}>{vendorName(inv.vendor)} Invoice</h2>
                <div style={topRight}>
                  Vendor # <b>{vendorNumber}</b>
                </div>
              </div>

              <div style={meta}>
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

              <div style={storeLine}>
                Store: {inv.storeNumber} {inv.storeName}
              </div>

              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thBase}>Date</th>
                    <th style={thBase}>SKU</th>
                    <th style={thBase}>Part #</th>
                    <th style={thBase}>Name</th>
                    <th style={{ ...thBase, ...numCell }}>Qty</th>
                    <th style={{ ...thBase, ...numCell }}>Unit</th>
                    <th style={{ ...thBase, ...numCell }}>Subtotal</th>
                    <th style={{ ...thBase, ...numCell }}>Tax</th>
                    <th style={{ ...thBase, ...numCell }}>Total</th>
                  </tr>
                </thead>

                <tbody>
                  {inv.lines.map((line) => (
                    <tr key={line.id}>
                      <td style={tdBase}>{fmtDate(line.submittedAt)}</td>
                      <td style={tdBase}>{line.sku}</td>
                      <td style={tdBase}>{line.partNumber ?? "—"}</td>
                      <td style={tdBase}>{line.name}</td>
                      <td style={{ ...tdBase, ...numCell }}>{line.quantity}</td>
                      <td style={{ ...tdBase, ...numCell }}>{money(line.unitPrice)}</td>
                      <td style={{ ...tdBase, ...numCell }}>{money(line.lineSubtotal)}</td>
                      <td style={{ ...tdBase, ...numCell }}>{money(line.lineTax)}</td>
                      <td style={{ ...tdBase, ...numCell }}>{money(line.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={totals}>
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