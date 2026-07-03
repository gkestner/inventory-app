import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { Permission, Prisma, Role } from "@prisma/client";

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
  from?: string;
  to?: string;
  active?: string;
  sort?: string;
};

type ReportRow = {
  id: string;
  sku: string;
  partNumber: string | null;
  name: string;
  manufacturer: string | null;
  cost: Prisma.Decimal | null;
  webUrl: string | null;
  onHandQty: number;
  lastCheckoutAt: Date | null;
  lastCheckoutQty: number | null;
  lastCheckoutStore: string | null;
  checkoutQtyInPeriod: number;
};

async function requireReportView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  const ok = hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) redirect("/");
}

function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultFromDate(now = new Date()): Date {
  const d = new Date(now);
  d.setMonth(d.getMonth() - 12);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDateStart(value: string | undefined, fallback: Date): Date {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const date = new Date(`${raw}T00:00:00`);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function parseDateEnd(value: string | undefined, fallback: Date): Date {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const date = new Date(`${raw}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function normalizeExternalUrl(value: string | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function money(value: Prisma.Decimal | null): string {
  const n = value ? Number(value.toString()) : 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(n) ? n : 0);
}

function daysSince(date: Date | null, now = new Date()): number | null {
  if (!date) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000)));
}

function ageLabel(date: Date | null, now = new Date()): string {
  const days = daysSince(date, now);
  if (days === null) return "Never checked out";
  if (days < 31) return `${days} day${days === 1 ? "" : "s"}`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  return remMonths ? `${years} yr ${remMonths} mo` : `${years} yr`;
}

function sortRows(rows: ReportRow[], sort: string, now: Date): ReportRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    switch (sort) {
      case "sku":
        return a.sku.localeCompare(b.sku, undefined, { sensitivity: "base" });
      case "cost-desc":
        return Number(b.cost ?? 0) - Number(a.cost ?? 0);
      case "manufacturer":
        return String(a.manufacturer ?? "").localeCompare(String(b.manufacturer ?? ""), undefined, { sensitivity: "base" });
      case "oldest":
      default: {
        const aDays = daysSince(a.lastCheckoutAt, now) ?? Number.MAX_SAFE_INTEGER;
        const bDays = daysSince(b.lastCheckoutAt, now) ?? Number.MAX_SAFE_INTEGER;
        if (bDays !== aDays) return bDays - aDays;
        return a.sku.localeCompare(b.sku, undefined, { sensitivity: "base" });
      }
    }
  });
  return sorted;
}

function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const trimmed = String(value ?? "").trim();
    if (trimmed) sp.set(key, trimmed);
  }
  const out = sp.toString();
  return out ? `?${out}` : "";
}

export default async function ItemsNotCheckedOutReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireReportView();

  const sp = await searchParams;
  const now = new Date();
  const defaultTo = new Date(now);
  defaultTo.setHours(23, 59, 59, 999);

  const from = parseDateStart(sp.from, defaultFromDate(now));
  const to = parseDateEnd(sp.to, defaultTo);
  const fromInput = dateInputValue(from);
  const toInput = dateInputValue(to);
  const q = String(sp.q ?? "").trim();
  const active = String(sp.active ?? "active").trim().toLowerCase() === "all" ? "all" : "active";
  const sort = String(sp.sort ?? "oldest").trim();
  const like = `%${q}%`;

  const rowsRaw = await prisma.$queryRaw<ReportRow[]>(Prisma.sql`
    WITH valid_checkouts AS (
      SELECT
        pct."itemId",
        pct."createdAt",
        pct."quantity",
        pct."storeName",
        ROW_NUMBER() OVER (PARTITION BY pct."itemId" ORDER BY pct."createdAt" DESC, pct."id" DESC) AS rn
      FROM "PartsCheckoutTicket" pct
      WHERE pct."status" <> 'VOIDED'::"PartsCheckoutStatus"
    ),
    period_checkouts AS (
      SELECT
        vc."itemId",
        COALESCE(SUM(vc."quantity"), 0)::int AS "checkoutQtyInPeriod"
      FROM valid_checkouts vc
      WHERE vc."createdAt" >= ${from}
        AND vc."createdAt" <= ${to}
      GROUP BY vc."itemId"
    ),
    latest_checkout AS (
      SELECT
        vc."itemId",
        vc."createdAt" AS "lastCheckoutAt",
        vc."quantity" AS "lastCheckoutQty",
        vc."storeName" AS "lastCheckoutStore"
      FROM valid_checkouts vc
      WHERE vc.rn = 1
    )
    SELECT
      i."id",
      i."sku",
      i."partNumber",
      i."name",
      i."manufacturer",
      i."cost",
      i."webUrl",
      i."onHandQty",
      lc."lastCheckoutAt",
      lc."lastCheckoutQty",
      lc."lastCheckoutStore",
      COALESCE(pc."checkoutQtyInPeriod", 0)::int AS "checkoutQtyInPeriod"
    FROM "Item" i
    LEFT JOIN latest_checkout lc ON lc."itemId" = i."id"
    LEFT JOIN period_checkouts pc ON pc."itemId" = i."id"
    WHERE ${active === "active" ? Prisma.sql`i."active" = true` : Prisma.sql`TRUE`}
      AND COALESCE(pc."checkoutQtyInPeriod", 0) = 0
      AND ${
        q
          ? Prisma.sql`(
              i."sku" ILIKE ${like}
              OR i."name" ILIKE ${like}
              OR COALESCE(i."partNumber", '') ILIKE ${like}
              OR COALESCE(i."manufacturer", '') ILIKE ${like}
              OR COALESCE(i."orderFrom", '') ILIKE ${like}
            )`
          : Prisma.sql`TRUE`
      }
    ORDER BY i."sku" ASC
  `);

  const rows = sortRows(rowsRaw, sort, now);
  const neverCount = rows.filter((row) => !row.lastCheckoutAt).length;
  const totalValue = rows.reduce((sum, row) => sum + Number(row.cost ?? 0) * row.onHandQty, 0);
  const exportHref = `/api/admin/reports/excel${qs({
    report: "items-not-checked-out",
    q,
    from: fromInput,
    to: toInput,
    active,
  })}`;
  const border = "1px solid rgba(128,128,128,0.25)";

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1450, margin: "0 auto", color: "var(--foreground)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Report: Items Not Checked Out</h1>
          <Link href="/admin/reports" style={{ padding: "10px 14px", borderRadius: 12, border, background: "var(--background)", color: "var(--foreground)", textDecoration: "none", fontWeight: 900 }}>
            Back to Reports
          </Link>
          <Link href="/admin/reports/create" style={{ padding: "10px 14px", borderRadius: 12, border, background: "var(--background)", color: "var(--foreground)", textDecoration: "none", fontWeight: 900 }}>
            Create Report
          </Link>
          <Link href={exportHref} style={{ padding: "10px 14px", borderRadius: 12, border, background: "var(--background)", color: "var(--foreground)", textDecoration: "none", fontWeight: 900 }}>
            Export Excel
          </Link>
        </div>

        <div style={{ marginTop: 8, opacity: 0.85, lineHeight: 1.5 }}>
          Shows active catalog items with zero checkout quantity in the selected window. Last checkout is calculated from full non-voided checkout history.
        </div>

        <form method="get" style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
            <input name="q" defaultValue={q} placeholder="Search SKU, part #, item, manufacturer..." style={{ padding: "10px 12px", borderRadius: 10, border }} />
            <input name="from" defaultValue={fromInput} type="date" style={{ padding: "10px 12px", borderRadius: 10, border }} />
            <input name="to" defaultValue={toInput} type="date" style={{ padding: "10px 12px", borderRadius: 10, border }} />
            <select name="active" defaultValue={active} style={{ padding: "10px 12px", borderRadius: 10, border }}>
              <option value="active">Active items only</option>
              <option value="all">All items</option>
            </select>
            <select name="sort" defaultValue={sort} style={{ padding: "10px 12px", borderRadius: 10, border }}>
              <option value="oldest">Longest since checkout</option>
              <option value="sku">SKU</option>
              <option value="manufacturer">Manufacturer</option>
              <option value="cost-desc">Cost high to low</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" style={{ padding: "10px 12px", borderRadius: 10, border, fontWeight: 900 }}>
              Apply Filters
            </button>
            <Link href="/admin/reports/items-not-checked-out" style={{ textDecoration: "underline" }}>
              Reset to 12 months
            </Link>
          </div>
        </form>

        <section style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <div style={{ border, borderRadius: 10, padding: 12, background: "rgba(128,128,128,0.06)" }}>
            <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 900 }}>Items</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{rows.length}</div>
          </div>
          <div style={{ border, borderRadius: 10, padding: 12, background: "rgba(128,128,128,0.06)" }}>
            <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 900 }}>Never Checked Out</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{neverCount}</div>
          </div>
          <div style={{ border, borderRadius: 10, padding: 12, background: "rgba(128,128,128,0.06)" }}>
            <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 900 }}>On-Hand Value</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>
              {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totalValue)}
            </div>
          </div>
        </section>

        <div style={{ marginTop: 12, border, borderRadius: 10, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead>
              <tr>
                {["SKU", "Item", "Manufacturer", "Part #", "Cost", "On Hand", "Last Checkout", "How Long", "Part Link"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: border, fontSize: 12, opacity: 0.85 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const itemUrl = normalizeExternalUrl(row.webUrl);
                return (
                  <tr key={row.id} style={{ borderBottom: border }}>
                    <td style={{ padding: 10, fontWeight: 900, wordBreak: "break-word" }}>{row.sku}</td>
                    <td style={{ padding: 10 }}>
                      <div style={{ fontWeight: 800 }}>{row.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>{row.id}</div>
                    </td>
                    <td style={{ padding: 10 }}>{row.manufacturer || "-"}</td>
                    <td style={{ padding: 10, wordBreak: "break-word" }}>{row.partNumber || "-"}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{money(row.cost)}</td>
                    <td style={{ padding: 10 }}>{row.onHandQty}</td>
                    <td style={{ padding: 10 }}>
                      {row.lastCheckoutAt ? (
                        <>
                          <div>{new Date(row.lastCheckoutAt).toLocaleDateString()}</div>
                          <div style={{ fontSize: 12, opacity: 0.75 }}>
                            Qty {row.lastCheckoutQty ?? "-"} {row.lastCheckoutStore ? `at ${row.lastCheckoutStore}` : ""}
                          </div>
                        </>
                      ) : (
                        "Never"
                      )}
                    </td>
                    <td style={{ padding: 10, fontWeight: 900 }}>{ageLabel(row.lastCheckoutAt, now)}</td>
                    <td style={{ padding: 10 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Link
                          href={`/admin/items/${encodeURIComponent(row.id)}/inventory`}
                          style={{ padding: "6px 10px", borderRadius: 10, border, background: "var(--background)", color: "var(--foreground)", fontWeight: 800, textDecoration: "none" }}
                        >
                          Item
                        </Link>
                        {itemUrl ? (
                          <a href={itemUrl} target="_blank" rel="noopener noreferrer" style={{ padding: "6px 10px", borderRadius: 10, border, background: "var(--background)", color: "var(--foreground)", fontWeight: 800, textDecoration: "none" }}>
                            Part
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 14, opacity: 0.8 }}>
                    Every matching item has at least one checkout inside this window.
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
