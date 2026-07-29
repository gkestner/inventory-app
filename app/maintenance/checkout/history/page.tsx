import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission, PartsCheckoutStatus, Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CheckoutSession = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type SearchParams = {
  q?: string;
  status?: string;
  storeId?: string;
  createdByUserId?: string;
  from?: string;
  to?: string;
  importOk?: string;
  importErr?: string;
};

function normalizeStatus(v: string | undefined): PartsCheckoutStatus | "all" {
  const s = String(v ?? "all").trim().toUpperCase();
  if (s === "OPEN" || s === "INVOICED" || s === "VOIDED") return s as PartsCheckoutStatus;
  return "all";
}

function isReturnRecord(note: string | null, voidNote: string | null): boolean {
  const combined = `${note ?? ""}\n${voidNote ?? ""}`.toUpperCase();
  return combined.includes("[RETURN]") || combined.includes("LINKEDTOCHECKOUT=");
}

function getTicketStatusLabel(ticket: { status: PartsCheckoutStatus; note: string | null; voidNote: string | null }): string {
  if (ticket.status === "VOIDED" && isReturnRecord(ticket.note, ticket.voidNote)) return "RETURN";
  return ticket.status;
}

function parseDateStart(v: string | undefined): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateEnd(v: string | undefined): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(`${s}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDateTime(d: Date | null): string {
  if (!d) return "-";
  return new Date(d).toLocaleString();
}

function money(n: Prisma.Decimal | null): string {
  if (!n) return "$0.00";
  const x = Number(n);
  if (!Number.isFinite(x)) return "$0.00";
  return x.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

async function requireCheckoutHistoryView() {
  const session = (await getServerSession(authOptions)) as CheckoutSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return { session, perms };

  const ok = hasAnyPermission(perms, [Permission.VIEW_CHECKOUT, Permission.CREATE_CHECKOUT]);
  if (!ok) redirect("/maintenance");

  return { session, perms };
}

async function loadAllowedStores(session: CheckoutSession, allowAll: boolean) {
  if (allowAll) {
    return prisma.location.findMany({
      where: { active: true, receiptEnabled: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  }

  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase().trim() : "";
  if (!email) redirect("/login");

  const me = await prisma.user.findUnique({
    where: { email },
    select: {
      active: true,
      location: { select: { id: true, name: true, active: true, receiptEnabled: true } },
      allowedLocations: {
        select: {
          location: { select: { id: true, name: true, active: true, receiptEnabled: true } },
        },
      },
    },
  });

  if (!me || !me.active) redirect("/login");

  const seen = new Set<string>();
  const stores: Array<{ id: string; name: string }> = [];

  if (me.location?.active && me.location.receiptEnabled && !seen.has(me.location.id)) {
    seen.add(me.location.id);
    stores.push({ id: me.location.id, name: me.location.name });
  }

  for (const allowed of me.allowedLocations) {
    const location = allowed.location;
    if (!location?.active || !location.receiptEnabled || seen.has(location.id)) continue;
    seen.add(location.id);
    stores.push({ id: location.id, name: location.name });
  }

  stores.sort((a, b) => a.name.localeCompare(b.name));
  return stores;
}

export default async function MaintenanceCheckoutHistoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { session, perms } = await requireCheckoutHistoryView();
  const sp = await searchParams;

  const q = String(sp.q ?? "").trim();
  const status = normalizeStatus(sp.status);
  const selectedStoreId = String(sp.storeId ?? "").trim();
  const selectedCreatedByUserId = String(sp.createdByUserId ?? "").trim();
  const from = parseDateStart(sp.from);
  const to = parseDateEnd(sp.to);

  const stores = await loadAllowedStores(session, perms.allowAll);
  const allowedStoreIds = stores.map((store) => store.id);
  const canImportCheckoutHistory = perms.allowAll || hasAnyPermission(perms, [Permission.CREATE_CHECKOUT]);

  const users = await prisma.user.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const where: Prisma.PartsCheckoutTicketWhereInput = {
    ...(perms.allowAll ? {} : { storeId: { in: allowedStoreIds.length > 0 ? allowedStoreIds : ["__none__"] } }),
    ...(selectedStoreId ? { storeId: selectedStoreId } : {}),
    ...(selectedCreatedByUserId ? { createdByUserId: selectedCreatedByUserId } : {}),
    ...(status === "all" ? {} : { status }),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { skuSnapshot: { contains: q, mode: "insensitive" } },
            { partNumberSnapshot: { contains: q, mode: "insensitive" } },
            { nameSnapshot: { contains: q, mode: "insensitive" } },
            { storeName: { contains: q, mode: "insensitive" } },
            { createdByName: { contains: q, mode: "insensitive" } },
            { note: { contains: q, mode: "insensitive" } },
            { voidNote: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const tickets = await prisma.partsCheckoutTicket.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true,
      status: true,
      invoiceId: true,
      storeName: true,
      quantity: true,
      needToOrderMore: true,
      createdByName: true,
      note: true,
      skuSnapshot: true,
      partNumberSnapshot: true,
      nameSnapshot: true,
      vendorSnapshot: true,
      costSnapshot: true,
      priceSnapshot: true,
      createdAt: true,
      invoicedAt: true,
      voidedAt: true,
      voidNote: true,
    },
  });

  const importJobs = await prisma.importJob.findMany({
    where: { type: "checkout_history" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      createdAt: true,
      total: true,
      created: true,
      failed: true,
      errors: {
        orderBy: { rowNumber: "asc" },
        take: 5,
        select: {
          id: true,
          rowNumber: true,
          sku: true,
          message: true,
        },
      },
    },
  });

  const border = "1px solid rgba(128,128,128,0.25)";
  const card: CSSProperties = {
    border,
    borderRadius: 10,
    background: "var(--background)",
    color: "var(--foreground)",
  };

  return (
    <main style={{ padding: 24 }}>
      <div style={{ maxWidth: 1380, margin: "0 auto", color: "var(--foreground)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link
            href="/maintenance/checkout"
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border,
              background: "var(--background)",
              color: "var(--foreground)",
              textDecoration: "none",
              fontWeight: 800,
              lineHeight: 1,
            }}
          >
            ← Checkout
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Checkout History</h1>
        </div>

        <div style={{ opacity: 0.8, marginTop: 8 }}>
          Search recent checkout, invoiced, and return records. Non-admin users only see stores assigned to their account.
        </div>

        {sp.importOk ? (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(34,197,94,0.35)",
              background: "rgba(34,197,94,0.12)",
              color: "var(--foreground)",
              fontWeight: 800,
            }}
          >
            {sp.importOk}
          </div>
        ) : null}

        {sp.importErr ? (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(239,68,68,0.35)",
              background: "rgba(239,68,68,0.12)",
              color: "var(--foreground)",
              fontWeight: 800,
            }}
          >
            Import failed: {sp.importErr}
          </div>
        ) : null}

        {canImportCheckoutHistory ? (
          <section style={{ ...card, marginTop: 14, padding: 16, display: "grid", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Import Checkout History</h2>
                <div style={{ opacity: 0.8, marginTop: 6 }}>
                  Upload a CSV to add historical checkout rows. Imported rows are tagged in notes and do not adjust inventory or create invoices.
                </div>
              </div>
              <div style={{ fontSize: 12, opacity: 0.78, maxWidth: 560, lineHeight: 1.5 }}>
                Required columns: <b>SKU</b>, <b>Quantity</b>, and <b>Store</b> or <b>Store Number</b>. Optional columns:
                Checkout Date, Created By, Status, Need To Order More, Notes.
              </div>
            </div>

            <form
              action="/api/maintenance/checkout/import"
              method="post"
              encType="multipart/form-data"
              style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}
            >
              <input
                name="file"
                type="file"
                accept=".csv,text/csv"
                required
                style={{ padding: "10px 12px", borderRadius: 10, border, background: "var(--background)", color: "var(--foreground)" }}
              />
              <button
                type="submit"
                style={{ padding: "10px 12px", borderRadius: 10, border, fontWeight: 900, background: "var(--foreground)", color: "var(--background)" }}
              >
                Import CSV
              </button>
            </form>

            <div style={{ overflowX: "auto", borderTop: border, paddingTop: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Imported", "Job", "Rows", "Created", "Failed", "Recent Errors"].map((heading) => (
                      <th key={heading} style={{ textAlign: "left", padding: 8, borderBottom: border, fontSize: 12, opacity: 0.85, whiteSpace: "nowrap" }}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importJobs.map((job) => (
                    <tr key={job.id} style={{ borderBottom: border }}>
                      <td style={{ padding: 8, whiteSpace: "nowrap", verticalAlign: "top" }}>{fmtDateTime(job.createdAt)}</td>
                      <td style={{ padding: 8, whiteSpace: "nowrap", verticalAlign: "top", fontSize: 12, opacity: 0.8 }}>{job.id}</td>
                      <td style={{ padding: 8, whiteSpace: "nowrap", verticalAlign: "top" }}>{job.total}</td>
                      <td style={{ padding: 8, whiteSpace: "nowrap", verticalAlign: "top" }}>{job.created}</td>
                      <td style={{ padding: 8, whiteSpace: "nowrap", verticalAlign: "top" }}>{job.failed}</td>
                      <td style={{ padding: 8, minWidth: 280, verticalAlign: "top" }}>
                        {job.errors.length ? (
                          <div style={{ display: "grid", gap: 4 }}>
                            {job.errors.map((error) => (
                              <div key={error.id} style={{ fontSize: 12 }}>
                                Row {error.rowNumber}
                                {error.sku ? ` (${error.sku})` : ""}: {error.message}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span style={{ opacity: 0.7 }}>-</span>
                        )}
                      </td>
                    </tr>
                  ))}

                  {importJobs.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 10, opacity: 0.8 }}>
                        No checkout history imports yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <form method="get" style={{ ...card, marginTop: 14, padding: 16, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
            <input
              name="q"
              defaultValue={q}
              placeholder="Search ticket id, SKU, part #, item, store, user, notes..."
              style={{ padding: "10px 12px", borderRadius: 10, border, background: "var(--background)", color: "var(--foreground)" }}
            />

            <select
              name="status"
              defaultValue={status}
              style={{ padding: "10px 12px", borderRadius: 10, border, background: "var(--background)", color: "var(--foreground)" }}
            >
              <option value="all">All statuses</option>
              <option value="OPEN">OPEN</option>
              <option value="INVOICED">INVOICED</option>
              <option value="VOIDED">VOIDED / RETURN</option>
            </select>

            <select
              name="storeId"
              defaultValue={selectedStoreId}
              style={{ padding: "10px 12px", borderRadius: 10, border, background: "var(--background)", color: "var(--foreground)" }}
            >
              <option value="">All stores</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>

            <select
              name="createdByUserId"
              defaultValue={selectedCreatedByUserId}
              style={{ padding: "10px 12px", borderRadius: 10, border, background: "var(--background)", color: "var(--foreground)" }}
            >
              <option value="">All created by</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>

            <input
              name="from"
              type="date"
              defaultValue={String(sp.from ?? "")}
              style={{ padding: "10px 12px", borderRadius: 10, border, background: "var(--background)", color: "var(--foreground)" }}
            />

            <input
              name="to"
              type="date"
              defaultValue={String(sp.to ?? "")}
              style={{ padding: "10px 12px", borderRadius: 10, border, background: "var(--background)", color: "var(--foreground)" }}
            />
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="submit"
              style={{ padding: "10px 12px", borderRadius: 10, border, fontWeight: 800, background: "var(--background)", color: "var(--foreground)" }}
            >
              Apply Filters
            </button>
            <Link href="/maintenance/checkout/history" style={{ textDecoration: "underline", color: "var(--foreground)" }}>
              Reset
            </Link>
            <div style={{ opacity: 0.8 }}>
              Results: <b>{tickets.length}</b>
            </div>
          </div>
        </form>

        <div style={{ ...card, marginTop: 14, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {[
                  "Created",
                  "Status",
                  "Store",
                  "SKU",
                  "Part #",
                  "Name",
                  "Qty",
                  "Created By",
                  "Vendor",
                  "Cost",
                  "Price",
                  "Invoice",
                  "Notes",
                ].map((heading) => (
                  <th
                    key={heading}
                    style={{ textAlign: "left", padding: 10, borderBottom: border, fontSize: 12, opacity: 0.85, whiteSpace: "nowrap" }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id} style={{ borderBottom: border }}>
                  <td style={{ padding: 10, whiteSpace: "nowrap", verticalAlign: "top" }}>
                    <div>{fmtDateTime(ticket.createdAt)}</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{ticket.id}</div>
                  </td>
                  <td style={{ padding: 10, whiteSpace: "nowrap", verticalAlign: "top", fontWeight: 700 }}>{getTicketStatusLabel(ticket)}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap", verticalAlign: "top" }}>{ticket.storeName}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap", verticalAlign: "top" }}>{ticket.skuSnapshot}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap", verticalAlign: "top" }}>{ticket.partNumberSnapshot ?? "-"}</td>
                  <td style={{ padding: 10, minWidth: 220, verticalAlign: "top" }}>{ticket.nameSnapshot}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap", verticalAlign: "top" }}>
                    {ticket.quantity}
                    {ticket.needToOrderMore ? <div style={{ fontSize: 12, opacity: 0.75 }}>Need more</div> : null}
                  </td>
                  <td style={{ padding: 10, whiteSpace: "nowrap", verticalAlign: "top" }}>{ticket.createdByName}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap", verticalAlign: "top" }}>{ticket.vendorSnapshot}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap", verticalAlign: "top" }}>{money(ticket.costSnapshot)}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap", verticalAlign: "top" }}>{money(ticket.priceSnapshot)}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap", verticalAlign: "top" }}>
                    {ticket.invoiceId ? (
                      <Link href={`/admin/invoices/${ticket.invoiceId}/print?autoprint=1`} style={{ color: "var(--foreground)", textDecoration: "underline" }}>
                        View invoice
                      </Link>
                    ) : ticket.invoicedAt ? (
                      <span>Invoiced</span>
                    ) : ticket.voidedAt ? (
                      <span>{isReturnRecord(ticket.note, ticket.voidNote) ? "Returned" : "Voided"}</span>
                    ) : (
                      <span>Pending</span>
                    )}
                    {ticket.invoicedAt ? <div style={{ fontSize: 12, opacity: 0.75 }}>{fmtDateTime(ticket.invoicedAt)}</div> : null}
                    {ticket.voidedAt ? <div style={{ fontSize: 12, opacity: 0.75 }}>{fmtDateTime(ticket.voidedAt)}</div> : null}
                  </td>
                  <td style={{ padding: 10, minWidth: 240, verticalAlign: "top" }}>
                    {ticket.note || ticket.voidNote || "-"}
                  </td>
                </tr>
              ))}

              {tickets.length === 0 ? (
                <tr>
                  <td colSpan={13} style={{ padding: 16, opacity: 0.8 }}>
                    No checkout history records matched your filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
