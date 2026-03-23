// app/admin/invoices/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { InvoiceVendor, Permission, PartsCheckoutStatus, Role, Prisma } from "@prisma/client";
import InvoiceSelectionWiring from "./InvoiceSelectionWiring";

import { createInvoicesForWindow, refreshOpenTicketCostSnapshots } from "./actions";

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

function money(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function vendorLabel(v: InvoiceVendor) {
  return v === "SUCCESS_PLUS" ? "Success Plus" : "American Plus";
}

function normalizeInvoicePartyLabel(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function pendingVendorWhere(vendor: InvoiceVendor) {
  return vendor === InvoiceVendor.AMERICAN_PLUS ? { vendorSnapshot: InvoiceVendor.AMERICAN_PLUS } : {};
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
  refreshed?: string;
  undo?: string;
};

const LAST_INVOICE_BATCH_COOKIE = "last_generated_invoice_batch";

type LastInvoiceBatch = {
  ids: string[];
  createdAt: string;
};

type LastGeneratedInvoiceSummary = {
  id: string;
  vendor: InvoiceVendor;
  storeName: string;
  storeNumber: string;
  createdAt: Date;
  status: string;
  total: Prisma.Decimal | null;
};

function parseLastInvoiceBatchCookie(raw: string | undefined): LastInvoiceBatch | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { ids?: unknown; createdAt?: unknown };
    const ids = Array.isArray(parsed.ids)
      ? parsed.ids.map((value) => String(value).trim()).filter((value) => value.length > 0).slice(0, 200)
      : [];
    const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : "";

    if (ids.length === 0 || !createdAt) return null;
    return { ids, createdAt };
  } catch {
    return null;
  }
}

function isNextRedirectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

async function inferLastGeneratedBatch(args: { userId?: string | null }): Promise<{ ids: string[]; createdAt: string } | null> {
  const latest = await prisma.invoice.findFirst({
    where: args.userId ? { createdByUserId: args.userId } : undefined,
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, createdByUserId: true },
  });

  if (!latest) return null;

  const end = new Date(latest.createdAt.getTime() + 1_000);
  const start = new Date(latest.createdAt.getTime() - 10_000);

  const rows = await prisma.invoice.findMany({
    where: {
      createdAt: { gte: start, lte: end },
      createdByUserId: latest.createdByUserId ?? null,
    },
    orderBy: [{ createdAt: "asc" }, { storeNumber: "asc" }],
    select: { id: true, createdAt: true },
  });

  if (rows.length === 0) return null;

  return {
    ids: rows.map((row) => row.id),
    createdAt: rows[rows.length - 1].createdAt.toISOString(),
  };
}

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
  taxRatePct: number;
  taxFormula: string;

  // vendor-level parts pricing
  partsUpchargePct: number;
  partsPriceFormula: string;
};

