// app/admin/invoices/print-batch/page.tsx
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { InvoiceStatus, Permission, Role, InvoiceVendor } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import AutoOpenPassportExport from "./AutoOpenPassportExport";

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
  const sn = String(storeNumber ?? "").trim();
  if (!sn) return "—";
  return `${sn}${vendor === "SUCCESS_PLUS" ? "SP" : "APLS"}`;
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

function vendorSortRank(vendor: InvoiceVendor) {
  return vendor === InvoiceVendor.AMERICAN_PLUS ? 0 : 1;
}

function locationSortValue(storeNumber: string) {
  const trimmed = String(storeNumber ?? "").trim();
  const asNumber = Number(trimmed);
  if (trimmed && Number.isFinite(asNumber)) {
    return asNumber.toString().padStart(6, "0");
  }
  return trimmed;
}

function corporationSortValue(corporationNumber: string | null | undefined) {
  const trimmed = String(corporationNumber ?? "").trim();
  const asNumber = Number(trimmed);
  if (trimmed && Number.isFinite(asNumber)) {
    return asNumber.toString().padStart(6, "0");
  }
  return trimmed ? `A-${trimmed}` : "Z-UNASSIGNED";
}

function compareInvoicesForPrint(
  left: { vendor: InvoiceVendor; storeNumber: string; storeName: string; createdAt: Date; store?: { corporationNumber: string | null } | null },
  right: { vendor: InvoiceVendor; storeNumber: string; storeName: string; createdAt: Date; store?: { corporationNumber: string | null } | null }
) {
  const vendorDiff = vendorSortRank(left.vendor) - vendorSortRank(right.vendor);
  if (vendorDiff !== 0) return vendorDiff;

  if (left.vendor === InvoiceVendor.SUCCESS_PLUS && right.vendor === InvoiceVendor.SUCCESS_PLUS) {
    const corpDiff = corporationSortValue(left.store?.corporationNumber).localeCompare(
      corporationSortValue(right.store?.corporationNumber)
    );
    if (corpDiff !== 0) return corpDiff;
  }

  const storeNumberDiff = locationSortValue(left.storeNumber).localeCompare(locationSortValue(right.storeNumber));
  if (storeNumberDiff !== 0) return storeNumberDiff;

  const storeNameDiff = left.storeName.localeCompare(right.storeName);
  if (storeNameDiff !== 0) return storeNameDiff;

  return left.createdAt.getTime() - right.createdAt.getTime();
}

