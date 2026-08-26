import { InvoiceVendor, Permission } from "@prisma/client";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { loadVendorPricingAndTaxConfig } from "../actions";
import ManualInvoiceForm from "./ManualInvoiceForm";

export const dynamic = "force-dynamic";

async function requireInvoicesView() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS])) redirect("/");
}

function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default async function ManualInvoiceEntryPage({
  searchParams,
}: {
  searchParams?: Promise<{ created?: string }>;
}) {
  await requireInvoicesView();
  const params = (await searchParams) ?? {};
  const createdId = String(params.created ?? "").trim();

  const [locations, successInvoice, successPlusTax, americanPlusTax] = await Promise.all([
    prisma.location.findMany({
      where: { active: true },
      orderBy: [{ locationNumber: "asc" }, { name: "asc" }],
      select: { id: true, name: true, locationNumber: true },
    }),
    createdId
      ? prisma.invoice.findUnique({
          where: { id: createdId },
          select: { id: true, vendorNumber: true, total: true, storeName: true },
        })
      : Promise.resolve(null),
    loadVendorPricingAndTaxConfig(InvoiceVendor.SUCCESS_PLUS),
    loadVendorPricingAndTaxConfig(InvoiceVendor.AMERICAN_PLUS),
  ]);

  return (
    <main className="manual-invoice-page">
      <style>{`
        .manual-invoice-page { color: var(--foreground); max-width: 1400px; margin: 0 auto; }
        .manual-invoice-page-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
        .manual-invoice-page-header h1 { margin: 0; font-size: 26px; font-weight: 900; }
        .manual-invoice-page-header p { margin: 5px 0 0; color: var(--muted); font-size: 13px; }
        .manual-invoice-back, .manual-invoice-success a { padding: 10px 14px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); color: var(--foreground); text-decoration: none; font-weight: 900; }
        .manual-invoice-success { margin-bottom: 14px; padding: 14px; border-radius: 14px; border: 1px solid rgba(76,175,80,.55); background: rgba(76,175,80,.12); display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
        .manual-invoice-success strong { display: block; margin-bottom: 4px; }
        .manual-invoice-success-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .manual-invoice-form { display: grid; gap: 14px; }
        .manual-invoice-card { border: 1px solid var(--border); border-radius: 14px; background: var(--background); padding: 14px; }
        .manual-invoice-section-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; margin-bottom: 13px; }
        .manual-invoice-section-heading h2 { font-size: 16px; font-weight: 900; margin: 0; }
        .manual-invoice-section-heading p { font-size: 12px; color: var(--muted); margin: 5px 0 0; max-width: 850px; line-height: 1.45; }
        .manual-invoice-header-grid { display: grid; grid-template-columns: repeat(4, minmax(180px, 1fr)); gap: 12px; }
        .manual-invoice-form label { display: grid; gap: 6px; font-size: 12px; font-weight: 900; min-width: 0; }
        .manual-invoice-form label span { color: var(--muted); font-weight: 700; }
        .manual-invoice-form input, .manual-invoice-form select { width: 100%; box-sizing: border-box; min-width: 0; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); color: var(--foreground); outline: none; font: inherit; }
        .manual-invoice-form input:focus, .manual-invoice-form select:focus { border-color: color-mix(in srgb, var(--brand) 58%, var(--border)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 13%, transparent); }
        .manual-invoice-form input:disabled { opacity: .55; cursor: not-allowed; }
        .manual-invoice-lines { display: grid; gap: 12px; }
        .manual-invoice-line { border: 1px solid var(--border); border-radius: 13px; background: var(--surface); padding: 12px; }
        .manual-invoice-line-title { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; font-size: 13px; }
        .manual-invoice-line-grid { display: grid; grid-template-columns: minmax(260px, 2.5fr) minmax(82px, .6fr) minmax(110px, .9fr) minmax(155px, 1.15fr) minmax(120px, .9fr); gap: 10px; align-items: end; }
        .manual-invoice-description { grid-column: span 2; }
        .manual-invoice-line-actions { display: flex; align-items: end; height: 100%; }
        .manual-invoice-line-breakdown { display: flex; justify-content: flex-end; gap: 18px; flex-wrap: wrap; border-top: 1px solid var(--border); margin-top: 12px; padding-top: 10px; font-size: 12px; }
        .manual-invoice-line-breakdown > div { display: flex; gap: 8px; }
        .manual-invoice-line-breakdown span { color: var(--muted); }
        .manual-invoice-secondary, .manual-invoice-remove, .manual-invoice-primary { padding: 10px 14px; border-radius: 12px; border: 1px solid var(--border); color: var(--foreground); background: var(--surface); font-weight: 900; cursor: pointer; white-space: nowrap; }
        .manual-invoice-primary { background: color-mix(in srgb, var(--brand) 20%, var(--surface)); border-color: color-mix(in srgb, var(--brand) 60%, var(--border)); min-width: 220px; }
        .manual-invoice-remove { width: 100%; color: #d84343; border-color: rgba(216,67,67,.42); }
        .manual-invoice-secondary:disabled, .manual-invoice-remove:disabled, .manual-invoice-primary:disabled { opacity: .48; cursor: not-allowed; }
        .manual-invoice-add-bottom { margin-top: 12px; }
        .manual-invoice-submit-card { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; flex-wrap: wrap; }
        .manual-invoice-totals { display: grid; gap: 7px; min-width: min(100%, 340px); }
        .manual-invoice-totals > div { display: flex; justify-content: space-between; gap: 24px; }
        .manual-invoice-grand-total { border-top: 1px solid var(--border); margin-top: 2px; padding-top: 9px; font-size: 18px; }
        .manual-invoice-totals small { color: var(--muted); line-height: 1.4; max-width: 540px; }
        .manual-invoice-submit-actions { margin-left: auto; display: grid; justify-items: end; gap: 10px; }
        .manual-invoice-error { max-width: 620px; padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(244,67,54,.55); background: rgba(244,67,54,.12); color: var(--foreground); font-size: 13px; font-weight: 800; }
        @media (max-width: 1120px) { .manual-invoice-header-grid { grid-template-columns: repeat(2, minmax(180px, 1fr)); } .manual-invoice-line-grid { grid-template-columns: repeat(3, minmax(130px, 1fr)); } .manual-invoice-description { grid-column: span 2; } }
        @media (max-width: 680px) { .manual-invoice-header-grid, .manual-invoice-line-grid { grid-template-columns: 1fr; } .manual-invoice-description { grid-column: auto; } .manual-invoice-line-breakdown { justify-content: stretch; display: grid; } .manual-invoice-line-breakdown > div { justify-content: space-between; } .manual-invoice-submit-card { align-items: stretch; } .manual-invoice-submit-actions { margin-left: 0; justify-items: stretch; width: 100%; } .manual-invoice-primary { width: 100%; } }
      `}</style>

      <div className="manual-invoice-page-header">
        <div>
          <h1>Manual Invoice Entry</h1>
          <p>Create an invoice for services, fees, and items that are not in inventory.</p>
        </div>
        <Link href="/admin/invoices" className="manual-invoice-back">← Invoices</Link>
      </div>

      {successInvoice ? (
        <div className="manual-invoice-success">
          <div>
            <strong>Manual invoice added to pending generation.</strong>
            <span>{successInvoice.storeName} · {successInvoice.vendorNumber} · {Number(successInvoice.total).toLocaleString("en-US", { style: "currency", currency: "USD" })}</span>
          </div>
          <div className="manual-invoice-success-actions">
            <Link href="/admin/invoices">View pending list</Link>
            <Link href={`/admin/invoices/${successInvoice.id}/print`}>Review invoice</Link>
          </div>
        </div>
      ) : null}

      {locations.length > 0 ? (
        <ManualInvoiceForm
          locations={locations}
          vendorTaxRates={[
            { vendor: "SUCCESS_PLUS", taxRatePct: successPlusTax.taxRatePct },
            { vendor: "AMERICAN_PLUS", taxRatePct: americanPlusTax.taxRatePct },
          ]}
          today={dateInputValue(new Date())}
        />
      ) : (
        <div className="manual-invoice-card">No active billing locations are available. Add or activate a location before creating a manual invoice.</div>
      )}
    </main>
  );
}