const DEFAULT_TAX_FORMULA = "lineSubtotal * (taxRatePct / 100)";
const DEFAULT_PARTS_PRICE_FORMULA = "cost * (1 + (partsUpchargePct / 100))";

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error && typeof error.message === "string") return error.message;

  if (error && typeof error === "object") {
    const maybeMsg = (error as Record<string, unknown>).message;
    if (typeof maybeMsg === "string") return maybeMsg;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function getPrismaErrorCode(error: unknown): string | null {
  if (error && typeof error === "object") {
    const code = (error as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }
  return null;
}

function isMissingTaxFormulaFieldError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes("Unknown field `taxFormula`") || message.includes("taxFormula does not exist");
}

function isMissingPartsPriceFormulaFieldError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes("Unknown field `partsPriceFormula`") || message.includes("partsPriceFormula does not exist");
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

function toNumber(x: unknown, fallback: number): number {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string") {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  if (x && typeof x === "object") {
    // Prisma Decimal-like
    const maybeToString = (x as Record<string, unknown>).toString;
    if (typeof maybeToString === "function") {
      const s = String(maybeToString.call(x));
      const n = Number(s);
      if (Number.isFinite(n)) return n;
    }
    const maybeValueOf = (x as Record<string, unknown>).valueOf;
    if (typeof maybeValueOf === "function") {
      const v = maybeValueOf.call(x);
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return fallback;
}

type InvoiceVendorConfigDelegate = {
  findMany: (args: unknown) => Promise<unknown[]>;
  upsert: (args: unknown) => Promise<unknown>;
};

type PartsCheckoutTicketDelegate = {
  groupBy: (args: unknown) => Promise<unknown[]>;
};

type InvoiceDelegate = {
  findMany: (args: unknown) => Promise<unknown[]>;
  count: (args?: unknown) => Promise<number>;
};

type InvoiceLineDelegate = {
  deleteMany: (args: unknown) => Promise<unknown>;
};

type TxClient = Prisma.TransactionClient;

function getDelegates() {
  const p = prisma as unknown as Partial<{
    invoice: InvoiceDelegate;
    invoiceLine: InvoiceLineDelegate;
    partsCheckoutTicket: PartsCheckoutTicketDelegate;
    invoiceVendorConfig: InvoiceVendorConfigDelegate;
  }>;
  return p;
}

async function loadVendorTaxSettings(vendorConfigReady: boolean): Promise<VendorTaxSettings[]> {
  const defaults: VendorTaxSettings[] = [
    {
      vendor: InvoiceVendor.SUCCESS_PLUS,
      taxRatePct: 0,
      taxFormula: DEFAULT_TAX_FORMULA,
      partsUpchargePct: 0,
      partsPriceFormula: DEFAULT_PARTS_PRICE_FORMULA,
    },
    {
      vendor: InvoiceVendor.AMERICAN_PLUS,
      taxRatePct: 0,
      taxFormula: DEFAULT_TAX_FORMULA,
      partsUpchargePct: 0,
      partsPriceFormula: DEFAULT_PARTS_PRICE_FORMULA,
    },
  ];

  if (!vendorConfigReady) return defaults;

  const d = getDelegates();
  if (!d.invoiceVendorConfig) return defaults;

  try {
    // Attempt full schema (tax + parts pricing)
    const rows = await d.invoiceVendorConfig.findMany({
      select: {
        vendor: true,
        taxFormula: true,
        taxRatePct: true,
        partsUpchargePct: true,
        partsPriceFormula: true,
      },
    });

    const byVendor = new Map<InvoiceVendor, VendorTaxSettings>();
    for (const r of rows) {
      const rr = r as Record<string, unknown>;
      const vendor = rr.vendor === "AMERICAN_PLUS" ? InvoiceVendor.AMERICAN_PLUS : InvoiceVendor.SUCCESS_PLUS;

      byVendor.set(vendor, {
        vendor,
        taxRatePct: toNumber(rr.taxRatePct, 0),
        taxFormula: String(rr.taxFormula || DEFAULT_TAX_FORMULA),
        partsUpchargePct: toNumber(rr.partsUpchargePct, 0),
        partsPriceFormula: String(rr.partsPriceFormula || DEFAULT_PARTS_PRICE_FORMULA),
      });
    }

    if (!byVendor.has(InvoiceVendor.SUCCESS_PLUS)) byVendor.set(InvoiceVendor.SUCCESS_PLUS, defaults[0]);
    if (!byVendor.has(InvoiceVendor.AMERICAN_PLUS)) byVendor.set(InvoiceVendor.AMERICAN_PLUS, defaults[1]);

    return [byVendor.get(InvoiceVendor.SUCCESS_PLUS)!, byVendor.get(InvoiceVendor.AMERICAN_PLUS)!];
  } catch (error) {
    // If either new field doesn't exist yet, fall back gracefully
    if (isMissingTaxFormulaFieldError(error) || isMissingPartsPriceFormulaFieldError(error)) {
      const rows = await d.invoiceVendorConfig.findMany({
        select: { vendor: true, taxRatePct: true, partsUpchargePct: true },
      });

      const byVendor = new Map<InvoiceVendor, VendorTaxSettings>();
      for (const r of rows) {
        const rr = r as Record<string, unknown>;
        const vendor = rr.vendor === "AMERICAN_PLUS" ? InvoiceVendor.AMERICAN_PLUS : InvoiceVendor.SUCCESS_PLUS;

        byVendor.set(vendor, {
          vendor,
          taxRatePct: toNumber(rr.taxRatePct, 0),
          taxFormula: DEFAULT_TAX_FORMULA,
          partsUpchargePct: toNumber(rr.partsUpchargePct, 0),
          partsPriceFormula: DEFAULT_PARTS_PRICE_FORMULA,
        });
      }

      if (!byVendor.has(InvoiceVendor.SUCCESS_PLUS)) byVendor.set(InvoiceVendor.SUCCESS_PLUS, defaults[0]);
      if (!byVendor.has(InvoiceVendor.AMERICAN_PLUS)) byVendor.set(InvoiceVendor.AMERICAN_PLUS, defaults[1]);

      return [byVendor.get(InvoiceVendor.SUCCESS_PLUS)!, byVendor.get(InvoiceVendor.AMERICAN_PLUS)!];
    }

    throw error;
  }
}

async function saveVendorSettings(
  vendorConfigReady: boolean,
  vendor: InvoiceVendor,
  taxRate: number,
  taxFormula: string,
  partsUpchargePct: number,
  partsPriceFormula: string
) {
  if (!vendorConfigReady) return;

  const d = getDelegates();
  if (!d.invoiceVendorConfig) return;

  const taxF = taxFormula.trim() || DEFAULT_TAX_FORMULA;
  const priceF = partsPriceFormula.trim() || DEFAULT_PARTS_PRICE_FORMULA;

  try {
    await d.invoiceVendorConfig.upsert({
      where: { vendor },
      create: {
        vendor,
        partsUpchargePct,
        partsPriceFormula: priceF,
        taxRatePct: taxRate,
        taxFormula: taxF,
      },
      update: {
        partsUpchargePct,
        partsPriceFormula: priceF,
        taxRatePct: taxRate,
        taxFormula: taxF,
      },
    });
  } catch (error) {
    // If new formula fields aren't present yet, save what we can.
    if (isMissingTaxFormulaFieldError(error) || isMissingPartsPriceFormulaFieldError(error)) {
      await d.invoiceVendorConfig.upsert({
        where: { vendor },
        create: {
          vendor,
          partsUpchargePct,
          taxRatePct: taxRate,
        },
        update: {
          partsUpchargePct,
          taxRatePct: taxRate,
        },
      });
      return;
    }
    throw error;
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

type InvoiceRow = {
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
  total: Prisma.Decimal | null;
  createdAt: Date;
  _count: { lines: number };
};

export default async function AdminInvoicesPage({ searchParams }: { searchParams?: SearchParams }) {
  const { session } = await requireInvoicesView();

  const sp: SearchParams = searchParams ?? {};

  const d = getDelegates();
  const invoiceModelReady = typeof d.invoice?.findMany === "function" && typeof d.invoice?.count === "function";
  const invoiceLineReady = typeof d.invoiceLine?.deleteMany === "function";
  const ticketModelReady = typeof d.partsCheckoutTicket?.groupBy === "function";
  const vendorConfigReady =
    typeof d.invoiceVendorConfig?.findMany === "function" && typeof d.invoiceVendorConfig?.upsert === "function";

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

  const vendorRaw = String(sp.vendor ?? "SUCCESS_PLUS").trim().toUpperCase();
  const vendor: InvoiceVendor = vendorRaw === "AMERICAN_PLUS" ? "AMERICAN_PLUS" : "SUCCESS_PLUS";

  const fromStr = String(sp.from ?? "").trim();
  const toStr = String(sp.to ?? "").trim();

  const from = parseDateOnlyToDate(fromStr, false);
  const to = parseDateOnlyToDate(toStr, true);
  const hasDateFilter = !!from || !!to;

  const invoiceDateRaw = String(sp.invoiceDate ?? "").trim();
  const invoiceDate = invoiceDateRaw ? new Date(invoiceDateRaw) : new Date();
  const invoiceDateSafe = Number.isNaN(invoiceDate.getTime()) ? new Date() : invoiceDate;

  const page = clamp(Number(sp.page ?? "1") || 1, 1, 9999);
  const perPageAllowed = new Set([10, 25, 50]);
  const perPage = perPageAllowed.has(Number(sp.perPage)) ? Number(sp.perPage) : 25;
  const skip = (page - 1) * perPage;

  const err = String(sp.err ?? "").trim();
  const cfg = String(sp.cfg ?? "").trim();
  const refreshed = String(sp.refreshed ?? "").trim();
  const undo = String(sp.undo ?? "").trim();
  const cookieStore = await cookies();
  const cookieBatch = parseLastInvoiceBatchCookie(cookieStore.get(LAST_INVOICE_BATCH_COOKIE)?.value);
  let lastGeneratedBatch = cookieBatch;

  if (!lastGeneratedBatch) {
    lastGeneratedBatch = await inferLastGeneratedBatch({ userId: session?.user?.id ?? null });
  }

  let readyByStore: Array<{ storeId: string; storeName: string; _count: { _all: number } }> = [];
  let readyTotal = 0;
  let openTicketsBeforeWindowCount = 0;
  let oldestOpenTicketDate: Date | null = null;

  if (ticketModelReady && d.partsCheckoutTicket) {
    try {
      const [rows, olderOpenCount, olderOpenTicket] = await Promise.all([
        d.partsCheckoutTicket.groupBy({
          by: ["storeId", "storeName"],
          where: {
            status: PartsCheckoutStatus.OPEN,
            invoicedAt: null,
            voidedAt: null,
            ...pendingVendorWhere(vendor),
            ...(from || to
              ? {
                  createdAt: {
                    ...(from ? { gte: from } : {}),
                    ...(to ? { lte: to } : {}),
                  },
                }
              : {}),
          },
          _count: { _all: true },
          orderBy: [{ storeName: "asc" }],
        }),
        prisma.partsCheckoutTicket.count({
          where: {
            status: PartsCheckoutStatus.OPEN,
            invoicedAt: null,
            voidedAt: null,
            ...pendingVendorWhere(vendor),
            ...(from ? { createdAt: { lt: from } } : { id: { equals: "__none__" } }),
          },
        }),
        prisma.partsCheckoutTicket.findFirst({
          where: {
            status: PartsCheckoutStatus.OPEN,
            invoicedAt: null,
            voidedAt: null,
            ...pendingVendorWhere(vendor),
          },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        }),
      ]);

      readyByStore = (rows as Array<Record<string, unknown>>).map((r) => ({
        storeId: String(r.storeId ?? ""),
        storeName: String(r.storeName ?? ""),
        _count: { _all: toNumber((r._count as Record<string, unknown> | undefined)?._all, 0) },
      }));

      readyTotal = readyByStore.reduce((acc, r) => acc + r._count._all, 0);
      openTicketsBeforeWindowCount = from ? olderOpenCount : 0;
      oldestOpenTicketDate = olderOpenTicket?.createdAt ?? null;
    } catch (e) {
      if (!isSchemaOrDbNotReadyError(e)) throw e;
      readyByStore = [];
      readyTotal = 0;
      openTicketsBeforeWindowCount = 0;
      oldestOpenTicketDate = null;
    }
  }

  let vendorConfigs: VendorTaxSettings[] = [
    {
      vendor: InvoiceVendor.SUCCESS_PLUS,
      taxRatePct: 0,
      taxFormula: DEFAULT_TAX_FORMULA,
      partsUpchargePct: 0,
      partsPriceFormula: DEFAULT_PARTS_PRICE_FORMULA,
    },
    {
      vendor: InvoiceVendor.AMERICAN_PLUS,
      taxRatePct: 0,
      taxFormula: DEFAULT_TAX_FORMULA,
      partsUpchargePct: 0,
      partsPriceFormula: DEFAULT_PARTS_PRICE_FORMULA,
    },
  ];

  try {
    vendorConfigs = await loadVendorTaxSettings(vendorConfigReady);
  } catch (e) {
    if (!isSchemaOrDbNotReadyError(e)) throw e;
  }

  const taxFormulaByVendor = new Map(vendorConfigs.map((c) => [c.vendor, c.taxFormula]));
  const taxRateByVendor = new Map(vendorConfigs.map((c) => [c.vendor, c.taxRatePct]));
  const partsUpchargeByVendor = new Map(vendorConfigs.map((c) => [c.vendor, c.partsUpchargePct]));
  const partsPriceFormulaByVendor = new Map(vendorConfigs.map((c) => [c.vendor, c.partsPriceFormula]));

  let invoiceTotal = 0;
  let invoices: InvoiceRow[] = [];
  let lastGeneratedInvoices: LastGeneratedInvoiceSummary[] = [];

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
    invoices = rows as unknown as InvoiceRow[];

    if (lastGeneratedBatch) {
      const batchRows = await prisma.invoice.findMany({
        where: { id: { in: lastGeneratedBatch.ids } },
        select: {
          id: true,
          vendor: true,
          storeName: true,
          storeNumber: true,
          createdAt: true,
          status: true,
          total: true,
        },
      });

      const batchById = new Map(batchRows.map((row) => [row.id, row]));
      lastGeneratedInvoices = lastGeneratedBatch.ids
        .map((id) => batchById.get(id))
        .filter(Boolean) as LastGeneratedInvoiceSummary[];
    }
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
    const keys: Array<keyof SearchParams> = ["vendor", "from", "to", "invoiceDate", "page", "perPage", "err", "cfg", "refreshed", "undo"];

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

  async function refreshCostSnapshotsAction() {
    "use server";
    await requireInvoicesView();
    const result = await refreshOpenTicketCostSnapshots();
    revalidatePath("/admin/invoices");
    redirect(`/admin/invoices?refreshed=${result.updated}`);
  }

  async function generateInvoicesAction(formData: FormData) {
    "use server";
    await requireInvoicesView();

    const cookieStore = await cookies();

    const buildReturnTo = (message: string) => {
      const vendorParam = String(formData.get("vendor") ?? "SUCCESS_PLUS").trim().toUpperCase() === "AMERICAN_PLUS" ? "AMERICAN_PLUS" : "SUCCESS_PLUS";
      const fromParam = String(formData.get("from") ?? "").trim();
      const toParam = String(formData.get("to") ?? "").trim();
      const invoiceDateParam = String(formData.get("invoiceDate") ?? "").trim();
      const qp = new URLSearchParams();
      qp.set("vendor", vendorParam);
      if (fromParam) qp.set("from", fromParam);
      if (toParam) qp.set("to", toParam);
      if (invoiceDateParam) qp.set("invoiceDate", invoiceDateParam);
      if (message) qp.set("err", message);
      return `/admin/invoices?${qp.toString()}`;
    };

    const vendor =
      String(formData.get("vendor") ?? "SUCCESS_PLUS").trim().toUpperCase() === "AMERICAN_PLUS"
        ? ("AMERICAN_PLUS" as const)
        : ("SUCCESS_PLUS" as const);

    const fromStr = String(formData.get("from") ?? "").trim();
    const toStr = String(formData.get("to") ?? "").trim();
    const invoiceDateStr = String(formData.get("invoiceDate") ?? "").trim();

    const from = parseDateOnlyToDate(fromStr, false);
    const to = parseDateOnlyToDate(toStr, true);
    if (from && to && from > to) throw new Error("From date must be on or before To date");

    const invoiceDate = invoiceDateStr ? new Date(invoiceDateStr) : new Date();
    if (Number.isNaN(invoiceDate.getTime())) throw new Error("Invalid invoice date");

    try {
      const res: CreateInvoicesResult = await createInvoicesForWindow({
        vendor: vendor === "AMERICAN_PLUS" ? InvoiceVendor.AMERICAN_PLUS : InvoiceVendor.SUCCESS_PLUS,
        periodStart: from,
        periodEnd: to,
        invoiceDate,
        createdByUserId: session?.user?.id ?? null,
      });

      revalidatePath("/admin/invoices");

      const ids =
        (res as unknown as { results?: unknown[] } | null)?.results
          ?.map((r) => {
            const rr = r as Record<string, unknown>;
            return typeof rr.invoiceId === "string" ? rr.invoiceId : "";
          })
          .filter((x) => x.length > 0) ?? [];

      if (ids.length > 0) {
        cookieStore.set(LAST_INVOICE_BATCH_COOKIE, JSON.stringify({ ids, createdAt: new Date().toISOString() }), {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
        });
        redirect(`/admin/invoices/print-batch?ids=${encodeURIComponent(ids.join(","))}&autoExport=1`);
      }

      cookieStore.delete(LAST_INVOICE_BATCH_COOKIE);
      const h = await headers();
      redirect(safeReturnToPathFromReferer(h.get("referer")));
    } catch (error) {
      if (isNextRedirectError(error)) throw error;
      cookieStore.delete(LAST_INVOICE_BATCH_COOKIE);
      redirect(buildReturnTo(getErrorMessage(error)));
    }
  }

  async function undoLastGeneratedAction(formData: FormData) {
    "use server";
    await requireInvoicesView();

    const cookieStore = await cookies();
    const idsFromForm = String(formData.get("batchIds") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .slice(0, 200);

    const batch =
      idsFromForm.length > 0
        ? { ids: idsFromForm, createdAt: new Date().toISOString() }
        : parseLastInvoiceBatchCookie(cookieStore.get(LAST_INVOICE_BATCH_COOKIE)?.value);

    if (!batch || batch.ids.length === 0) {
      redirect("/admin/invoices?err=No recent generated invoice batch is available to undo.");
    }

    const ids = batch.ids;
    const existingInvoices = await prisma.invoice.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });

    if (existingInvoices.length === 0) {
      cookieStore.delete(LAST_INVOICE_BATCH_COOKIE);
      redirect("/admin/invoices?err=The last generated invoice batch no longer exists.");
    }

    await prisma.$transaction(async (tx: TxClient) => {
      await tx.partsCheckoutTicket.updateMany({
        where: { invoiceId: { in: ids } },
        data: {
          status: PartsCheckoutStatus.OPEN,
          invoiceId: null,
          invoicedAt: null,
        },
      });

      await tx.invoiceLine.deleteMany({
        where: { invoiceId: { in: ids } },
      });

      await tx.invoice.deleteMany({
        where: { id: { in: ids } },
      });
    });

    cookieStore.delete(LAST_INVOICE_BATCH_COOKIE);
    revalidatePath("/admin/invoices");
    redirect(`/admin/invoices?undo=${existingInvoices.length}`);
  }

  async function updateVendorPricingAndTaxAction(formData: FormData) {
    "use server";
    await requireInvoicesView();

    if (!vendorConfigReady) {
      redirect("/admin/invoices?cfg=config_not_ready");
    }

    const vendorRaw = String(formData.get("vendor") ?? "").trim().toUpperCase();
    const vendor = vendorRaw === "AMERICAN_PLUS" ? InvoiceVendor.AMERICAN_PLUS : InvoiceVendor.SUCCESS_PLUS;

    const taxFormula = String(formData.get("taxFormula") ?? "").trim();
    if (!taxFormula) redirect("/admin/invoices?cfg=formula_required");

    const taxRateRaw = String(formData.get("taxRatePct") ?? "").trim();
    const taxRate = Number(taxRateRaw);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 999.99) {
      redirect("/admin/invoices?cfg=tax_rate_invalid");
    }

    const partsUpchargeRaw = String(formData.get("partsUpchargePct") ?? "").trim();
    const partsUpchargePct = Number(partsUpchargeRaw || "0");
    if (!Number.isFinite(partsUpchargePct) || partsUpchargePct < 0 || partsUpchargePct > 9999) {
      redirect("/admin/invoices?cfg=parts_upcharge_invalid");
    }

    const partsPriceFormula = String(formData.get("partsPriceFormula") ?? "").trim();

    await saveVendorSettings(
      vendorConfigReady,
      vendor,
      taxRate,
      taxFormula,
      partsUpchargePct,
      partsPriceFormula || DEFAULT_PARTS_PRICE_FORMULA
    );

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
      const keys: Array<keyof SearchParams> = ["vendor", "from", "to", "invoiceDate", "page", "perPage", "err", "cfg", "refreshed"];
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

    await prisma.$transaction(async (tx: TxClient) => {
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

  async function exportSelectedPassportAction(formData: FormData) {
    "use server";
    await requireInvoicesView();

    const idsRaw = formData.getAll("ids");
    const ids = idsRaw
      .map((v) => String(v).trim())
      .filter((v) => v.length > 0)
      .slice(0, 200);

    if (ids.length === 0) {
      redirect(buildHref({ err: "none_selected" }));
    }

    redirect(`/admin/invoices/passport-export?ids=${encodeURIComponent(ids.join(","))}`);
  }

  const errBanner =
    err === "confirm"
      ? 'To hard delete: select invoices, type "DELETE", then click Hard delete selected.'
      : err === "none_selected"
        ? "Select at least one invoice to hard delete."
        : err
          ? err
          : null;

  const cfgBanner =
    cfg === "saved"
      ? "Settings saved. New invoices will use the updated vendor pricing + tax settings."
      : cfg === "formula_required"
        ? "Tax formula is required."
        : cfg === "tax_rate_invalid"
          ? "Tax rate must be a valid number between 0 and 999.99."
          : cfg === "parts_upcharge_invalid"
            ? "Parts upcharge must be a valid non-negative number."
            : cfg === "config_not_ready"
              ? "Vendor settings are not available yet on this deployment (missing invoiceVendorConfig)."
              : null;

  const undoBanner = undo
    ? `Undid the last generated batch and reopened ${undo} invoice${undo === "1" ? "" : "s"}.`
    : null;

  const lastGeneratedAt = lastGeneratedBatch ? new Date(lastGeneratedBatch.createdAt) : null;
  const lastGeneratedIds = lastGeneratedBatch?.ids ?? [];
  const lastGeneratedIdsParam = lastGeneratedIds.length > 0 ? encodeURIComponent(lastGeneratedIds.join(",")) : "";

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

        {undoBanner ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 14,
              border: "1px solid rgba(76,175,80,0.55)",
              background: "rgba(76,175,80,0.12)",
              fontWeight: 900,
            }}
          >
            {undoBanner}
          </div>
        ) : null}

        {/* Vendor pricing + tax formulas (collapsed per vendor) */}
        <div style={{ marginTop: 12, border, borderRadius: 14, background: surface, padding: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Vendor pricing + tax formulas</div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
            Price variables: <code>cost</code>, <code>partsUpchargePct</code>. Tax variables: <code>lineSubtotal</code>,{" "}
            <code>taxRatePct</code>, <code>quantity</code>, <code>unitPrice</code>. Allowed helpers: <code>min</code>,{" "}
            <code>max</code>, <code>round</code>, <code>floor</code>, <code>ceil</code>, <code>abs</code>.
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
                <summary style={detailsSummaryStyle}>{vendorLabel(v)} — click to edit</summary>

                <form action={updateVendorPricingAndTaxAction} style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  <input type="hidden" name="vendor" value={v} />

                  <label style={controlLabel}>
                    Parts upcharge (%)
                    <input
                      name="partsUpchargePct"
                      defaultValue={String(partsUpchargeByVendor.get(v) ?? 0)}
                      style={controlBase}
                      inputMode="decimal"
                      placeholder="0"
                      disabled={!vendorConfigReady}
                    />
                  </label>

                  <label style={controlLabel}>
                    Parts price formula
                    <input
                      name="partsPriceFormula"
                      defaultValue={String(partsPriceFormulaByVendor.get(v) ?? DEFAULT_PARTS_PRICE_FORMULA)}
                      style={controlBase}
                      placeholder={DEFAULT_PARTS_PRICE_FORMULA}
                      disabled={!vendorConfigReady}
                    />
                  </label>

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

          {openTicketsBeforeWindowCount > 0 ? (
            <div
              style={{
                marginTop: 10,
                padding: 12,
                borderRadius: 14,
                border: "1px solid rgba(255,193,7,0.45)",
                background: "rgba(255,193,7,0.08)",
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                <b>{openTicketsBeforeWindowCount}</b> pending checkout ticket{openTicketsBeforeWindowCount === 1 ? " is" : "s are"} older than the current invoice window.
                {oldestOpenTicketDate ? ` Oldest pending checkout: ${fmtLocalDate(oldestOpenTicketDate)}.` : ""}
              </div>
              {oldestOpenTicketDate ? (
                <Link
                  href={buildHref({ from: fmtForDateInput(oldestOpenTicketDate), err: "" })}
                  style={{ ...btn, textDecoration: "none", display: "inline-block" }}
                >
                  Include older pending tickets
                </Link>
              ) : null}
            </div>
          ) : null}

          {lastGeneratedInvoices.length > 0 ? (
            <div
              style={{
                marginTop: 10,
                padding: 12,
                borderRadius: 14,
                border: "1px solid rgba(255,193,7,0.45)",
                background: "rgba(255,193,7,0.08)",
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ fontWeight: 900 }}>
                Last generated batch: <b>{lastGeneratedInvoices.length}</b> invoice{lastGeneratedInvoices.length === 1 ? "" : "s"}
                {lastGeneratedAt && Number.isFinite(lastGeneratedAt.getTime())
                  ? ` • ${lastGeneratedAt.toLocaleString()}`
                  : ""}
              </div>

              <div style={{ fontSize: 12, opacity: 0.85 }}>
                {lastGeneratedInvoices
                  .slice(0, 4)
                  .map((invoice) => `${invoice.storeNumber} ${invoice.storeName}`)
                  .join(" • ")}
                {lastGeneratedInvoices.length > 4 ? ` • +${lastGeneratedInvoices.length - 4} more` : ""}
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <Link
                  href={`/admin/invoices/print-batch?ids=${lastGeneratedIdsParam}&autoExport=1`}
                  style={{ ...btn, ...btnPrimary, textDecoration: "none", display: "inline-block" }}
                >
                  Reprint last batch
                </Link>

                <a
                  href={`/admin/invoices/passport-export?ids=${lastGeneratedIdsParam}`}
                  style={{ ...btn, textDecoration: "none", display: "inline-block" }}
                >
                  Export last batch
                </a>

                <form action={undoLastGeneratedAction}>
                  <input type="hidden" name="batchIds" value={lastGeneratedIds.join(",")} />
                  <button type="submit" style={btnDanger}>
                    Undo last generated
                  </button>
                </form>
              </div>
            </div>
          ) : null}

          <div style={{ marginTop: 10, border, borderRadius: 14, padding: 12, background: surface }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Pending invoice generation (by store)</div>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
              {hasDateFilter
                ? `Stores with OPEN tickets not yet invoiced in this window (${fromStr || "start"} → ${toStr || "now"}).`
                : "Stores with all OPEN tickets not yet invoiced."}
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
                      {["Store", "Ready tickets", "Preview"].map((h) => (
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
                        <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                          <Link
                            href={`/admin/invoices/preview?storeId=${encodeURIComponent(r.storeId)}&from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}&vendor=${encodeURIComponent(vendor)}`}
                            style={{ ...btn, textDecoration: "none", display: "inline-block" }}
                          >
                            Preview
                          </Link>
                        </td>
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
                  From (optional)
                  <input type="date" name="from" defaultValue={fromStr} style={controlBase} />
                </label>

                <label style={{ ...controlLabel, flex: "0 1 180px", minWidth: 0 }}>
                  To (optional)
                  <input type="date" name="to" defaultValue={toStr} style={controlBase} />
                </label>

                <label style={{ ...controlLabel, flex: "0 1 260px", minWidth: 0 }}>
                  Invoice date (admin preference)
                  <input
                    type="datetime-local"
                    name="invoiceDate"
                    defaultValue={fmtForDatetimeLocal(invoiceDateSafe)}
                    style={controlBase}
                  />
                </label>

                <div style={{ flex: "1 1 220px", display: "flex", justifyContent: "flex-end" }}>
                  <button type="submit" style={btnPrimary} disabled={readyTotal === 0}>
                    Generate invoices for window
                  </button>
                </div>
              </div>

              <div style={{ fontSize: 12, opacity: 0.8 }}>
                Manual trigger. Submitted checkouts are immediately “ready” (OPEN, not invoiced). Leave dates blank to generate from <b>all pending checkout tickets</b>, or set dates to filter the window. Generating creates <b>one invoice per store</b>{" "}
                for the selected vendor, then marks those tickets <b>INVOICED</b>.
              </div>
            </form>
          </div>
        </div>

        {/* Refresh cost snapshots */}
        <div style={{ marginTop: 12, border, borderRadius: 14, background: surface, padding: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 4 }}>Refresh cost snapshots on pending tickets</div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
            Updates the cost stored on each <b>open, not-yet-invoiced</b> ticket to match the item&apos;s current cost.
            This fixes invoices being generated with outdated (lower or higher) costs.
          </div>
          {refreshed ? (
            <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(76,175,80,0.55)", background: "rgba(76,175,80,0.1)", fontSize: 13, fontWeight: 900 }}>
              ✓ Updated {refreshed} ticket{refreshed === "1" ? "" : "s"} with the latest item cost.
            </div>
          ) : null}
          <form action={refreshCostSnapshotsAction}>
            <button type="submit" style={btnPrimary}>
              Refresh cost snapshots
            </button>
          </form>
        </div>

        {/* Recent invoices */}
        <div style={{ marginTop: 12, border, borderRadius: 14, background: surface, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
            <div style={{ fontWeight: 900 }}>Recent invoices</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Showing <b>{invoices.length}</b> of <b>{invoiceTotal}</b> • Page <b>{page}</b> / <b>{pageCount}</b>
            </div>
          </div>

          <form id="hard_delete_invoices_form" action={hardDeleteSelectedInvoicesAction}>
            <input type="hidden" name="vendor" value={vendor} />
            <input type="hidden" name="from" value={fromStr} />
            <input type="hidden" name="to" value={toStr} />
            <input type="hidden" name="invoiceDate" value={invoiceDateRaw || fmtForDatetimeLocal(invoiceDateSafe)} />
            <input type="hidden" name="page" value={String(page)} />
            <input type="hidden" name="perPage" value={String(perPage)} />
            <input type="hidden" name="err" value="" />

            {/* Select-all toggle */}
            <div
              style={{
                marginTop: 10,
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <button type="button" id="invoice_select_toggle" style={{ ...btn, padding: "9px 12px" }}>
                Select all
              </button>
              <div id="invoice_selected_count" style={{ fontSize: 12, opacity: 0.85, fontWeight: 800 }}>
                0 selected
              </div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>Toggles selection for invoices on this page.</div>
            </div>

            <div style={{ marginTop: 10, overflowX: "auto", border, borderRadius: 14, background: surface }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Select", "Created", "Vendor", "Vendor #", "Store", "Invoice date", "Window", "Lines", "Total", "Status", "Print", "Export"].map(
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
                  {invoices.map((inv) => {
                    const totalNum = inv.total ? Number(inv.total.toString()) : NaN;
                    const storeLabel = `${inv.storeNumber} ${inv.storeName}`.trim();
                    const showBilledTo =
                      !!inv.billedTo &&
                      normalizeInvoicePartyLabel(inv.billedTo) !== normalizeInvoicePartyLabel(storeLabel);
                    return (
                      <tr key={inv.id} style={{ borderBottom: border }}>
                        <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                          <input type="checkbox" name="ids" value={inv.id} />
                        </td>
                        <td style={{ padding: 10, whiteSpace: "nowrap" }}>{fmtLocalDate(inv.createdAt)}</td>
                        <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 900 }}>{vendorLabel(inv.vendor)}</td>
                        <td style={{ padding: 10, whiteSpace: "nowrap" }}>{inv.vendorNumber ?? "—"}</td>
                        <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 900 }}>
                          {storeLabel}
                          {showBilledTo ? ` - ${inv.billedTo}` : ""}
                        </td>
                        <td style={{ padding: 10, whiteSpace: "nowrap" }}>{fmtLocalDate(inv.invoiceDate)}</td>
                        <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                          {fmtLocalDate(inv.periodStart)} → {fmtLocalDate(inv.periodEnd)}
                        </td>
                        <td style={{ padding: 10, whiteSpace: "nowrap" }}>{inv._count.lines}</td>
                        <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 900 }}>
                          {Number.isFinite(totalNum) ? money(totalNum) : "—"}
                        </td>
                        <td style={{ padding: 10, whiteSpace: "nowrap" }}>{inv.status}</td>
                        <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                          <Link href={`/admin/invoices/${inv.id}/print?autoprint=1`} style={{ ...btn, textDecoration: "none", display: "inline-block" }}>
                            Print
                          </Link>
                        </td>
                        <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                          <a
                            href={`/admin/invoices/passport-export?ids=${encodeURIComponent(inv.id)}`}
                            style={{ ...btn, textDecoration: "none", display: "inline-block" }}
                          >
                            Export
                          </a>
                        </td>
                      </tr>
                    );
                  })}

                  {invoices.length === 0 ? (
                    <tr>
                      <td colSpan={12} style={{ padding: 14, opacity: 0.8 }}>
                        No invoices yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <InvoiceSelectionWiring
              formId="hard_delete_invoices_form"
              toggleId="invoice_select_toggle"
              countId="invoice_selected_count"
            />

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
                <input
                  name="confirm"
                  placeholder="DELETE"
                  style={{ ...controlBase, padding: "8px 10px", borderRadius: 10, fontSize: 13 }}
                />
              </label>

              <button type="submit" style={btnDanger}>
                Hard delete selected
              </button>

              <button type="submit" formAction={exportSelectedPassportAction} style={btn}>
                Export selected for Passport
              </button>

              <div style={{ fontSize: 12, opacity: 0.75, maxWidth: 700 }}>Hard delete permanently removes invoices and their line items.</div>
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