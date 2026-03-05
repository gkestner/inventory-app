import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { Permission, PartsCheckoutStatus, Prisma, Role } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

type SearchParams = {
  q?: string;
  status?: string;
  storeId?: string;
  itemId?: string;
  createdByUserId?: string;
  needToOrderMore?: string;
  quantity?: string;
  from?: string;
  to?: string;
};

async function requireReportView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  const ok = hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) redirect("/");
}

function normalizeStatus(v: string | undefined): PartsCheckoutStatus | "all" {
  const s = String(v ?? "all").trim().toUpperCase();
  if (s === "OPEN" || s === "INVOICED" || s === "VOIDED") return s as PartsCheckoutStatus;
  return "all";
}

function normalizeNeedMore(v: string | undefined): "all" | "yes" | "no" {
  const s = String(v ?? "all").trim().toLowerCase();
  if (s === "yes" || s === "true" || s === "1") return "yes";
  if (s === "no" || s === "false" || s === "0") return "no";
  return "all";
}

function parsePositiveInt(v: string | undefined): number | null {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n)) return null;
  const x = Math.floor(n);
  return x > 0 ? x : null;
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

export default async function CheckoutOrdersReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireReportView();

  const sp = await searchParams;

  const q = String(sp.q ?? "").trim();
  const status = normalizeStatus(sp.status);
  const storeId = String(sp.storeId ?? "").trim();
  const itemId = String(sp.itemId ?? "").trim();
  const createdByUserId = String(sp.createdByUserId ?? "").trim();
  const needToOrderMore = normalizeNeedMore(sp.needToOrderMore);
  const quantity = parsePositiveInt(sp.quantity);
  const from = parseDateStart(sp.from);
  const to = parseDateEnd(sp.to);

  const where: Prisma.PartsCheckoutTicketWhereInput = {
    ...(status === "all" ? {} : { status }),
    ...(storeId ? { storeId } : {}),
    ...(itemId ? { itemId } : {}),
    ...(createdByUserId ? { createdByUserId } : {}),
    ...(needToOrderMore === "yes" ? { needToOrderMore: true } : {}),
    ...(needToOrderMore === "no" ? { needToOrderMore: false } : {}),
    ...(quantity ? { quantity } : {}),
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
            { item: { sku: { contains: q, mode: "insensitive" } } },
            { item: { name: { contains: q, mode: "insensitive" } } },
            { item: { partNumber: { contains: q, mode: "insensitive" } } },
            { storeName: { contains: q, mode: "insensitive" } },
            { createdByName: { contains: q, mode: "insensitive" } },
            { note: { contains: q, mode: "insensitive" } },
            { voidNote: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [tickets, stores, items, users] = await Promise.all([
    prisma.partsCheckoutTicket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        status: true,
        invoiceId: true,
        itemId: true,
        storeId: true,
        storeName: true,
        quantity: true,
        needToOrderMore: true,
        createdByUserId: true,
        createdByName: true,
        note: true,
        skuSnapshot: true,
        partNumberSnapshot: true,
        nameSnapshot: true,
        item: { select: { sku: true, partNumber: true, name: true } },
        vendorSnapshot: true,
        costSnapshot: true,
        priceSnapshot: true,
        taxableSnapshot: true,
        createdAt: true,
        invoicedAt: true,
        voidedAt: true,
        voidNote: true,
      },
    }),
    prisma.location.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.item.findMany({ where: { active: true }, orderBy: { sku: "asc" }, select: { id: true, sku: true, name: true } }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const border = "1px solid rgba(128,128,128,0.25)";

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1400, margin: "0 auto", color: "var(--foreground)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Report: Checkout Orders</h1>
          <Link
            href="/admin/reports"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border,
              background: "var(--background)",
              color: "var(--foreground)",
              textDecoration: "none",
              fontWeight: 900,
            }}
          >
            ← Report Hub
          </Link>
        </div>

        <div style={{ marginTop: 8, opacity: 0.85, lineHeight: 1.5 }}>
          Search and filter checkout tickets by all key checkout fields (item, store, user, qty, need-to-order-more,
          notes, status, dates). Invoicing does not remove these records from this report.
        </div>

        <form method="get" style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <input name="q" defaultValue={q} placeholder="Search id, sku, part #, item, store, tech, notes..." style={{ padding: "10px 12px", borderRadius: 10, border }} />

            <select name="status" defaultValue={status} style={{ padding: "10px 12px", borderRadius: 10, border }}>
              <option value="all">All Statuses</option>
              <option value="OPEN">OPEN</option>
              <option value="INVOICED">INVOICED</option>
              <option value="VOIDED">VOIDED</option>
            </select>

            <select name="storeId" defaultValue={storeId} style={{ padding: "10px 12px", borderRadius: 10, border }}>
              <option value="">All Stores</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <select name="itemId" defaultValue={itemId} style={{ padding: "10px 12px", borderRadius: 10, border }}>
              <option value="">All Items</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.sku} - {i.name}
                </option>
              ))}
            </select>

            <select name="createdByUserId" defaultValue={createdByUserId} style={{ padding: "10px 12px", borderRadius: 10, border }}>
              <option value="">All Created By</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>

            <select name="needToOrderMore" defaultValue={needToOrderMore} style={{ padding: "10px 12px", borderRadius: 10, border }}>
              <option value="all">Need To Order More: All</option>
              <option value="yes">Need To Order More: Yes</option>
              <option value="no">Need To Order More: No</option>
            </select>

            <input name="quantity" defaultValue={quantity ?? ""} type="number" min={1} placeholder="Quantity =" style={{ padding: "10px 12px", borderRadius: 10, border }} />
            <input name="from" defaultValue={String(sp.from ?? "")} type="date" style={{ padding: "10px 12px", borderRadius: 10, border }} />
            <input name="to" defaultValue={String(sp.to ?? "")} type="date" style={{ padding: "10px 12px", borderRadius: 10, border }} />
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" style={{ padding: "10px 12px", borderRadius: 10, border, fontWeight: 900 }}>
              Apply Filters
            </button>
            <Link href="/admin/reports/checkout-orders" style={{ textDecoration: "underline" }}>
              Reset
            </Link>
            <div style={{ opacity: 0.8 }}>
              Results: <b>{tickets.length}</b>
            </div>
          </div>
        </form>

        <div style={{ marginTop: 12, border, borderRadius: 10, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Created", "Status", "Ticket", "Item", "Store", "Qty", "Need More", "Created By", "Invoice", "Details"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: border, fontSize: 12, opacity: 0.85, whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} style={{ borderBottom: border }}>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>{new Date(t.createdAt).toLocaleString()}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 800 }}>{t.status}</td>
                  <td style={{ padding: 10, fontFamily: "monospace", fontSize: 12 }}>{t.id}</td>
                  <td style={{ padding: 10 }}>
                    <div style={{ fontWeight: 700 }}>{t.skuSnapshot}</div>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>{t.nameSnapshot}</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{t.partNumberSnapshot || "—"}</div>
                  </td>
                  <td style={{ padding: 10 }}>{t.storeName}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>{t.quantity}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>{t.needToOrderMore ? "Yes" : "No"}</td>
                  <td style={{ padding: 10 }}>{t.createdByName}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>{t.invoiceId ? "Linked" : "Not linked"}</td>
                  <td style={{ padding: 10, minWidth: 280 }}>
                    <details>
                      <summary style={{ cursor: "pointer", fontWeight: 800 }}>View</summary>
                      <div style={{ marginTop: 8, display: "grid", gap: 4, fontSize: 12 }}>
                        <div><b>Store ID:</b> {t.storeId}</div>
                        <div><b>Item ID:</b> {t.itemId}</div>
                        <div><b>Current Item:</b> {t.item?.sku ?? "—"} {t.item?.name ? `- ${t.item.name}` : ""}</div>
                        <div><b>Current Part #:</b> {t.item?.partNumber ?? "—"}</div>
                        <div><b>Created By User ID:</b> {t.createdByUserId}</div>
                        <div><b>Need To Order More:</b> {t.needToOrderMore ? "Yes" : "No"}</div>
                        <div><b>Note:</b> {t.note || "—"}</div>
                        <div><b>Vendor Snapshot:</b> {t.vendorSnapshot}</div>
                        <div><b>Cost Snapshot:</b> {t.costSnapshot?.toString() ?? "—"}</div>
                        <div><b>Price Snapshot:</b> {t.priceSnapshot?.toString() ?? "—"}</div>
                        <div><b>Taxable Snapshot:</b> {t.taxableSnapshot ? "Yes" : "No"}</div>
                        <div><b>Invoiced At:</b> {t.invoicedAt ? new Date(t.invoicedAt).toLocaleString() : "—"}</div>
                        <div><b>Voided At:</b> {t.voidedAt ? new Date(t.voidedAt).toLocaleString() : "—"}</div>
                        <div><b>Void Note:</b> {t.voidNote || "—"}</div>
                      </div>
                    </details>
                  </td>
                </tr>
              ))}

              {tickets.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: 14, opacity: 0.8 }}>
                    No checkout records found for your filters.
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
