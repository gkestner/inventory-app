// app/admin/invoices/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { InvoiceVendor, Permission, PartsCheckoutStatus, Role } from "@prisma/client";

import { createInvoicesForWindow } from "./actions";

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
  if (perms.allowAll) return { session, perms };

  const ok = hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) redirect("/");

  return { session, perms };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseDateOnlyToDate(v: string, endOfDay = false): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const iso = endOfDay ? `${s}T23:59:59.999` : `${s}T00:00:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtForDateInput(d: Date): string {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtForDatetimeLocal(d: Date): string {
  return new Date(d).toISOString().slice(0, 16);
}

function fmtLocalDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

function vendorLabel(v: InvoiceVendor) {
  return v === "SUCCESS_PLUS" ? "Success Plus" : "American Plus";
}

type SearchParams = {
  vendor?: string;
  from?: string;
  to?: string;
  invoiceDate?: string;
  page?: string;
  perPage?: string;
  err?: string;
  cfg?: string;
};

function safeReturnToPathFromReferer(referer: string | null): string {
  if (!referer) return "/admin/invoices";
  try {
    const u = new URL(referer);
    const path = `${u.pathname}${u.search}`;
    return path.startsWith("/") ? path : "/admin/invoices";
  } catch {
    return "/admin/invoices";
  }
}

type CreateInvoicesResult = Awaited<ReturnType<typeof createInvoicesForWindow>>;

type VendorTaxSettings = {
  vendor: InvoiceVendor;
  taxRatePct: unknown;
  taxFormula: string;
};

const DEFAULT_TAX_FORMULA = "lineSubtotal * (taxRatePct / 100)";

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof (error as any).message === "string") {
    return String((error as any).message);
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function getPrismaErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error && typeof (error as any).code === "string") {
    return String((error as any).code);
  }
  return null;
}

function isMissingTaxFormulaFieldError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes("Unknown field `taxFormula`") || message.includes("taxFormula does not exist");
}

function isSchemaOrDbNotReadyError(error: unknown): boolean {
  const code = getPrismaErrorCode(error);
  if (code === "P2021" || code === "P2022") return true;

  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes("does not exist") ||
    msg.includes("unknown column") ||
    msg.includes("unknown field") ||
    msg.includes("invalid `prisma.") ||
    msg.includes("cannot read properties of undefined") ||
    msg.includes("is not a function")
  );
}

async function loadVendorTaxSettings(vendorConfigReady: boolean): Promise<VendorTaxSettings[]> {
  if (!vendorConfigReady) {
    return [
      { vendor: InvoiceVendor.SUCCESS_PLUS, taxRatePct: 0, taxFormula: DEFAULT_TAX_FORMULA },
      { vendor: InvoiceVendor.AMERICAN_PLUS, taxRatePct: 0, taxFormula: DEFAULT_TAX_FORMULA },
    ];
  }

  try {
    const rows = await prisma.invoiceVendorConfig.findMany({
      select: { vendor: true, taxFormula: true, taxRatePct: true },
    });

    const byVendor = new Map<InvoiceVendor, VendorTaxSettings>();
    for (const r of rows) {
      byVendor.set(r.vendor, {
        vendor: r.vendor,
        taxRatePct: r.taxRatePct,
        taxFormula: String((r as any).taxFormula || DEFAULT_TAX_FORMULA),
      });
    }

    if (!byVendor.has(InvoiceVendor.SUCCESS_PLUS)) {
      byVendor.set(InvoiceVendor.SUCCESS_PLUS, { vendor: InvoiceVendor.SUCCESS_PLUS, taxRatePct: 0, taxFormula: DEFAULT_TAX_FORMULA });
    }
    if (!byVendor.has(InvoiceVendor.AMERICAN_PLUS)) {
      byVendor.set(InvoiceVendor.AMERICAN_PLUS, { vendor: InvoiceVendor.AMERICAN_PLUS, taxRatePct: 0, taxFormula: DEFAULT_TAX_FORMULA });
    }

    return [byVendor.get(InvoiceVendor.SUCCESS_PLUS)!, byVendor.get(InvoiceVendor.AMERICAN_PLUS)!];
  } catch (error) {
    if (isMissingTaxFormulaFieldError(error)) {
      const rows = await prisma.invoiceVendorConfig.findMany({
        select: { vendor: true, taxRatePct: true },
      });

      const byVendor = new Map<InvoiceVendor, VendorTaxSettings>();
      for (const r of rows) {
        byVendor.set(r.vendor, { vendor: r.vendor, taxRatePct: r.taxRatePct, taxFormula: DEFAULT_TAX_FORMULA });
      }

      if (!byVendor.has(InvoiceVendor.SUCCESS_PLUS)) {
        byVendor.set(InvoiceVendor.SUCCESS_PLUS, { vendor: InvoiceVendor.SUCCESS_PLUS, taxRatePct: 0, taxFormula: DEFAULT_TAX_FORMULA });
      }
      if (!byVendor.has(InvoiceVendor.AMERICAN_PLUS)) {
        byVendor.set(InvoiceVendor.AMERICAN_PLUS, { vendor: InvoiceVendor.AMERICAN_PLUS, taxRatePct: 0, taxFormula: DEFAULT_TAX_FORMULA });
      }

      return [byVendor.get(InvoiceVendor.SUCCESS_PLUS)!, byVendor.get(InvoiceVendor.AMERICAN_PLUS)!];
    }

    throw error;
  }
}