export default async function PrintInvoiceBatchPage({ searchParams }: { searchParams: { ids?: string; autoExport?: string } }) {
  await requireInvoicesView();

  const ids = parseIds(searchParams.ids);
  const autoExport = String(searchParams.autoExport ?? "").trim() === "1";
  const exportUrl = ids.length > 0 ? `/admin/invoices/passport-export?ids=${encodeURIComponent(ids.join(","))}` : "";

  const invoices =
    ids.length > 0
      ? await prisma.invoice
          .findMany({
            where: { id: { in: ids } },
            include: {
              lines: { orderBy: { submittedAt: "asc" } },
              store: { select: { corporationNumber: true } },
            },
          })
          .then((rows) => rows.sort(compareInvoicesForPrint))
      : await prisma.invoice.findMany({
          where: { status: InvoiceStatus.DRAFT },
          orderBy: { createdAt: "asc" },
          take: 200,
          include: {
            lines: { orderBy: { submittedAt: "asc" } },
            store: { select: { corporationNumber: true } },
          },
        }).then((rows) => rows.sort(compareInvoicesForPrint));

  if (invoices.length === 0) {
    return (
      <main style={{ padding: 24 }}>
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
              </>
            )}
          </div>
        </div>
      </main>
    );
  }

  // Mark DRAFT invoices as ISSUED when opening this print page
  const now = new Date();
  await prisma.invoice.updateMany({
    where: { id: { in: invoices.map((i) => i.id) }, status: InvoiceStatus.DRAFT },
    data: { status: InvoiceStatus.ISSUED, issuedAt: now },
  });

  const templateStamp = "print-batch v2026-03-02i";

  // Screen styling (print overrides via CSS)
  const sheet: CSSProperties = {
    boxSizing: "border-box",
    background: "#fff",
    color: "#000",
    fontFamily: "Arial, sans-serif",
    padding: "16px 20px",
  };

  const topRow: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 16,
    flexWrap: "nowrap",
  };

  const title: CSSProperties = {
    fontSize: 34,
    fontWeight: 800,
    margin: 0,
  };

  // Meta container now supports left/right columns
  const metaRow: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    gap: 24,
    marginTop: 8,
    alignItems: "flex-start",
  };

  const metaColLeft: CSSProperties = {
    fontSize: 32,
    lineHeight: 1.4,
    minWidth: 0,
  };

  const metaColRight: CSSProperties = {
    fontSize: 32,
    lineHeight: 1.4,
    minWidth: 0,
    textAlign: "right",
    whiteSpace: "nowrap",
  };

  const storeLine: CSSProperties = {
    fontSize: 44,
    fontWeight: 900,
    margin: "14px 0 10px",
  };

  const tableStyle: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: "fixed",
  };

  const thBase: CSSProperties = {
    border: "1px solid #000",
    padding: "6px 8px",
    background: "#eee",
    fontWeight: 800,
    textAlign: "left",
    whiteSpace: "nowrap",
    fontSize: 14,
  };

  const tdBase: CSSProperties = {
    border: "1px solid #000",
    padding: "6px 8px",
    fontSize: 14,
    verticalAlign: "top",
  };

  const num: CSSProperties = { textAlign: "right", whiteSpace: "nowrap" };

  const totals: CSSProperties = {
    marginTop: 16,
    marginLeft: "auto",
    textAlign: "right",
    fontSize: 32,
    lineHeight: 1.4,
    fontWeight: 800,
  };

  return (
    <main>
      <AutoOpenPassportExport enabled={autoExport && !!exportUrl} exportUrl={exportUrl} />

      {/* Reliable auto-print */}
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
        @page { size: letter landscape; margin: 0.25in; }

        html, body {
          margin: 0;
          padding: 0;
        }

        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }

          body * {
            visibility: hidden !important;
          }

          #print-root,
          #print-root * {
            visibility: visible !important;
          }

          #print-root {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }

          .no-print {
            display: none !important;
          }

          .sheet {
            width: auto !important;
            max-width: none !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }

          .sheet + .sheet {
            break-before: page;
            page-break-before: always;
          }

          .sheetInner {
            zoom: 1;
          }

          table, tr, td, th { page-break-inside: avoid !important; break-inside: avoid !important; }
        }
      `}</style>

      <div className="no-print" style={{ padding: 10, fontSize: 12, opacity: 0.8, maxWidth: 1100, margin: "0 auto" }}>
        Printing <b>{invoices.length}</b> invoice(s). If the print dialog doesn’t open automatically, press <b>Ctrl+P</b>. • {templateStamp}
        {exportUrl ? (
          <>
            {" "}
            •{" "}
            <a href={exportUrl} style={{ textDecoration: "underline", color: "inherit", fontWeight: 700 }}>
              Download Passport Export CSV
            </a>
          </>
        ) : null}
      </div>

      <div id="print-root">
        {invoices.map((inv) => {
          const vendorNo = vendorNumberFor(inv.storeNumber, inv.vendor);
          const voucherNo = inv.vendorNumber || "N/A";

          return (
            <div key={inv.id} className="sheet" style={sheet}>
              <div className="sheetInner">
                <div style={topRow}>
                  <h2 style={title}>{vendorName(inv.vendor)} Invoice</h2>

                  <div style={{ fontSize: 28, fontWeight: 800, whiteSpace: "nowrap" }}>
                    Vendor # <b>{vendorNo}</b>
                  </div>
                </div>

                {/* ✅ Meta split: left + right */}
                <div style={metaRow}>
                  <div style={metaColLeft}>
                    <div>
                      <b>Voucher #:</b> {voucherNo}
                    </div>
                    <div>
                      <b>Period:</b> {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}
                    </div>
                  </div>

                  <div style={metaColRight}>
                    <div>
                      <b>Billed to:</b> {inv.billedTo}
                    </div>
                    <div>
                      <b>Date Invoiced:</b> {fmtDate(inv.invoiceDate)}
                    </div>
                  </div>
                </div>

                <div style={storeLine}>
                  Store: {inv.storeNumber} {inv.storeName}
                </div>

                <table style={tableStyle}>
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
                      <th style={thBase}>Date</th>
                      <th style={thBase}>SKU</th>
                      <th style={thBase}>Part #</th>
                      <th style={thBase}>Name</th>
                      <th style={{ ...thBase, ...num }}>Qty</th>
                      <th style={{ ...thBase, ...num }}>Unit</th>
                      <th style={{ ...thBase, ...num }}>Subtotal</th>
                      <th style={{ ...thBase, ...num }}>Tax</th>
                      <th style={{ ...thBase, ...num }}>Total</th>
                    </tr>
                  </thead>

                  <tbody>
                    {inv.lines.map((line) => (
                      <tr key={line.id}>
                        <td style={tdBase}>{fmtDate(line.submittedAt)}</td>
                        <td style={tdBase}>{line.sku}</td>
                        <td style={tdBase}>{line.partNumber ?? "—"}</td>
                        <td style={tdBase}>{line.name}</td>
                        <td style={{ ...tdBase, ...num }}>{line.quantity}</td>
                        <td style={{ ...tdBase, ...num }}>{money(line.unitPrice)}</td>
                        <td style={{ ...tdBase, ...num }}>{money(line.lineSubtotal)}</td>
                        <td style={{ ...tdBase, ...num }}>{money(line.lineTax)}</td>
                        <td style={{ ...tdBase, ...num }}>{money(line.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={totals}>
                  <div>Subtotal: {money(inv.subtotal)}</div>
                  <div>Tax: {money(inv.taxTotal)}</div>
                  <div style={{ fontWeight: 900 }}>Total: {money(inv.total)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}