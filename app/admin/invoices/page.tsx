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

function hasInvoiceModel() {
  const delegate = (prisma as { invoice?: { findMany?: unknown } }).invoice;
  return Boolean(delegate && typeof delegate.findMany === "function");
}

function hasInvoiceModel() {
  const delegate = (prisma as { invoice?: { findMany?: unknown } }).invoice;
  return Boolean(delegate && typeof delegate.findMany === "function");
}

export default async function AdminInvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireInvoicesView();

  const invoiceDelegate = (prisma as { invoice?: { findMany?: unknown } }).invoice;
  const invoiceModelReady = Boolean(invoiceDelegate && typeof invoiceDelegate.findMany === "function");

  if (!invoiceModelReady) {
    return (
      <main style={{ padding: 16 }}>
        {/* ...existing fallback UI... */}

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
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Not ready yet</div>
            <div style={{ opacity: 0.85, lineHeight: 1.5 }}>
              Your app is running with a Prisma Client that does not include <code>invoice</code> yet, so this page would
              crash.
              <br />
              Fix: run migration + regenerate Prisma Client (or restart dev server after <code>prisma generate</code>).
            </div>
          </div>
        </div>
      </main>
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

  const vendorRaw = String(searchParams.vendor ?? "SUCCESS_PLUS").trim().toUpperCase();
  const vendor: InvoiceVendor = vendorRaw === "AMERICAN_PLUS" ? "AMERICAN_PLUS" : "SUCCESS_PLUS";

  const fromStr = String(searchParams.from ?? defaultFrom).trim();
  const toStr = String(searchParams.to ?? defaultTo).trim();

  const from = parseDateOnlyToDate(fromStr, false) ?? parseDateOnlyToDate(defaultFrom, false)!;
  const to = parseDateOnlyToDate(toStr, true) ?? parseDateOnlyToDate(defaultTo, true)!;

  const invoiceDateRaw = String(searchParams.invoiceDate ?? "").trim();
  const invoiceDate = invoiceDateRaw ? new Date(invoiceDateRaw) : new Date();
  const invoiceDateSafe = Number.isNaN(invoiceDate.getTime()) ? new Date() : invoiceDate;

  const page = clamp(Number(searchParams.page ?? "1") || 1, 1, 9999);
  const perPageAllowed = new Set([10, 25, 50]);
  const perPage = perPageAllowed.has(Number(searchParams.perPage)) ? Number(searchParams.perPage) : 25;
  const skip = (page - 1) * perPage;

  const err = String(searchParams.err ?? "").trim();

  const readyByStore = await prisma.partsCheckoutTicket.groupBy({
    by: ["storeId", "storeName"],
    where: {
      status: PartsCheckoutStatus.OPEN,
      invoicedAt: null,
      voidedAt: null,
      createdAt: { gte: from, lte: to },
    },
    _count: { _all: true },
    orderBy: { storeName: "asc" },
  });

  const readyTotal = readyByStore.reduce((acc, r) => acc + r._count._all, 0);

  const [invoiceTotal, invoices] = await Promise.all([
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

  const pageCount = Math.max(1, Math.ceil(invoiceTotal / perPage));

  function buildHref(patch: Partial<SearchParams>) {
    const merged: SearchParams = { ...searchParams, ...patch };

    const qp = new URLSearchParams();
    const keys: Array<keyof SearchParams> = ["vendor", "from", "to", "invoiceDate", "page", "perPage", "err"];

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

  async function hardDeleteSelectedInvoicesAction(formData: FormData) {
    "use server";
    await requireInvoicesView();

    // IMPORTANT: server actions cannot close over local functions from the page component.
    // Build return URL entirely inside the server action.
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
      };

      const merged: SearchParams = { ...base, ...patch };

      const qp = new URLSearchParams();
      const keys: Array<keyof SearchParams> = ["vendor", "from", "to", "invoiceDate", "page", "perPage", "err"];
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

        <div style={{ marginTop: 12, border, borderRadius: 14, background: surface, padding: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Generate invoices</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Ready tickets in window: <b>{readyTotal}</b> • Vendor format: <b>{vendorLabel(vendor)}</b>
          </div>

          {/* Pending generation */}
          <div style={{ marginTop: 10, border, borderRadius: 14, padding: 12, background: surface }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Pending invoice generation (by store)</div>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
              Stores with OPEN tickets not yet invoiced in this window ({fromStr} → {toStr}).
            </div>

            {readyByStore.length === 0 ? (
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
                Manual trigger. Submitted checkouts are immediately “ready” (OPEN, not invoiced). Generating creates{" "}
                <b>one invoice per store</b> in the window for the selected vendor, then marks those tickets{" "}
                <b>INVOICED</b>.
              </div>
            </form>
          </div>
        </div>

        <div style={{ marginTop: 12, border, borderRadius: 14, background: surface, padding: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "baseline",
            }}
          >
            <div style={{ fontWeight: 900 }}>Recent invoices</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Showing <b>{invoices.length}</b> of <b>{invoiceTotal}</b> • Page <b>{page}</b> / <b>{pageCount}</b>
            </div>
          </div>

          <form action={hardDeleteSelectedInvoicesAction}>
            {/* Preserve current listing state so errors return to same view */}
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
                    {[
                      "Select",
                      "Created",
                      "Vendor",
                      "Vendor #",
                      "Store",
                      "Invoice date",
                      "Window",
                      "Lines",
                      "Total",
                      "Status",
                      "Print",
                    ].map((h) => (
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
                  {invoices.map((inv) => (
                    <tr key={inv.id} style={{ borderBottom: border }}>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                        <input type="checkbox" name="ids" value={inv.id} />
                      </td>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>{fmtLocalDate(inv.createdAt)}</td>
                      <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 900 }}>{vendorLabel(inv.vendor)}</td>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>{inv.vendorNumber}</td>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                        <div style={{ fontWeight: 900 }}>
                          {inv.storeNumber} {inv.storeName}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>{inv.billedTo}</div>
                      </td>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>{fmtLocalDate(inv.invoiceDate)}</td>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                        {fmtLocalDate(inv.periodStart)} → {fmtLocalDate(inv.periodEnd)}
                      </td>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>{inv._count.lines}</td>
                      <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 900 }}>
                        {inv.total
                          ? Number(inv.total).toLocaleString(undefined, { style: "currency", currency: "USD" })
                          : "—"}
                      </td>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>{inv.status}</td>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                        <Link
                          href={`/admin/invoices/${inv.id}/print`}
                          style={{ ...btn, textDecoration: "none", display: "inline-block" }}
                        >
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
                <input
                  name="confirm"
                  placeholder="DELETE"
                  style={{ ...controlBase, padding: "8px 10px", borderRadius: 10, fontSize: 13 }}
                />
              </label>

              <button type="submit" style={btnDanger}>
                Hard delete selected
              </button>

              <div style={{ fontSize: 12, opacity: 0.75, maxWidth: 700 }}>
                Hard delete permanently removes invoices and their line items. If the delete fails, your database likely has
                a foreign key reference (ex: tickets linked to invoices).
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

            <form
              action="/admin/invoices"
              method="get"
              style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "end" }}
            >
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
