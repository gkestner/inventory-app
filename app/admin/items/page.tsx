// app/admin/items/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { getInventoryDemandRecommendations } from "@/app/lib/inventory-demand";
import { parseItemLabelNumberSearchTerm } from "@/app/lib/item-label-number";
import ItemsTableClient from "./ItemsTableClient";
import { Permission, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Vendor = "SUCCESS_PLUS" | "AMERICAN_PLUS";

type SearchParams = {
  page?: string | string[];
  perPage?: string | string[];
  q?: string | string[];
  createdSku?: string | string[];
  error?: string | string[];
  active?: string | string[];
  sort?: string | string[];
  dir?: string | string[];
  recommendation?: string | string[];
};

type SortKey =
  | "updatedAt"
  | "createdAt"
  | "sku"
  | "partNumber"
  | "name"
  | "category"
  | "cost"
  | "price"
  | "taxable"
  | "active"
  | "suggestedMinQty90Day"
  | "suggestedReorderQty90Day";

type RecommendationFilter = "all" | "different" | "same" | "needsReorder";

function first(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

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
    case "createdAt":
    case "sku":
    case "partNumber":
    case "name":
    case "category":
    case "cost":
    case "price":
    case "taxable":
    case "active":
    case "suggestedMinQty90Day":
    case "suggestedReorderQty90Day":
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

function compareValues(left: string | number | boolean | Date | null, right: string | number | boolean | Date | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

function isNextRedirectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

async function requireItemsAccess() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  const canViewItems =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_EDIT_ITEMS,
      Permission.ADMIN_IMPORT_EXPORT_ITEMS,
    ]);

  if (!canViewItems) redirect("/");

  return { session, perms };
}

/**
 * Normalize text for tokenization:
 * - normalize unicode to reduce “weird dash” mismatches
 * - convert many dash types to "-"
 * - collapse whitespace
 */
function normalizeQuery(q: string): string {
  const s = (q ?? "")
    .normalize("NFKC")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-") // hyphen variants → "-"
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

/**
 * Tokenize:
 * - split on spaces AND hyphens so "SATCO-ESCENT" matches "satco" or "escent"
 * - keep tokens length >= 2
 */
function tokenize(q: string): string[] {
  const s = normalizeQuery(q);
  if (!s) return [];
  return s
    .split(/[ \-]+/g)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

/**
 * Generate useful variants:
 * - lowercase
 * - strip punctuation around token
 * - singular/plural (basic)
 */
function variants(token: string): string[] {
  const cleaned = token
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""); // trim non-alnum edges

  const out = new Set<string>();
  if (cleaned) out.add(cleaned);

  // Basic singular/plural
  if (cleaned.endsWith("s") && cleaned.length > 3) {
    out.add(cleaned.slice(0, -1));
  } else if (cleaned.length > 2) {
    out.add(`${cleaned}s`);
  }

  return Array.from(out);
}

/**
 * Build WHERE:
 * - AND across tokens (so "hot bar bulb" must match both somewhere)
 * - OR across fields for each token
 * - contains + insensitive for partial matches
 */
function buildWhere(qRaw: string, active: boolean | null): Prisma.ItemWhereInput {
  const tokens = tokenize(qRaw);
  const clauses: Prisma.ItemWhereInput[] = [];

  if (active !== null) {
    clauses.push({ active });
  }

  if (tokens.length === 0) {
    return clauses.length ? { AND: clauses } : {};
  }

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

    if (labelNumber !== null) {
      ors.push({ labelNumber });
    }

    return { OR: ors };
  });

  return { AND: [...clauses, ...tokenClauses] };
}

function moneyToDecimalOrNull(v: FormDataEntryValue | null): Prisma.Decimal | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error("Invalid money value");
  // Keep whatever user typed (Decimal), but normalize to 2dp-ish via Number->toFixed for consistency
  return new Prisma.Decimal(n.toFixed(2));
}