async function saveVendorTaxSettings(vendorConfigReady: boolean, vendor: InvoiceVendor, taxRate: number, formula: string) {
  if (!vendorConfigReady) return;

  try {
    await prisma.invoiceVendorConfig.upsert({
      where: { vendor },
      create: {
        vendor,
        partsUpchargePct: 0,
        taxRatePct: taxRate,
        taxFormula: formula,
      },
      update: {
        taxRatePct: taxRate,
        taxFormula: formula,
      },
    });
  } catch (error) {
    if (!isMissingTaxFormulaFieldError(error)) throw error;

    await prisma.invoiceVendorConfig.upsert({
      where: { vendor },
      create: {
        vendor,
        partsUpchargePct: 0,
        taxRatePct: taxRate,
      },
      update: {
        taxRatePct: taxRate,
      },
    });
  }
}

function NotReadyPanel({ title, details }: { title: string; details: string[] }) {
  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1400, margin: "0 auto", color: "var(--foreground)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Admin: Invoices</h1>
          <Link
            href="/admin/items"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(128,128,128,0.25)",
              background: "var(--background)",
              color: "var(--foreground)",
              textDecoration: "none",
              fontWeight: 900,
            }}
          >
            ← Items
          </Link>
        </div>

        <div
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: 14,
            border: "1px solid rgba(128,128,128,0.25)",
            background: "var(--background)",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 6 }}>{title}</div>
          <ul style={{ margin: 0, paddingLeft: 18, opacity: 0.9, lineHeight: 1.5 }}>
            {details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}

