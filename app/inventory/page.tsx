import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission, Prisma } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { parseItemLabelNumberSearchTerm } from "@/app/lib/item-label-number";
import { getInventoryDemandRecommendations } from "@/app/lib/inventory-demand";
import { VIEW_INVENTORY } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SearchParams = {
  page?: string;
  perPage?: string;
  q?: string;
  active?: string;
  sort?: string;
  dir?: string;
  recommendation?: string;
};

type SortKey =
  | "updatedAt"
  | "sku"
  | "partNumber"
  | "name"
  | "category"
  | "cost"
  | "price"
  | "taxable"
  | "active"
  | "suggestedMinQty30Day"
  | "suggestedReorderQty30Day";

type RecommendationFilter = "all" | "different" | "same" | "needsReorder";

function toInt(v: string | undefined, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const x = Math.floor(n);
  return x > 0 ? x : fallback;
}

function parseActiveFilter(v: string | undefined): boolean | null {
  const normalized = (v ?? "").trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

function parseSortKey(v: string | undefined): SortKey {
  switch ((v ?? "").trim()) {
    case "sku":
    case "partNumber":
    case "name":
    case "category":
    case "cost":
    case "price":
    case "taxable":
    case "active":
    case "suggestedMinQty30Day":
    case "suggestedReorderQty30Day":
      return v as SortKey;
    default:
      return "updatedAt";
  }
}

function parseSortDir(v: string | undefined): "asc" | "desc" {
  return (v ?? "").trim().toLowerCase() === "asc" ? "asc" : "desc";
}

function parseRecommendationFilter(v: string | undefined): RecommendationFilter {
  switch ((v ?? "").trim()) {
    case "different":
    case "same":
    case "needsReorder":
      return v as RecommendationFilter;
    default:
      return "all";
  }
}

function normalizeQuery(q: string): string {
  return (q ?? "")
    .normalize("NFKC")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(q: string): string[] {
  const s = normalizeQuery(q);
  if (!s) return [];
  return s.split(/[ \-]+/g).map((x) => x.trim()).filter((x) => x.length >= 2);
}

function variants(token: string): string[] {
  const cleaned = token.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  const out = new Set<string>();
  if (cleaned) out.add(cleaned);
  if (cleaned.endsWith("s") && cleaned.length > 3) out.add(cleaned.slice(0, -1));
  else if (cleaned.length > 2) out.add(`${cleaned}s`);
  return Array.from(out);
}

function buildWhere(qRaw: string, active: boolean | null): Prisma.ItemWhereInput {
  const tokens = tokenize(qRaw);
  const clauses: Prisma.ItemWhereInput[] = [];

  if (active !== null) clauses.push({ active });
  if (tokens.length === 0) return clauses.length ? { AND: clauses } : {};

  const tokenClauses: Prisma.ItemWhereInput[] = tokens.map((tok) => {
    const vs = variants(tok);
    const labelNumber = parseItemLabelNumberSearchTerm(tok);

    const ors: Prisma.ItemWhereInput[] = vs.flatMap((v) => [
      { id: { contains: v, mode: "insensitive" } },
      { sku: { contains: v, mode: "insensitive" } },
      { partNumber: { contains: v, mode: "insensitive" } },
      { name: { contains: v, mode: "insensitive" } },
      { category: { contains: v, mode: "insensitive" } },
      { description: { contains: v, mode: "insensitive" } },
      { manufacturer: { contains: v, mode: "insensitive" } },
      { orderFrom: { contains: v, mode: "insensitive" } },
      { webUrl: { contains: v, mode: "insensitive" } },
    ]);

    if (labelNumber !== null) ors.push({ labelNumber });
    return { OR: ors };
  });

  return { AND: [...clauses, ...tokenClauses] };
}

function compareValues(left: string | number | boolean | Date | null, right: string | number | boolean | Date | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

function buildHref(values: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (!value) continue;
    sp.set(key, value);
  }
  const qs = sp.toString();
  return qs ? `/inventory?${qs}` : "/inventory";
}

async function requireInventoryView() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  const canView =
    perms.allowAll ||
    hasAnyPermission(perms, [VIEW_INVENTORY, Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS, Permission.ADMIN_IMPORT_EXPORT_ITEMS]);

  if (!canView) redirect("/");
}

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireInventoryView();

  const sp = (await searchParams) ?? {};
  const qRaw = (sp.q ?? "").trim();
  const activeFilter = parseActiveFilter(sp.active);
  const sort = parseSortKey(sp.sort);
  const dir = parseSortDir(sp.dir);
  const recommendationFilter = parseRecommendationFilter(sp.recommendation);
  const page = toInt(sp.page, 1);
  const perPage = Math.min(200, toInt(sp.perPage, 25));

  const allItems = await prisma.item.findMany({
    where: buildWhere(qRaw, activeFilter),
    select: {
      id: true,
      sku: true,
      partNumber: true,
      vendor: true,
      name: true,
      category: true,
      cost: true,
      price: true,
      taxable: true,
      active: true,
      updatedAt: true,
      onHandQty: true,
      minQty: true,
    },
  });

  const recommendations = await getInventoryDemandRecommendations({
    itemIds: allItems.map((item) => item.id),
    includeInactive: true,
  });
  const recommendationMap = new Map(recommendations.map((entry) => [entry.itemId, entry]));

  const filteredItems = allItems.filter((item) => {
    const recommendation = recommendationMap.get(item.id);
    const suggestedMinQty30Day = recommendation?.suggestedMinQty30Day ?? 0;
    const suggestedReorderQty30Day = recommendation?.suggestedReorderQty30Day ?? 0;
    if (recommendationFilter === "different") return item.minQty !== suggestedMinQty30Day;
    if (recommendationFilter === "same") return item.minQty === suggestedMinQty30Day;
    if (recommendationFilter === "needsReorder") return suggestedReorderQty30Day > 0;
    return true;
  });

  const sortedItems = [...filteredItems].sort((left, right) => {
    const leftRecommendation = recommendationMap.get(left.id);
    const rightRecommendation = recommendationMap.get(right.id);

    const leftValue = (() => {
      switch (sort) {
        case "sku":
          return left.sku;
        case "partNumber":
          return left.partNumber ?? "";
        case "name":
          return left.name;
        case "category":
          return left.category ?? "";
        case "cost":
          return left.cost ? Number(left.cost) : null;
        case "price":
          return left.price ? Number(left.price) : null;
        case "taxable":
          return left.taxable;
        case "active":
          return left.active;
        case "suggestedMinQty30Day":
          return leftRecommendation?.suggestedMinQty30Day ?? 0;
        case "suggestedReorderQty30Day":
          return leftRecommendation?.suggestedReorderQty30Day ?? 0;
        case "updatedAt":
        default:
          return left.updatedAt;
      }
    })();

    const rightValue = (() => {
      switch (sort) {
        case "sku":
          return right.sku;
        case "partNumber":
          return right.partNumber ?? "";
        case "name":
          return right.name;
        case "category":
          return right.category ?? "";
        case "cost":
          return right.cost ? Number(right.cost) : null;
        case "price":
          return right.price ? Number(right.price) : null;
        case "taxable":
          return right.taxable;
        case "active":
          return right.active;
        case "suggestedMinQty30Day":
          return rightRecommendation?.suggestedMinQty30Day ?? 0;
        case "suggestedReorderQty30Day":
          return rightRecommendation?.suggestedReorderQty30Day ?? 0;
        case "updatedAt":
        default:
          return right.updatedAt;
      }
    })();

    const compared = compareValues(leftValue, rightValue);
    if (compared !== 0) return dir === "asc" ? compared : -compared;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });

  const total = sortedItems.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, pageCount);
  const pageItems = sortedItems.slice((safePage - 1) * perPage, safePage * perPage);

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";
  const card: CSSProperties = { border, borderRadius: 12, padding: 12, background: surface, color: fg };
  const label: CSSProperties = { display: "grid", gap: 6, minWidth: 0, fontSize: 12, fontWeight: 800, opacity: 0.95 };
  const field: CSSProperties = { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border, background: surface, color: fg, outline: "none" };
  const btn: CSSProperties = { padding: "10px 14px", borderRadius: 10, border, background: surface, color: fg, fontWeight: 900, textDecoration: "none", whiteSpace: "nowrap" };

  return (
    <main style={{ padding: 16 }}>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Inventory</h1>
          <div style={{ fontSize: 13, opacity: 0.78 }}>Read-only inventory access</div>
          <div style={{ marginLeft: "auto" }}>
            <Link href="/" style={{ ...btn, display: "inline-flex", alignItems: "center" }}>Home</Link>
          </div>
        </div>

        <form method="GET" style={{ ...card, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
          <label style={{ ...label, flex: "2 1 280px" }}>
            Search
            <input name="q" defaultValue={qRaw} placeholder="Search SKU, part #, name, category, manufacturer..." style={field} />
          </label>
          <label style={label}>
            Active
            <select name="active" defaultValue={activeFilter === null ? "all" : String(activeFilter)} style={field}>
              <option value="all">All</option>
              <option value="true">Active</option>
              <option value="false">Archived</option>
            </select>
          </label>
          <label style={label}>
            Sort
            <select name="sort" defaultValue={sort} style={field}>
              <option value="updatedAt">Updated</option>
              <option value="sku">SKU</option>
              <option value="partNumber">Part #</option>
              <option value="name">Name</option>
              <option value="category">Category</option>
              <option value="cost">Cost</option>
              <option value="price">Price</option>
              <option value="taxable">Taxable</option>
              <option value="active">Active</option>
              <option value="suggestedMinQty30Day">Suggested Min (30d)</option>
              <option value="suggestedReorderQty30Day">Suggested Reorder</option>
            </select>
          </label>
          <label style={label}>
            Dir
            <select name="dir" defaultValue={dir} style={field}>
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
          </label>
          <label style={label}>
            Recommendation
            <select name="recommendation" defaultValue={recommendationFilter} style={field}>
              <option value="all">All</option>
              <option value="different">Min differs from suggested</option>
              <option value="same">Min matches suggested</option>
              <option value="needsReorder">Needs reorder</option>
            </select>
          </label>
          <label style={label}>
            Per Page
            <select name="perPage" defaultValue={String(perPage)} style={field}>
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </label>
          <div style={{ display: "flex", gap: 10, alignItems: "end", marginLeft: "auto" }}>
            <button type="submit" style={btn}>Apply Filters</button>
            <Link href="/inventory" style={{ ...btn, display: "inline-flex", alignItems: "center" }}>Reset</Link>
          </div>
        </form>

        <div style={{ ...card, padding: 0, overflowX: "auto" }}>
          <div style={{ padding: 12, borderBottom: border, fontSize: 12, opacity: 0.84 }}>
            {total.toLocaleString()} results • page {safePage} / {pageCount}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["SKU", "Part #", "Vendor", "Name", "Category", "On Hand", "Min", "Suggested Min (30d)", "Cost", "Price", "Active", "Updated"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: border, whiteSpace: "nowrap", fontSize: 13 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageItems.map((item) => {
                const recommendation = recommendationMap.get(item.id);
                return (
                  <tr key={item.id}>
                    <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap", fontWeight: 800 }}>{item.sku}</td>
                    <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap" }}>{item.partNumber ?? "—"}</td>
                    <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap" }}>{item.vendor ?? "—"}</td>
                    <td style={{ padding: 10, borderBottom: border }}>{item.name}</td>
                    <td style={{ padding: 10, borderBottom: border }}>{item.category ?? "—"}</td>
                    <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap", fontWeight: 800 }}>{item.onHandQty.toLocaleString()}</td>
                    <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap" }}>{item.minQty.toLocaleString()}</td>
                    <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap" }}>{(recommendation?.suggestedMinQty30Day ?? 0).toLocaleString()}</td>
                    <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap" }}>{item.cost ? String(item.cost) : "—"}</td>
                    <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap" }}>{item.price ? String(item.price) : "—"}</td>
                    <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap" }}>{item.active ? "Yes" : "No"}</td>
                    <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap", fontSize: 12, opacity: 0.84 }}>{item.updatedAt.toLocaleString()}</td>
                  </tr>
                );
              })}
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ padding: 16, opacity: 0.76 }}>No inventory items matched your filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Link
            href={buildHref({ q: qRaw || undefined, active: activeFilter === null ? undefined : String(activeFilter), sort, dir, recommendation: recommendationFilter === "all" ? undefined : recommendationFilter, perPage: String(perPage), page: String(Math.max(1, safePage - 1)) })}
            style={{ ...btn, pointerEvents: safePage <= 1 ? "none" : "auto", opacity: safePage <= 1 ? 0.6 : 1 }}
          >
            Prev
          </Link>
          <Link
            href={buildHref({ q: qRaw || undefined, active: activeFilter === null ? undefined : String(activeFilter), sort, dir, recommendation: recommendationFilter === "all" ? undefined : recommendationFilter, perPage: String(perPage), page: String(Math.min(pageCount, safePage + 1)) })}
            style={{ ...btn, pointerEvents: safePage >= pageCount ? "none" : "auto", opacity: safePage >= pageCount ? 0.6 : 1 }}
          >
            Next
          </Link>
        </div>
      </div>
    </main>
  );
}