function nullableText(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function requiredText(v: FormDataEntryValue | null, label: string): string {
  const s = String(v ?? "").trim();
  if (!s) throw new Error(`${label} is required`);
  return s;
}

function intOrDefault(v: FormDataEntryValue | null, fallback: number): number {
  const s = String(v ?? "").trim();
  if (!s) return fallback;
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function parseTwoDigitSkuPart(raw: FormDataEntryValue | null, label: string): string {
  const s = String(raw ?? "").trim();
  if (!s) throw new Error(`${label} is required.`);
  if (!/^\d{1,2}$/.test(s)) throw new Error(`${label} must be 1-2 digits.`);
  return s.padStart(2, "0");
}

function parseSkuLocationPart(raw: FormDataEntryValue | null): string {
  const s = String(raw ?? "").trim();
  if (!s) throw new Error("Loc is required.");

  if (s.toLowerCase() === "vault") return "vault";
  if (!/^\d{1,2}$/.test(s)) throw new Error('Loc must be 1-2 digits or "Vault".');

  return s.padStart(2, "0");
}

function buildSkuPrefix(loc: string, shelf: string, bin: string): string {
  if (loc.toLowerCase() === "vault") return `VT${shelf}${bin}`;
  return `${loc}${shelf}${bin}`;
}

function buildSkuKeyCandidates(itemId: string): string[] {
  const compact = itemId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const lengths = [6, 8, 10, 12, compact.length];
  const out: string[] = [];
  for (const len of lengths) {
    const key = compact.slice(-Math.max(1, len));
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

async function buildUniqueGeneratedSku(
  tx: Prisma.TransactionClient,
  itemId: string,
  loc: string,
  shelf: string,
  bin: string,
): Promise<string> {
  const prefix = buildSkuPrefix(loc, shelf, bin);
  const candidates = buildSkuKeyCandidates(itemId);

  for (const key of candidates) {
    const sku = `${prefix} - ${key}`;
    const existing = await tx.item.findFirst({
      where: {
        sku,
        NOT: { id: itemId },
      },
      select: { id: true },
    });
    if (!existing) return sku;
  }

  return `${prefix} - ${itemId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`;
}

export default async function AdminItemsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { perms } = await requireItemsAccess();
  const canEditItems = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);

   const sp = await searchParams;

  const page = toInt(first(sp.page), 1);
  const perPage = Math.min(200, toInt(first(sp.perPage), 25));
  const qRaw = (first(sp.q) ?? "").trim();
  const createdSku = (first(sp.createdSku) ?? "").trim() || null;
  const errMsg = (first(sp.error) ?? "").trim() || null;
  const activeFilter = parseActiveFilter(first(sp.active));
  const sort = parseSortKey(first(sp.sort));
  const dir = parseSortDir(first(sp.dir));
  const recommendationFilter = parseRecommendationFilter(first(sp.recommendation));

  const where = buildWhere(qRaw, activeFilter);

  // ✅ Safe fallback: vendor formulas blank unless you’ve wired them.
  const vendorFormulas: Record<Vendor, string> = {
    SUCCESS_PLUS: "",
    AMERICAN_PLUS: "",
  };

  async function createItemAction(formData: FormData) {
    "use server";

    // Keep auth check local + strict and require explicit item edit permission.
    const { session, perms } = await requireItemsAccess();
    const canEditItems = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
    if (!session || !canEditItems) throw new Error("Forbidden");

    const name = requiredText(formData.get("name"), "Name");

    try {
      const maintLoc = parseSkuLocationPart(formData.get("maintLoc"));
      const maintShelf = parseTwoDigitSkuPart(formData.get("maintShelf"), "Shelf");
      const maintBin = parseTwoDigitSkuPart(formData.get("maintBin"), "Bin");

      const vendorRaw = String(formData.get("vendor") ?? "").trim();
      const vendor: Vendor = vendorRaw === "AMERICAN_PLUS" ? "AMERICAN_PLUS" : "SUCCESS_PLUS";

      const partNumber = nullableText(formData.get("partNumber"));
      const description = nullableText(formData.get("description"));
      const category = nullableText(formData.get("category"));
      const manufacturer = nullableText(formData.get("manufacturer"));
      const orderFrom = nullableText(formData.get("orderFrom"));
      const webUrl = nullableText(formData.get("webUrl"));

      const cost = moneyToDecimalOrNull(formData.get("cost"));
      const price = moneyToDecimalOrNull(formData.get("price"));

      const taxable = String(formData.get("taxable") ?? "on") === "on";
      const active = String(formData.get("active") ?? "on") === "on";

      const minQty = Math.max(0, intOrDefault(formData.get("minQty"), 0));

      let createdSku = "";
      await prisma.$transaction(async (tx) => {
        const created = await tx.item.create({
          data: {
            sku: `PENDING-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
            name,
            vendor,
            partNumber,
            description,
            category,
            manufacturer,
            orderFrom,
            webUrl,
            cost,
            price,
            taxable,
            active,
            minQty,
            // qty fields use schema defaults (0)
          },
          select: {
            id: true,
            sku: true,
            partNumber: true,
            vendor: true,
            name: true,
            description: true,
            category: true,
            cost: true,
            price: true,
            taxable: true,
            active: true,
            manufacturer: true,
            orderFrom: true,
            webUrl: true,
            onHandQty: true,
            orderedQty: true,
            usedQty: true,
            minQty: true,
          },
        });

        const generatedSku = await buildUniqueGeneratedSku(tx, created.id, maintLoc, maintShelf, maintBin);

        const finalized = await tx.item.update({
          where: { id: created.id },
          data: { sku: generatedSku },
          select: {
            id: true,
            sku: true,
            partNumber: true,
            vendor: true,
            name: true,
            description: true,
            category: true,
            cost: true,
            price: true,
            taxable: true,
            active: true,
            manufacturer: true,
            orderFrom: true,
            webUrl: true,
            onHandQty: true,
            orderedQty: true,
            usedQty: true,
            minQty: true,
          },
        });
        createdSku = finalized.sku;

        // Version snapshot (version 1) for audit trail consistency
        await tx.itemVersion.create({
          data: {
            itemId: finalized.id,
            version: 1,
            sku: finalized.sku,
            partNumber: finalized.partNumber,
            vendor: finalized.vendor,
            name: finalized.name,
            description: finalized.description,
            category: finalized.category,
            cost: finalized.cost,
            price: finalized.price,
            taxable: finalized.taxable,
            active: finalized.active,

            manufacturer: finalized.manufacturer,
            orderFrom: finalized.orderFrom,
            webUrl: finalized.webUrl,

            onHandQty: finalized.onHandQty,
            orderedQty: finalized.orderedQty,
            usedQty: finalized.usedQty,
            minQty: finalized.minQty,
          },
        });
      });

      revalidatePath("/admin/items");
      redirect(`/admin/items?createdSku=${encodeURIComponent(createdSku)}`);
    } catch (e) {
      if (isNextRedirectError(e)) throw e;
      const msg = e instanceof Error ? e.message : "Failed to create item.";
      redirect(`/admin/items?error=${encodeURIComponent(msg)}`);
    }
  }

  const allItems = await prisma.item.findMany({
    where,
    select: {
      id: true,
      sku: true,
      partNumber: true,
      vendor: true,
      name: true,
      description: true,
      category: true,
      cost: true,
      price: true,
      taxable: true,
      active: true,
      createdAt: true,
      updatedAt: true,

      manufacturer: true,
      orderFrom: true,
      webUrl: true,

      onHandQty: true,
      orderedQty: true,
      usedQty: true,
      minQty: true,
    },
  });

  const recommendations = await getInventoryDemandRecommendations({
    itemIds: allItems.map((item) => item.id),
    includeInactive: true,
  });
  const forecastLabel = recommendations[0]?.forecastLabel ?? "3 months";
  const recommendationMap = new Map(recommendations.map((entry) => [entry.itemId, entry]));

  const filteredItems = allItems.filter((item) => {
    const recommendation = recommendationMap.get(item.id);
    const compareMinQty = recommendation?.compareMinQty ?? true;
    const suggestedMinQty90Day = recommendation?.suggestedMinQty90Day ?? 0;
    const suggestedReorderQty90Day = recommendation?.suggestedReorderQty90Day ?? 0;

    if (recommendationFilter === "different") return compareMinQty && item.minQty !== suggestedMinQty90Day;
    if (recommendationFilter === "same") return compareMinQty && item.minQty === suggestedMinQty90Day;
    if (recommendationFilter === "needsReorder") return suggestedReorderQty90Day > 0;
    return true;
  });

  const sortedItems = [...filteredItems].sort((left, right) => {
    const leftRecommendation = recommendationMap.get(left.id);
    const rightRecommendation = recommendationMap.get(right.id);

    const leftValue = (() => {
      switch (sort) {
        case "createdAt":
          return left.createdAt;
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
        case "suggestedMinQty90Day":
          return leftRecommendation?.suggestedMinQty90Day ?? 0;
        case "suggestedReorderQty90Day":
          return leftRecommendation?.suggestedReorderQty90Day ?? 0;
        case "updatedAt":
        default:
          return left.updatedAt;
      }
    })();

    const rightValue = (() => {
      switch (sort) {
        case "createdAt":
          return right.createdAt;
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
        case "suggestedMinQty90Day":
          return rightRecommendation?.suggestedMinQty90Day ?? 0;
        case "suggestedReorderQty90Day":
          return rightRecommendation?.suggestedReorderQty90Day ?? 0;
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
  const skip = (page - 1) * perPage;
  const items = sortedItems.slice(skip, skip + perPage);

  const initialItems = items.map((r) => ({
    ...r,
    cost: r.cost ? String(r.cost) : null,
    price: r.price ? String(r.price) : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    suggestedMinQty90Day: recommendationMap.get(r.id)?.suggestedMinQty90Day ?? 0,
    suggestedReorderQty90Day: recommendationMap.get(r.id)?.suggestedReorderQty90Day ?? 0,
    usage30Day: recommendationMap.get(r.id)?.usage30Day ?? 0,
    avgDailyUsage30Day: recommendationMap.get(r.id)?.avgDailyUsage30Day ?? 0,
    compareMinQty: recommendationMap.get(r.id)?.compareMinQty ?? true,
  }));

  const shell: CSSProperties = { padding: 16 };

  const card: CSSProperties = {
    border: "1px solid rgba(128,128,128,0.25)",
    borderRadius: 12,
    padding: 12,
    background: "var(--background)",
    color: "var(--foreground)",
  };

  const field: CSSProperties = {
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(128,128,128,0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
    outline: "none",
  };

  const label: CSSProperties = { display: "grid", gap: 6, minWidth: 0, fontSize: 12, fontWeight: 800, opacity: 0.95 };

  const btn: CSSProperties = {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid rgba(128,128,128,0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
    fontWeight: 900,
    cursor: "pointer",
    lineHeight: 1,
    whiteSpace: "nowrap",
  };

  const btnPrimary: CSSProperties = {
    ...btn,
    background: "rgba(76, 175, 80, 0.16)",
    border: "1px solid rgba(76, 175, 80, 0.45)",
  };

  return (
    <div style={shell}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Admin: Items</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <Link href="/admin/items" style={{ textDecoration: "none" }}>
            Items
          </Link>
        </div>
      </div>

      {errMsg ? (
        <div
          style={{
            ...card,
            marginBottom: 12,
            border: "1px solid rgba(244,67,54,0.45)",
            background: "rgba(244,67,54,0.10)",
            fontWeight: 800,
          }}
        >
          Error: {errMsg}
        </div>
      ) : null}

      <form
        method="GET"
        style={{
          ...card,
          marginBottom: 12,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "end",
        }}
      >
        <input type="hidden" name="q" value={qRaw} />
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
            <option value="createdAt">Created</option>
            <option value="sku">SKU</option>
            <option value="partNumber">Part #</option>
            <option value="name">Name</option>
            <option value="category">Category</option>
            <option value="cost">Cost</option>
            <option value="price">Price</option>
            <option value="taxable">Taxable</option>
            <option value="active">Active</option>
            <option value="suggestedMinQty90Day">Suggested Min (Next {forecastLabel})</option>
            <option value="suggestedReorderQty90Day">Suggested Reorder (Next {forecastLabel})</option>
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
          <button type="submit" style={btnPrimary}>
            Apply Filters
          </button>
          <Link href="/admin/items" style={{ ...btn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Reset
          </Link>
        </div>
      </form>

      {/* ✅ Create Item (collapsed until clicked) */}
      {canEditItems ? (
      <details style={{ marginBottom: 12 }}>
        <summary
          style={{
            cursor: "pointer",
            userSelect: "none",
            fontWeight: 900,
            padding: 12,
            border: "1px solid rgba(128,128,128,0.25)",
            borderRadius: 12,
            background: "var(--background)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            color: "var(--foreground)",
          }}
        >
          <span>Create Item</span>
          <span style={{ fontSize: 12, opacity: 0.75 }}>Click to expand</span>
        </summary>

        <div style={{ ...card, marginTop: 10 }}>
          <form action={createItemAction} style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
              <label style={label}>
                Name (required)
                <input name="name" placeholder="COOL CURTAIN 60ft Roll" required style={field} />
              </label>

              <div style={{ ...label, justifyContent: "end" }}>
                <div style={{ fontWeight: 900 }}>SKU</div>
                <div style={{ ...field, opacity: 0.72, display: "flex", alignItems: "center" }}>
                  Auto-generated from Loc + Shelf + Bin + item key
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
              <label style={label}>
                Loc (SKU middle)
                <input name="maintLoc" placeholder="03 or Vault" required style={field} />
              </label>

              <label style={label}>
                Shelf (SKU middle)
                <input name="maintShelf" placeholder="18" inputMode="numeric" pattern="\d{1,2}" required style={field} />
              </label>

              <label style={label}>
                Bin (SKU middle)
                <input name="maintBin" placeholder="02" inputMode="numeric" pattern="\d{1,2}" required style={field} />
              </label>
            </div>

            <div style={{ fontSize: 12, opacity: 0.75, marginTop: -2 }}>
              SKU is generated automatically as <code>LLSSBB - KEY</code> (or <code>VTSSBB - KEY</code> for Vault).
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
              <label style={label}>
                Part #
                <input name="partNumber" placeholder="WR066" style={field} />
              </label>

              <label style={label}>
                Vendor
                <select name="vendor" defaultValue="SUCCESS_PLUS" style={field}>
                  <option value="SUCCESS_PLUS">SUCCESS_PLUS</option>
                  <option value="AMERICAN_PLUS">AMERICAN_PLUS</option>
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
              <label style={label}>
                Category
                <input name="category" placeholder="OVEN" style={field} />
              </label>

              <label style={label}>
                Manufacturer
                <input name="manufacturer" placeholder="HOSHIZAKI" style={field} />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
              <label style={label}>
                Order From
                <input name="orderFrom" placeholder="CCI Industries" style={field} />
              </label>

              <label style={label}>
                Web URL
                <input name="webUrl" placeholder="https://…" style={field} />
              </label>
            </div>

            <label style={label}>
              Description
              <input name="description" placeholder="Optional description…" style={field} />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
              <label style={label}>
                Cost
                <input name="cost" placeholder="0.00" inputMode="decimal" style={field} />
              </label>

              <label style={label}>
                Price
                <input name="price" placeholder="0.00" inputMode="decimal" style={field} />
              </label>

              <label style={label}>
                Min Qty
                <input name="minQty" type="number" min={0} step={1} defaultValue={0} style={field} />
              </label>
            </div>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 900 }}>
                <input type="checkbox" name="taxable" defaultChecked />
                Taxable
              </label>

              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 900 }}>
                <input type="checkbox" name="active" defaultChecked />
                Active
              </label>

              <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                <button type="submit" style={btnPrimary}>
                  Create Item
                </button>
              </div>
            </div>

            <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.4 }}>
              Creates the item and writes an initial <b>ItemVersion</b> snapshot (version 1).
            </div>
          </form>
        </div>
      </details>
      ) : (
        <div style={{ ...card, marginBottom: 12, opacity: 0.82 }}>
          You have view-only access to items. Edit permissions are required to create items.
        </div>
      )}

      <ItemsTableClient
        initialItems={initialItems}
        createdSku={createdSku}
        page={page}
        perPage={perPage}
        total={total}
        forecastLabel={forecastLabel}
        vendorFormulas={vendorFormulas}
        canEdit={canEditItems}
      />
    </div>
  );
}
