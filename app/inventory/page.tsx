import type { CSSProperties } from "react";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission, Prisma } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { parseItemLabelNumberSearchTerm } from "@/app/lib/item-label-number";
import { getInventoryDemandRecommendations } from "@/app/lib/inventory-demand";
import { VIEW_INVENTORY } from "@/app/lib/permission-constants";
import { isSchemaOrDbNotReadyError } from "@/app/lib/prisma-schema-compat";

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

type InventorySession = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type InventoryCommentRow = {
  itemId: string;
  comment: string;
  updatedAt: Date;
};

type InventoryStatusAggregateRow = {
  itemId: string;
  status: "ORDERED" | "ARRIVED" | "ADDED_TO_INVENTORY";
  _sum: { quantity: number | null };
};

type InventoryCommentDelegate = {
  findMany: (args: unknown) => Promise<InventoryCommentRow[]>;
  upsert: (args: unknown) => Promise<unknown>;
  deleteMany: (args: unknown) => Promise<unknown>;
};

type InventoryOrderAggregateDelegate = {
  groupBy: (args: unknown) => Promise<InventoryStatusAggregateRow[]>;
};

const db = prisma as unknown as {
  inventoryItemComment: InventoryCommentDelegate;
  inventoryOrder: InventoryOrderAggregateDelegate;
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

async function requireInventoryView(): Promise<InventorySession> {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  const canView =
    perms.allowAll ||
    hasAnyPermission(perms, [VIEW_INVENTORY, Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS, Permission.ADMIN_IMPORT_EXPORT_ITEMS]);

  if (!canView) redirect("/");

  return session as InventorySession;
}

async function listInventoryComments(itemIds: string[], userId: string): Promise<InventoryCommentRow[]> {
  if (itemIds.length === 0) return [];

  try {
    return await db.inventoryItemComment.findMany({
      where: { userId, itemId: { in: itemIds } },
      select: { itemId: true, comment: true, updatedAt: true },
    } as unknown);
  } catch (error) {
    if (isSchemaOrDbNotReadyError(error)) return [];
    throw error;
  }
}

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireInventoryView();
  const email = String(session?.user?.email ?? "").trim().toLowerCase();
  const me = email
    ? await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } })
    : null;
  if (!me || !me.active) redirect("/login");

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
    const compareMinQty = recommendation?.compareMinQty ?? true;
    const suggestedMinQty30Day = recommendation?.suggestedMinQty30Day ?? 0;
    const suggestedReorderQty30Day = recommendation?.suggestedReorderQty30Day ?? 0;
    if (recommendationFilter === "different") return compareMinQty && item.minQty !== suggestedMinQty30Day;
    if (recommendationFilter === "same") return compareMinQty && item.minQty === suggestedMinQty30Day;
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
  const pageItemIds = pageItems.map((item) => item.id);

  async function saveItemCommentAction(formData: FormData) {
    "use server";

    const session = await requireInventoryView();
    const email = String(session?.user?.email ?? "").trim().toLowerCase();
    const me = email
      ? await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } })
      : null;
    if (!me || !me.active) redirect("/login");

    const itemId = String(formData.get("itemId") ?? "").trim();
    const comment = String(formData.get("comment") ?? "").trim();
    const returnTo = String(formData.get("returnTo") ?? "/inventory").trim() || "/inventory";

    if (!itemId) redirect(returnTo);

    try {
      if (!comment) {
        await db.inventoryItemComment.deleteMany({ where: { itemId, userId: me.id } } as unknown);
      } else {
        await db.inventoryItemComment.upsert({
          where: { itemId_userId: { itemId, userId: me.id } },
          update: { comment },
          create: { itemId, userId: me.id, comment },
        } as unknown);
      }
    } catch (error) {
      if (!isSchemaOrDbNotReadyError(error)) throw error;
    }

    revalidatePath("/inventory");
    redirect(returnTo);
  }

  const [statusRows, commentRows] = await Promise.all([
    pageItemIds.length > 0
      ? db.inventoryOrder.groupBy({
          by: ["itemId", "status"],
          where: {
            itemId: { in: pageItemIds },
            status: { in: ["ORDERED", "ARRIVED"] },
          },
          _sum: { quantity: true },
        } as unknown)
      : Promise.resolve([] as InventoryStatusAggregateRow[]),
    listInventoryComments(pageItemIds, me.id),
  ]);

  const itemStatusMap = new Map<string, { ordered: number; arrived: number }>();
  for (const row of statusRows) {
    const current = itemStatusMap.get(row.itemId) ?? { ordered: 0, arrived: 0 };
    const qty = row._sum?.quantity ?? 0;
    if (row.status === "ORDERED") current.ordered += qty;
    if (row.status === "ARRIVED") current.arrived += qty;
    itemStatusMap.set(row.itemId, current);
  }

  const commentMap = new Map(commentRows.map((row) => [row.itemId, row]));
  const currentHref = buildHref({
    q: qRaw || undefined,
    active: activeFilter === null ? undefined : String(activeFilter),
    sort,
    dir,
    recommendation: recommendationFilter === "all" ? undefined : recommendationFilter,
    perPage: String(perPage),
    page: String(safePage),
  });

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";
  const card: CSSProperties = { border, borderRadius: 12, padding: 12, background: surface, color: fg };
  const label: CSSProperties = { display: "grid", gap: 6, minWidth: 0, fontSize: 12, fontWeight: 800, opacity: 0.95 };
  const field: CSSProperties = { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border, background: surface, color: fg, outline: "none" };
  const btn: CSSProperties = { padding: "10px 14px", borderRadius: 10, border, background: surface, color: fg, fontWeight: 900, textDecoration: "none", whiteSpace: "nowrap" };
  const smallBtn: CSSProperties = { ...btn, padding: "8px 10px", fontSize: 12 };
  const tabletCard: CSSProperties = { border, borderRadius: 14, padding: 14, background: surface, color: fg, display: "grid", gap: 12 };
  const tabletMetricGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 };
  const tabletMetricCard: CSSProperties = { border, borderRadius: 12, padding: "10px 12px", background: "rgba(255,255,255,0.03)", display: "grid", gap: 4 };
  const tabletMetaGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 };
  const tabletMetaCard: CSSProperties = { border, borderRadius: 12, padding: "10px 12px", background: "rgba(255,255,255,0.03)", display: "grid", gap: 4 };

  function renderCommentForm(itemId: string, comment: InventoryCommentRow | undefined, compact = false) {
    return (
      <form action={saveItemCommentAction} style={{ display: "grid", gap: 8 }}>
        <input type="hidden" name="itemId" value={itemId} />
        <input type="hidden" name="returnTo" value={currentHref} />
        <textarea
          name="comment"
          defaultValue={comment?.comment ?? ""}
          placeholder="Need More, Named Wrong, or other note..."
          style={{ ...field, minHeight: compact ? 92 : 72, resize: "vertical" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, opacity: 0.72 }}>
            {comment ? `Updated ${comment.updatedAt.toLocaleString()}` : "Saved per item for your account"}
          </div>
          <button type="submit" style={smallBtn}>Save Comment</button>
        </div>
      </form>
    );
  }

  return (
    <main className="inventory-page" style={{ padding: 16 }}>
      <style>{`
        .inventory-shell {
          width: 100%;
          max-width: 1400px;
          margin: 0 auto;
          display: grid;
          gap: 12px;
        }

        .inventory-header {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }

        .inventory-filter-form {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: end;
        }

        .inventory-filter-actions {
          display: flex;
          gap: 10px;
          align-items: end;
          margin-left: auto;
        }

        .inventory-table-view {
          display: block;
        }

        .inventory-card-list {
          display: none;
        }

        .inventory-pagination {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
        }

        @media (max-width: 1100px) {
          .inventory-filter-form {
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            align-items: end !important;
          }

          .inventory-search-label {
            grid-column: 1 / -1;
          }

          .inventory-filter-actions {
            grid-column: 1 / -1;
            margin-left: 0 !important;
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .inventory-filter-actions > * {
            width: 100%;
            justify-content: center;
          }

          .inventory-table-view {
            display: none;
          }

          .inventory-card-list {
            display: grid;
            gap: 12px;
            padding: 12px;
          }

          .inventory-pagination {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            justify-content: stretch !important;
          }

          .inventory-pagination > a {
            text-align: center;
            justify-content: center;
          }
        }

        @media (max-width: 760px) {
          .inventory-filter-form {
            grid-template-columns: minmax(0, 1fr);
          }

          .inventory-filter-actions {
            grid-template-columns: minmax(0, 1fr);
          }

          .inventory-header-home {
            width: 100%;
            margin-left: 0 !important;
          }

          .inventory-card-head {
            flex-direction: column;
            align-items: flex-start !important;
          }

          .inventory-card-meta {
            grid-template-columns: minmax(0, 1fr) !important;
          }
        }
      `}</style>

      <div className="inventory-shell">
        <div className="inventory-header">
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Inventory</h1>
          <div style={{ fontSize: 13, opacity: 0.78 }}>Search inventory, see stock and order status, and leave item comments.</div>
          <div className="inventory-header-home" style={{ marginLeft: "auto" }}>
            <Link href="/" style={{ ...btn, display: "inline-flex", alignItems: "center" }}>Home</Link>
          </div>
        </div>

        <form method="GET" className="inventory-filter-form" style={{ ...card, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
          <label className="inventory-search-label" style={{ ...label, flex: "2 1 280px" }}>
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
          <div className="inventory-filter-actions" style={{ display: "flex", gap: 10, alignItems: "end", marginLeft: "auto" }}>
            <button type="submit" style={btn}>Apply Filters</button>
            <Link href="/inventory" style={{ ...btn, display: "inline-flex", alignItems: "center" }}>Reset</Link>
          </div>
        </form>

        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: 12, borderBottom: border, fontSize: 12, opacity: 0.84 }}>
            {total.toLocaleString()} results • page {safePage} / {pageCount}
          </div>
          <div className="inventory-table-view" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["SKU", "Part #", "Vendor", "Name", "Category", "In Stock", "Ordered", "Arrived", "Min", "Suggested Min (30d)", "Active", "My Comment", "Updated"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: border, whiteSpace: "nowrap", fontSize: 13 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageItems.map((item) => {
                  const recommendation = recommendationMap.get(item.id);
                  const statusCounts = itemStatusMap.get(item.id) ?? { ordered: 0, arrived: 0 };
                  const comment = commentMap.get(item.id);
                  return (
                    <tr key={item.id}>
                      <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap", fontWeight: 800 }}>{item.sku}</td>
                      <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap" }}>{item.partNumber ?? "—"}</td>
                      <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap" }}>{item.vendor ?? "—"}</td>
                      <td style={{ padding: 10, borderBottom: border }}>{item.name}</td>
                      <td style={{ padding: 10, borderBottom: border }}>{item.category ?? "—"}</td>
                      <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap", fontWeight: 800 }}>{item.onHandQty.toLocaleString()}</td>
                      <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap" }}>{statusCounts.ordered.toLocaleString()}</td>
                      <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap" }}>{statusCounts.arrived.toLocaleString()}</td>
                      <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap" }}>{item.minQty.toLocaleString()}</td>
                      <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap" }}>{(recommendation?.suggestedMinQty30Day ?? 0).toLocaleString()}</td>
                      <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap" }}>{item.active ? "Yes" : "No"}</td>
                      <td style={{ padding: 10, borderBottom: border, minWidth: 280 }}>
                        {renderCommentForm(item.id, comment)}
                      </td>
                      <td style={{ padding: 10, borderBottom: border, whiteSpace: "nowrap", fontSize: 12, opacity: 0.84 }}>{item.updatedAt.toLocaleString()}</td>
                    </tr>
                  );
                })}
                {pageItems.length === 0 ? (
                  <tr>
                    <td colSpan={13} style={{ padding: 16, opacity: 0.76 }}>No inventory items matched your filters.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="inventory-card-list">
            {pageItems.length === 0 ? (
              <div style={{ padding: 4, opacity: 0.76 }}>No inventory items matched your filters.</div>
            ) : null}

            {pageItems.map((item) => {
              const recommendation = recommendationMap.get(item.id);
              const statusCounts = itemStatusMap.get(item.id) ?? { ordered: 0, arrived: 0 };
              const comment = commentMap.get(item.id);
              const metaLine = [item.partNumber ? `Part # ${item.partNumber}` : null, item.vendor ? `Vendor ${item.vendor}` : null, item.category ?? null]
                .filter(Boolean)
                .join(" • ");

              return (
                <article key={item.id} style={tabletCard}>
                  <div className="inventory-card-head" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.7 }}>{item.sku}</div>
                      <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1.2 }}>{item.name}</div>
                      {metaLine ? <div style={{ fontSize: 13, opacity: 0.78, lineHeight: 1.35 }}>{metaLine}</div> : null}
                    </div>

                    <div
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        border,
                        background: item.active ? "rgba(11, 107, 115, 0.12)" : "rgba(128,128,128,0.14)",
                        fontSize: 12,
                        fontWeight: 900,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.active ? "Active" : "Archived"}
                    </div>
                  </div>

                  <div style={tabletMetricGrid}>
                    {[
                      ["In Stock", item.onHandQty.toLocaleString()],
                      ["Ordered", statusCounts.ordered.toLocaleString()],
                      ["Arrived", statusCounts.arrived.toLocaleString()],
                      ["Min", item.minQty.toLocaleString()],
                      ["Suggested Min", (recommendation?.suggestedMinQty30Day ?? 0).toLocaleString()],
                    ].map(([title, value]) => (
                      <div key={`${item.id}-${title}`} style={tabletMetricCard}>
                        <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.7, textTransform: "uppercase", letterSpacing: 0.2 }}>{title}</div>
                        <div style={{ fontSize: 18, fontWeight: 900 }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="inventory-card-meta" style={tabletMetaGrid}>
                    <div style={tabletMetaCard}>
                      <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.7, textTransform: "uppercase", letterSpacing: 0.2 }}>Vendor</div>
                      <div style={{ fontSize: 14, fontWeight: 800 }}>{item.vendor ?? "—"}</div>
                    </div>
                    <div style={tabletMetaCard}>
                      <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.7, textTransform: "uppercase", letterSpacing: 0.2 }}>Updated</div>
                      <div style={{ fontSize: 14, fontWeight: 800 }}>{item.updatedAt.toLocaleString()}</div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.78 }}>My Comment</div>
                    {renderCommentForm(item.id, comment, true)}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="inventory-pagination" style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Link
            href={buildHref({ q: qRaw || undefined, active: activeFilter === null ? undefined : String(activeFilter), sort, dir, recommendation: recommendationFilter === "all" ? undefined : recommendationFilter, perPage: String(perPage), page: String(Math.max(1, safePage - 1)) })}
            style={{ ...btn, display: "inline-flex", alignItems: "center", pointerEvents: safePage <= 1 ? "none" : "auto", opacity: safePage <= 1 ? 0.6 : 1 }}
          >
            Prev
          </Link>
          <Link
            href={buildHref({ q: qRaw || undefined, active: activeFilter === null ? undefined : String(activeFilter), sort, dir, recommendation: recommendationFilter === "all" ? undefined : recommendationFilter, perPage: String(perPage), page: String(Math.min(pageCount, safePage + 1)) })}
            style={{ ...btn, display: "inline-flex", alignItems: "center", pointerEvents: safePage >= pageCount ? "none" : "auto", opacity: safePage >= pageCount ? 0.6 : 1 }}
          >
            Next
          </Link>
        </div>
      </div>
    </main>
  );
}