export default async function AdminInvoicesPage({ searchParams }: { searchParams?: SearchParams }) {
  await requireInvoicesView();

  const sp: SearchParams = searchParams ?? {};

  const pAny = prisma as any;
  const invoiceModelReady = typeof pAny.invoice?.findMany === "function" && typeof pAny.invoice?.count === "function";
  const invoiceLineReady = typeof pAny.invoiceLine?.deleteMany === "function";
  const ticketModelReady = typeof pAny.partsCheckoutTicket?.groupBy === "function";
  const vendorConfigReady = typeof pAny.invoiceVendorConfig?.findMany === "function" && typeof pAny.invoiceVendorConfig?.upsert === "function";

  if (!invoiceModelReady || !invoiceLineReady) {
    return (
      <NotReadyPanel
        title="Not ready yet"
        details={[
          "This deployment’s Prisma Client does not include invoice models.",
          "Fix: run migrations + prisma generate, then redeploy.",
        ]}
      />
    );
  }

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";

  const controlLabel: CSSProperties = { display: "grid", gap: 6, fontSize: 12, opacity: 0.9, fontWeight: 900 };
  const controlBase: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 12,
    border,
    background: surface,
    color: fg,
    outline: "none",
    fontSize: 14,
    minWidth: 0,
  };
  const btn: CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border,
    background: surface,
    color: fg,
    fontWeight: 900,
    cursor: "pointer",
    lineHeight: 1,
    whiteSpace: "nowrap",
  };
  const btnPrimary: CSSProperties = {
    ...btn,
    background: "rgba(33,150,243,0.18)",
    border: "1px solid rgba(33,150,243,0.55)",
  };
  const btnDanger: CSSProperties = {
    ...btn,
    background: "rgba(244,67,54,0.14)",
    border: "1px solid rgba(244,67,54,0.55)",
  };

  const today = new Date();
  const defaultTo = fmtForDateInput(today);
  const defaultFromDate = new Date(today);
  defaultFromDate.setDate(defaultFromDate.getDate() - 6);
  const defaultFrom = fmtForDateInput(defaultFromDate);

  const vendorRaw = String(sp.vendor ?? "SUCCESS_PLUS").trim().toUpperCase();
  const vendor: InvoiceVendor = vendorRaw === "AMERICAN_PLUS" ? "AMERICAN_PLUS" : "SUCCESS_PLUS";

  const fromStr = String(sp.from ?? defaultFrom).trim();
  const toStr = String(sp.to ?? defaultTo).trim();

  const from = parseDateOnlyToDate(fromStr, false) ?? parseDateOnlyToDate(defaultFrom, false)!;
  const to = parseDateOnlyToDate(toStr, true) ?? parseDateOnlyToDate(defaultTo, true)!;

  const invoiceDateRaw = String(sp.invoiceDate ?? "").trim();
  const invoiceDate = invoiceDateRaw ? new Date(invoiceDateRaw) : new Date();
  const invoiceDateSafe = Number.isNaN(invoiceDate.getTime()) ? new Date() : invoiceDate;

  const page = clamp(Number(sp.page ?? "1") || 1, 1, 9999);
  const perPageAllowed = new Set([10, 25, 50]);
  const perPage = perPageAllowed.has(Number(sp.perPage)) ? Number(sp.perPage) : 25;
  const skip = (page - 1) * perPage;

  const err = String(sp.err ?? "").trim();
  const cfg = String(sp.cfg ?? "").trim();

  let readyByStore: Array<{ storeId: string; storeName: string; _count: { _all: number } }> = [];
  let readyTotal = 0;

  if (ticketModelReady) {
    try {
      readyByStore = (await (prisma as any).partsCheckoutTicket.groupBy({
        by: ["storeId", "storeName"],
        where: {
          status: PartsCheckoutStatus.OPEN,
          invoicedAt: null,
          voidedAt: null,
          createdAt: { gte: from, lte: to },
        },
        _count: { _all: true },
        orderBy: [{ storeName: "asc" }],
      })) as Array<{ storeId: string; storeName: string; _count: { _all: number } }>;

      readyTotal = readyByStore.reduce((acc, r) => acc + r._count._all, 0);
    } catch (e) {
      if (!isSchemaOrDbNotReadyError(e)) throw e;
      readyByStore = [];
      readyTotal = 0;
    }
  }

  let vendorConfigs: VendorTaxSettings[] = [
    { vendor: InvoiceVendor.SUCCESS_PLUS, taxRatePct: 0, taxFormula: DEFAULT_TAX_FORMULA },
    { vendor: InvoiceVendor.AMERICAN_PLUS, taxRatePct: 0, taxFormula: DEFAULT_TAX_FORMULA },
  ];

  try {
    vendorConfigs = await loadVendorTaxSettings(vendorConfigReady);
  } catch (e) {
    if (!isSchemaOrDbNotReadyError(e)) throw e;
  }

  const taxFormulaByVendor = new Map(vendorConfigs.map((c) => [c.vendor, c.taxFormula]));
  const taxRateByVendor = new Map(vendorConfigs.map((c) => [c.vendor, c.taxRatePct]));

  let invoiceTotal = 0;
  let invoices: Array<{
    id: string;
    vendor: InvoiceVendor;
    vendorNumber: string | null;
    billedTo: string | null;
    storeName: string;
    storeNumber: string;
    invoiceDate: Date | null;
    periodStart: Date;
    periodEnd: Date;
    status: string;
    total: any;
    createdAt: Date;
    _count: { lines: number };
  }> = [];

  try {
    const [count, rows] = await Promise.all([
      prisma.invoice.count(),
      prisma.invoice.findMany({
        orderBy: { createdAt: "desc" },
        take: perPage,
        skip,
        select: {
          id: true,
          vendor: true,
          vendorNumber: true,
          billedTo: true,
          storeName: true,
          storeNumber: true,
          invoiceDate: true,
          periodStart: true,
          periodEnd: true,
          status: true,
          total: true,
          createdAt: true,
          _count: { select: { lines: true } },
        },
      }),
    ]);

    invoiceTotal = count;
    invoices = rows as any;
  } catch (e) {
    if (isSchemaOrDbNotReadyError(e)) {
      return (
        <NotReadyPanel
          title="Invoices tables not ready in the database"
          details={[
            "This deployment can compile, but Neon is missing one or more invoice tables/columns (migrations not applied).",
            "Fix: run `npx prisma migrate deploy` against Neon (or apply the SQL), then redeploy.",
            "If you recently added invoice models/fields, also run `npx prisma generate` before deploying.",
          ]}
        />
      );
    }
    throw e;
  }

  const pageCount = Math.max(1, Math.ceil(invoiceTotal / perPage));

  function buildHref(patch: Partial<SearchParams>) {
    const merged: SearchParams = { ...sp, ...patch };

    const qp = new URLSearchParams();
    const keys: Array<keyof SearchParams> = ["vendor", "from", "to", "invoiceDate", "page", "perPage", "err", "cfg"];

    for (const k of keys) {
      const v = merged[k];
      if (typeof v !== "string") continue;
      const s = v.trim();
      if (!s) continue;
      qp.set(k, s);
    }

    const qs = qp.toString();
    return qs ? `/admin/invoices?${qs}` : "/admin/invoices";
  }

  async function generateInvoicesAction(formData: FormData) {
    "use server";
    await requireInvoicesView();

    const vendor =
      String(formData.get("vendor") ?? "SUCCESS_PLUS").trim().toUpperCase() === "AMERICAN_PLUS"
        ? ("AMERICAN_PLUS" as const)
        : ("SUCCESS_PLUS" as const);

    const fromStr = String(formData.get("from") ?? "").trim();
    const toStr = String(formData.get("to") ?? "").trim();
    const invoiceDateStr = String(formData.get("invoiceDate") ?? "").trim();

    const from = parseDateOnlyToDate(fromStr, false);
    const to = parseDateOnlyToDate(toStr, true);
    if (!from || !to) throw new Error("Missing from/to dates");

    const invoiceDate = invoiceDateStr ? new Date(invoiceDateStr) : new Date();
    if (Number.isNaN(invoiceDate.getTime())) throw new Error("Invalid invoice date");

    const res: CreateInvoicesResult = await createInvoicesForWindow({
      vendor: vendor === "AMERICAN_PLUS" ? InvoiceVendor.AMERICAN_PLUS : InvoiceVendor.SUCCESS_PLUS,
      periodStart: from,
      periodEnd: to,
      invoiceDate,
    });

    revalidatePath("/admin/invoices");

    const ids =
      res.results
        .map((r: any) => (typeof r?.invoiceId === "string" ? r.invoiceId : ""))
        .filter((x: string) => x.length > 0) ?? [];

    if (ids.length > 0) {
      redirect(`/admin/invoices/print-batch?ids=${encodeURIComponent(ids.join(","))}`);
    }

    const h = await headers();
    redirect(safeReturnToPathFromReferer(h.get("referer")));
  }

  async function updateVendorTaxFormulaAction(formData: FormData) {
    "use server";
    await requireInvoicesView();

    if (!vendorConfigReady) {
      redirect("/admin/invoices?cfg=config_not_ready");
    }

    const vendorRaw = String(formData.get("vendor") ?? "").trim().toUpperCase();
    const vendor = vendorRaw === "AMERICAN_PLUS" ? InvoiceVendor.AMERICAN_PLUS : InvoiceVendor.SUCCESS_PLUS;

    const formula = String(formData.get("taxFormula") ?? "").trim();
    if (!formula) {
      redirect("/admin/invoices?cfg=formula_required");
    }

    const taxRateRaw = String(formData.get("taxRatePct") ?? "").trim();
    const taxRate = Number(taxRateRaw);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      redirect("/admin/invoices?cfg=tax_rate_invalid");
    }

    await saveVendorTaxSettings(vendorConfigReady, vendor, taxRate, formula);

    revalidatePath("/admin/invoices");
    redirect("/admin/invoices?cfg=saved");
  }

  async function hardDeleteSelectedInvoicesAction(formData: FormData) {
    "use server";
    await requireInvoicesView();

    const buildReturnTo = (patch: Partial<SearchParams>) => {
      const get = (k: keyof SearchParams) => String(formData.get(k) ?? "").trim();

      const base: SearchParams = {
        vendor: get("vendor"),
        from: get("from"),
        to: get("to"),
        invoiceDate: get("invoiceDate"),
        page: get("page"),
        perPage: get("perPage"),
        err: get("err"),
        cfg: get("cfg"),
      };

      const merged: SearchParams = { ...base, ...patch };

      const qp = new URLSearchParams();
      const keys: Array<keyof SearchParams> = ["vendor", "from", "to", "invoiceDate", "page", "perPage", "err", "cfg"];
      for (const k of keys) {
        const v = merged[k];
        if (typeof v !== "string") continue;
        const s = v.trim();
        if (!s) continue;
        qp.set(k, s);
      }

      const qs = qp.toString();
      return qs ? `/admin/invoices?${qs}` : "/admin/invoices";
    };

    const returnToBase = buildReturnTo({ err: "" });

    const confirm = String(formData.get("confirm") ?? "").trim().toUpperCase();
    if (confirm !== "DELETE") {
      redirect(buildReturnTo({ err: "confirm" }));
    }

    const idsRaw = formData.getAll("ids");
    const ids = idsRaw
      .map((v) => String(v).trim())
      .filter((v) => v.length > 0)
      .slice(0, 200);

    if (ids.length === 0) {
      redirect(buildReturnTo({ err: "none_selected" }));
    }

    await prisma.$transaction(async (tx) => {
      await tx.invoiceLine.deleteMany({
        where: { invoiceId: { in: ids } },
      });

      await tx.invoice.deleteMany({
        where: { id: { in: ids } },
      });
    });

    revalidatePath("/admin/invoices");
    redirect(returnToBase);
  }

  const errBanner =
    err === "confirm"
      ? 'To hard delete: select invoices, type "DELETE", then click Hard delete selected.'
      : err === "none_selected"
        ? "Select at least one invoice to hard delete."
        : err
          ? "Action could not be completed."
          : null;

  const cfgBanner =
    cfg === "saved"
      ? "Tax settings saved. New invoices will use the updated settings for that vendor."
      : cfg === "formula_required"
        ? "Tax formula is required."
        : cfg === "tax_rate_invalid"
          ? "Tax rate must be a valid number between 0 and 100."
          : cfg === "config_not_ready"
            ? "Vendor tax settings are not available yet on this deployment (missing invoiceVendorConfig)."
            : null;

  const detailsSummaryStyle: CSSProperties = {
    cursor: "pointer",
    fontWeight: 900,
    padding: "10px 12px",
    borderRadius: 12,
    border,
    background: surface,
    userSelect: "none",
  };

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1400, margin: "0 auto", color: fg }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Admin: Invoices</h1>
          <Link
            href="/admin/items"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border,
              background: surface,
              color: fg,
              textDecoration: "none",
              fontWeight: 900,
            }}
          >
            ← Items
          </Link>
        </div>

        {errBanner ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 14,
              border: "1px solid rgba(244,67,54,0.55)",
              background: "rgba(244,67,54,0.12)",
              fontWeight: 900,
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div>{errBanner}</div>
            <Link
              href={buildHref({ err: "" })}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(128,128,128,0.25)",
                textDecoration: "none",
                color: fg,
                fontWeight: 900,
                background: surface,
              }}
            >
              Clear
            </Link>
          </div>
        ) : null}

        {cfgBanner ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 14,
              border: "1px solid rgba(33,150,243,0.55)",
              background: "rgba(33,150,243,0.12)",
              fontWeight: 900,
            }}
          >
            {cfgBanner}
          </div>
        ) : null}

        {/* Vendor tax formulas (collapsed per vendor) */}
        <div style={{ marginTop: 12, border, borderRadius: 14, background: surface, padding: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Vendor tax formulas</div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
            Formula variables: <code>lineSubtotal</code>, <code>taxRatePct</code>, <code>quantity</code>, <code>unitPrice</code>. Allowed
            helpers: <code>min</code>, <code>max</code>, <code>round</code>, <code>floor</code>, <code>ceil</code>, <code>abs</code>.
          </div>

          {!vendorConfigReady ? (
            <div style={{ fontSize: 12, opacity: 0.85, borderTop: border, paddingTop: 10 }}>
              Vendor config table not available on this deployment yet. Defaults are shown; saving is disabled.
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 10 }}>
            {[InvoiceVendor.SUCCESS_PLUS, InvoiceVendor.AMERICAN_PLUS].map((v) => (
              <details
                key={v}
                style={{
                  borderTop: border,
                  paddingTop: 10,
                }}
              >
                <summary style={detailsSummaryStyle}>
                  {vendorLabel(v)} — click to edit
                </summary>

                <form action={updateVendorTaxFormulaAction} style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  <input type="hidden" name="vendor" value={v} />

                  <label style={controlLabel}>
                    Tax rate (%)
                    <input
                      name="taxRatePct"
                      defaultValue={String(taxRateByVendor.get(v) ?? 0)}
                      style={controlBase}
                      inputMode="decimal"
                      placeholder="0"
                      disabled={!vendorConfigReady}
                    />
                  </label>

                  <label style={controlLabel}>
                    Tax formula
                    <input
                      name="taxFormula"
                      defaultValue={String(taxFormulaByVendor.get(v) ?? DEFAULT_TAX_FORMULA)}
                      style={controlBase}
                      placeholder={DEFAULT_TAX_FORMULA}
                      disabled={!vendorConfigReady}
                    />
                  </label>

                  <div>
                    <button type="submit" style={btnPrimary} disabled={!vendorConfigReady}>
                      Save
                    </button>
                  </div>
                </form>
              </details>
            ))}
          </div>
        </div>

        {/* Generate invoices */}
        <div style={{ marginTop: 12, border, borderRadius: 14, background: surface, padding: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Generate invoices</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Ready tickets in window: <b>{readyTotal}</b> • Vendor format: <b>{vendorLabel(vendor)}</b>
          </div>

          <div style={{ marginTop: 10, border, borderRadius: 14, padding: 12, background: surface }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Pending invoice generation (by store)</div>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
              Stores with OPEN tickets not yet invoiced in this window ({fromStr} → {toStr}).
            </div>

            {!ticketModelReady ? (
              <div style={{ fontSize: 12, opacity: 0.85 }}>
                Ticket summary is unavailable on this deployment yet (missing <code>partsCheckoutTicket.groupBy</code>).
              </div>
            ) : readyByStore.length === 0 ? (
              <div style={{ fontSize: 12, opacity: 0.8 }}>No pending tickets for invoice generation in this window.</div>
            ) : (
              <div style={{ overflowX: "auto", border, borderRadius: 14, background: surface }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Store", "Ready tickets"].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: "left",
                            padding: 10,
                            borderBottom: border,
                            fontSize: 12,
                            opacity: 0.85,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {readyByStore.map((r) => (
                      <tr key={r.storeId} style={{ borderBottom: border }}>
                        <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 900 }}>{r.storeName}</td>
                        <td style={{ padding: 10, whiteSpace: "nowrap" }}>{r._count._all}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            <form action={generateInvoicesAction} style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end", width: "100%", minWidth: 0 }}>
                <label style={{ ...controlLabel, flex: "0 1 220px", minWidth: 0 }}>
                  Vendor
                  <select name="vendor" defaultValue={vendor} style={controlBase}>
                    <option value="SUCCESS_PLUS">Success Plus</option>
                    <option value="AMERICAN_PLUS">American Plus</option>
                  </select>
                </label>

                <label style={{ ...controlLabel, flex: "0 1 180px", minWidth: 0 }}>
                  From (submitted)
                  <input type="date" name="from" defaultValue={fromStr} style={controlBase} />
                </label>

                <label style={{ ...controlLabel, flex: "0 1 180px", minWidth: 0 }}>
                  To (submitted)
                  <input type="date" name="to" defaultValue={toStr} style={controlBase} />
                </label>

                <label style={{ ...controlLabel, flex: "0 1 260px", minWidth: 0 }}>
                  Invoice date (admin preference)
                  <input type="datetime-local" name="invoiceDate" defaultValue={fmtForDatetimeLocal(invoiceDateSafe)} style={controlBase} />
                </label>

                <div style={{ flex: "1 1 220px", display: "flex", justifyContent: "flex-end" }}>
                  <button type="submit" style={btnPrimary} disabled={readyTotal === 0}>
                    Generate invoices for window
                  </button>
                </div>
              </div>

              <div style={{ fontSize: 12, opacity: 0.8 }}>
                Manual trigger. Submitted checkouts are immediately “ready” (OPEN, not invoiced). Generating creates{" "}
                <b>one invoice per store</b> in the window for the selected vendor, then marks those tickets <b>INVOICED</b>.
              </div>
            </form>
          </div>
        </div>

        {/* Recent invoices */}
        <div style={{ marginTop: 12, border, borderRadius: 14, background: surface, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
            <div style={{ fontWeight: 900 }}>Recent invoices</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Showing <b>{invoices.length}</b> of <b>{invoiceTotal}</b> • Page <b>{page}</b> / <b>{pageCount}</b>
            </div>
          </div>

          <form action={hardDeleteSelectedInvoicesAction}>
            <input type="hidden" name="vendor" value={vendor} />
            <input type="hidden" name="from" value={fromStr} />
            <input type="hidden" name="to" value={toStr} />
            <input type="hidden" name="invoiceDate" value={invoiceDateRaw || fmtForDatetimeLocal(invoiceDateSafe)} />
            <input type="hidden" name="page" value={String(page)} />
            <input type="hidden" name="perPage" value={String(perPage)} />
            <input type="hidden" name="err" value="" />

            <div style={{ marginTop: 10, overflowX: "auto", border, borderRadius: 14, background: surface }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Select", "Created", "Vendor", "Vendor #", "Store", "Invoice date", "Window", "Lines", "Total", "Status", "Print"].map(
                      (h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: "left",
                            padding: 10,
                            borderBottom: border,
                            fontSize: 12,
                            opacity: 0.85,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} style={{ borderBottom: border }}>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                        <input type="checkbox" name="ids" value={inv.id} />
                      </td>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>{fmtLocalDate(inv.createdAt)}</td>
                      <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 900 }}>{vendorLabel(inv.vendor)}</td>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>{inv.vendorNumber ?? "—"}</td>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                        <div style={{ fontWeight: 900 }}>
                          {inv.storeNumber} {inv.storeName}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>{inv.billedTo ?? "—"}</div>
                      </td>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>{fmtLocalDate(inv.invoiceDate)}</td>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                        {fmtLocalDate(inv.periodStart)} → {fmtLocalDate(inv.periodEnd)}
                      </td>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>{inv._count.lines}</td>
                      <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 900 }}>
                        {inv.total ? Number(inv.total).toLocaleString(undefined, { style: "currency", currency: "USD" }) : "—"}
                      </td>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>{inv.status}</td>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                        <Link href={`/admin/invoices/${inv.id}/print`} style={{ ...btn, textDecoration: "none", display: "inline-block" }}>
                          Print
                        </Link>
                      </td>
                    </tr>
                  ))}

                  {invoices.length === 0 ? (
                    <tr>
                      <td colSpan={11} style={{ padding: 14, opacity: 0.8 }}>
                        No invoices yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div
              style={{
                marginTop: 12,
                display: "flex",
                gap: 10,
                alignItems: "end",
                flexWrap: "wrap",
                borderTop: border,
                paddingTop: 12,
              }}
            >
              <label style={{ ...controlLabel, minWidth: 240 }}>
                Type DELETE to confirm hard delete
                <input name="confirm" placeholder="DELETE" style={{ ...controlBase, padding: "8px 10px", borderRadius: 10, fontSize: 13 }} />
              </label>

              <button type="submit" style={btnDanger}>
                Hard delete selected
              </button>

              <div style={{ fontSize: 12, opacity: 0.75, maxWidth: 700 }}>
                Hard delete permanently removes invoices and their line items.
              </div>
            </div>
          </form>

          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Link
              href={buildHref({ page: String(Math.max(1, page - 1)), err: "" })}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border,
                background: surface,
                color: fg,
                textDecoration: "none",
                fontWeight: 900,
                opacity: page <= 1 ? 0.5 : 0.95,
                pointerEvents: page <= 1 ? "none" : "auto",
              }}
              aria-disabled={page <= 1}
              tabIndex={page <= 1 ? -1 : 0}
            >
              Prev
            </Link>

            <div style={{ fontSize: 12, opacity: 0.85 }}>
              Page <b>{page}</b> of <b>{pageCount}</b>
            </div>

            <Link
              href={buildHref({ page: String(Math.min(pageCount, page + 1)), err: "" })}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border,
                background: surface,
                color: fg,
                textDecoration: "none",
                fontWeight: 900,
                opacity: page >= pageCount ? 0.5 : 0.95,
                pointerEvents: page >= pageCount ? "none" : "auto",
              }}
              aria-disabled={page >= pageCount}
              tabIndex={page >= pageCount ? -1 : 0}
            >
              Next
            </Link>

            <form action="/admin/invoices" method="get" style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "end" }}>
              <input type="hidden" name="vendor" value={vendor} />
              <input type="hidden" name="from" value={fromStr} />
              <input type="hidden" name="to" value={toStr} />
              <input type="hidden" name="invoiceDate" value={invoiceDateRaw || fmtForDatetimeLocal(invoiceDateSafe)} />
              <input type="hidden" name="page" value="1" />
              <input type="hidden" name="err" value="" />

              <label style={{ ...controlLabel, margin: 0, minWidth: 140 }}>
                Per page
                <select
                  name="perPage"
                  defaultValue={String(perPage)}
                  style={{ ...controlBase, padding: "8px 10px", borderRadius: 10, fontSize: 13 }}
                >
                  {[10, 25, 50].map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>

              <button type="submit" style={{ ...btn, padding: "9px 12px" }}>
                Apply
              </button>
            </form>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
          Printing: use the Print link. Hard delete: select invoices, type <b>DELETE</b>, then submit.
        </div>
      </div>
    </main>
  );
}