import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
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
  includeIgnored?: string;
  focus?: string;
  ok?: string;
  view?: string;
  sortBy?: string;
  sortDir?: string;
  sku?: string;
  item?: string;
  part?: string;
  supplier?: string;
  manufacturer?: string;
  status?: string;
  onHand?: string;
  ordered?: string;
  available?: string;
  min?: string;
  shortBy?: string;
  techReq?: string;
  ignored?: string;
};

type SortField =
  | "priority"
  | "sku"
  | "name"
  | "partNumber"
  | "orderFrom"
  | "manufacturer"
  | "onHandQty"
  | "orderedQty"
  | "available"
  | "minQty"
  | "shortBy"
  | "status"
  | "openTechRequests"
  | "reorderIgnored";

type SortDir = "asc" | "desc";

const SORT_FIELDS: Array<{ value: SortField; label: string }> = [
  { value: "priority", label: "Priority" },
  { value: "sku", label: "SKU" },
  { value: "name", label: "Item Name" },
  { value: "partNumber", label: "Part Number" },
  { value: "orderFrom", label: "Supplier" },
  { value: "manufacturer", label: "Manufacturer" },
  { value: "onHandQty", label: "On Hand" },
  { value: "orderedQty", label: "Ordered" },
  { value: "available", label: "Available" },
  { value: "minQty", label: "Min" },
  { value: "shortBy", label: "Short By" },
  { value: "status", label: "Status" },
  { value: "openTechRequests", label: "Tech Requests" },
  { value: "reorderIgnored", label: "Ignored" },
];

function parseSortField(v: string | undefined): SortField {
  const raw = String(v ?? "").trim();
  return SORT_FIELDS.some((f) => f.value === raw) ? (raw as SortField) : "priority";
}

function parseSortDir(v: string | undefined): SortDir {
  return String(v ?? "").trim().toLowerCase() === "desc" ? "desc" : "asc";
}

function cmpNullableString(a: string | null, b: string | null): number {
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { sensitivity: "base" });
}

async function requireReportView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return { perms };

  const ok = hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) redirect("/");

  return { perms };
}

function boolFromQuery(v: string | undefined): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue;
    const t = v.trim();
    if (!t) continue;
    sp.set(k, t);
  }
  const out = sp.toString();
  return out ? `?${out}` : "";
}

function normalizeExternalUrl(v: string | null): string | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function includesCI(value: string | null | undefined, needle: string): boolean {
  const n = String(needle || "").trim().toLowerCase();
  if (!n) return true;
  return String(value ?? "").toLowerCase().includes(n);
}

function numEquals(value: number, rawFilter: string): boolean {
  const f = String(rawFilter || "").trim();
  if (!f) return true;
  const n = Number(f);
  if (!Number.isFinite(n)) return true;
  return value === n;
}

function normSupplier(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim();
  return trimmed || "Unassigned Supplier";
}

function normSupplierGroupKey(value: string | null | undefined): string {
  return normSupplier(value).toLocaleLowerCase();
}

function money(v: number): string {
  if (!Number.isFinite(v)) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
}

function decimalToNumber(v: Prisma.Decimal | null | undefined): number {
  if (!v) return 0;
  const n = Number(v.toString());
  return Number.isFinite(n) ? n : 0;
}

function techRequestedStatus(requesters: string | null | undefined): string {
  const names = String(requesters ?? "").trim();
  return names ? `Tech Requested: ${names}` : "Tech Requested";
}

function needsOrderingStatusLabel(row: {
  reorderIgnored: boolean;
  priority: "blue" | "red" | "yellow";
  techRequesters: string | null;
}): string {
  if (row.reorderIgnored) return "Ignored";
  if (row.priority === "blue") return techRequestedStatus(row.techRequesters);
  if (row.priority === "red") return "Out";
  return "Below Min";
}

export default async function NeedsOrderingReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { perms } = await requireReportView();
  const canEdit = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);

  const sp = await searchParams;
  const q = String(sp.q ?? "").trim();
  const includeIgnored = boolFromQuery(sp.includeIgnored);
  const focusRaw = String(sp.focus ?? "").trim().toLowerCase();
  const focus: "all" | "red" | "yellow" =
    focusRaw === "red" || focusRaw === "yellow" ? focusRaw : "all";
  const okMsg = String(sp.ok ?? "").trim();
  const viewRaw = String(sp.view ?? "").trim().toLowerCase();
  const groupedBySupplier = viewRaw === "supplier";
  const sortBy = parseSortField(sp.sortBy);
  const sortDir = parseSortDir(sp.sortDir);
  const skuFilter = String(sp.sku ?? "").trim();
  const itemFilter = String(sp.item ?? "").trim();
  const partFilter = String(sp.part ?? "").trim();
  const supplierFilter = String(sp.supplier ?? "").trim();
  const manufacturerFilter = String(sp.manufacturer ?? "").trim();
  const statusFilter = String(sp.status ?? "").trim().toLowerCase();
  const onHandFilter = String(sp.onHand ?? "").trim();
  const orderedFilter = String(sp.ordered ?? "").trim();
  const availableFilter = String(sp.available ?? "").trim();
  const minFilter = String(sp.min ?? "").trim();
  const shortByFilter = String(sp.shortBy ?? "").trim();
  const techReqFilter = String(sp.techReq ?? "").trim();
  const ignoredFilter = String(sp.ignored ?? "").trim().toLowerCase();

  async function setIgnoredAction(formData: FormData) {
    "use server";

    const { perms } = await requireReportView();
    const canEdit = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
    if (!canEdit) throw new Error("Forbidden");

    const itemId = String(formData.get("itemId") ?? "").trim();
    const nextIgnored = String(formData.get("nextIgnored") ?? "").trim() === "1";

    const qBack = String(formData.get("q") ?? "").trim();
    const includeIgnoredBack = String(formData.get("includeIgnored") ?? "").trim();
    const focusBack = String(formData.get("focus") ?? "").trim();
    const sortByBack = String(formData.get("sortBy") ?? "").trim();
    const sortDirBack = String(formData.get("sortDir") ?? "").trim();
    const viewBack = String(formData.get("view") ?? "").trim();
    const skuBack = String(formData.get("sku") ?? "").trim();
    const itemBack = String(formData.get("item") ?? "").trim();
    const partBack = String(formData.get("part") ?? "").trim();
    const supplierBack = String(formData.get("supplier") ?? "").trim();
    const manufacturerBack = String(formData.get("manufacturer") ?? "").trim();
    const statusBack = String(formData.get("status") ?? "").trim();
    const onHandBack = String(formData.get("onHand") ?? "").trim();
    const orderedBack = String(formData.get("ordered") ?? "").trim();
    const availableBack = String(formData.get("available") ?? "").trim();
    const minBack = String(formData.get("min") ?? "").trim();
    const shortByBack = String(formData.get("shortBy") ?? "").trim();
    const techReqBack = String(formData.get("techReq") ?? "").trim();
    const ignoredBack = String(formData.get("ignored") ?? "").trim();

    if (!itemId) {
      redirect(
        `/admin/reports/needs-ordering${qs({
          q: qBack || undefined,
          includeIgnored: includeIgnoredBack || undefined,
          focus: focusBack || undefined,
          sortBy: sortByBack || undefined,
          sortDir: sortDirBack || undefined,
          view: viewBack || undefined,
          sku: skuBack || undefined,
          item: itemBack || undefined,
          part: partBack || undefined,
          supplier: supplierBack || undefined,
          manufacturer: manufacturerBack || undefined,
          status: statusBack || undefined,
          onHand: onHandBack || undefined,
          ordered: orderedBack || undefined,
          available: availableBack || undefined,
          min: minBack || undefined,
          shortBy: shortByBack || undefined,
          techReq: techReqBack || undefined,
          ignored: ignoredBack || undefined,
          ok: "Missing item id",
        })}`
      );
    }

    await prisma.$executeRaw`
      UPDATE "Item"
      SET "reorderIgnored" = ${nextIgnored},
          "updatedAt" = NOW()
      WHERE "id" = ${itemId}
    `;

    revalidatePath("/admin/reports/needs-ordering");
    redirect(
      `/admin/reports/needs-ordering${qs({
        q: qBack || undefined,
        includeIgnored: includeIgnoredBack || undefined,
        focus: focusBack || undefined,
        sortBy: sortByBack || undefined,
        sortDir: sortDirBack || undefined,
        view: viewBack || undefined,
        sku: skuBack || undefined,
        item: itemBack || undefined,
        part: partBack || undefined,
        supplier: supplierBack || undefined,
        manufacturer: manufacturerBack || undefined,
        status: statusBack || undefined,
        onHand: onHandBack || undefined,
        ordered: orderedBack || undefined,
        available: availableBack || undefined,
        min: minBack || undefined,
        shortBy: shortByBack || undefined,
        techReq: techReqBack || undefined,
        ignored: ignoredBack || undefined,
        ok: nextIgnored ? "Item ignored" : "Item restored",
      })}`
    );
  }

  type NeedsOrderingRow = {
    id: string;
    sku: string;
    partNumber: string | null;
    name: string;
    cost: Prisma.Decimal | null;
    orderFrom: string | null;
    manufacturer: string | null;
    webUrl: string | null;
    onHandQty: number;
    orderedQty: number;
    minQty: number;
    reorderIgnored: boolean;
    openTechRequests: number;
    techRequesters: string | null;
  };

  const like = `%${q}%`;
  const rows = await prisma.$queryRaw<NeedsOrderingRow[]>(Prisma.sql`
    WITH tech_req AS (
      SELECT
        ia."itemId",
        COUNT(*)::int AS "openTechRequests",
        COALESCE(
          STRING_AGG(
            DISTINCT NULLIF(BTRIM(COALESCE(ia."createdByName", u."name", u."email", '')), ''),
            ', '
          ),
          ''
        ) AS "techRequesters"
      FROM "InventoryAlert" ia
      INNER JOIN "PartsCheckoutTicket" pct ON pct."id" = ia."checkoutId"
      LEFT JOIN "User" u ON u."id" = ia."createdByUserId"
      WHERE ia."type" = 'TECH_REQUEST_ORDER'::"InventoryAlertType"
        AND ia."resolvedAt" IS NULL
        AND pct."needToOrderMore" = true
      GROUP BY ia."itemId"
    ),
    active_order_history AS (
      SELECT DISTINCT io."itemId"
      FROM "InventoryOrder" io
      WHERE io."status" IN ('ORDERED'::"InventoryOrderStatus", 'ARRIVED'::"InventoryOrderStatus")
    )
    SELECT
      i."id",
      i."sku",
      i."partNumber",
      i."name",
      i."cost",
      i."orderFrom",
      i."manufacturer",
      i."webUrl",
      i."onHandQty",
      i."orderedQty",
      i."minQty",
      i."reorderIgnored",
      COALESCE(t."openTechRequests", 0) AS "openTechRequests",
      COALESCE(t."techRequesters", '') AS "techRequesters"
    FROM "Item" i
    LEFT JOIN tech_req t ON t."itemId" = i."id"
    LEFT JOIN active_order_history aoh ON aoh."itemId" = i."id"
    WHERE "active" = true
      AND aoh."itemId" IS NULL
      AND (
        i."minQty" > (i."onHandQty" + i."orderedQty")
        OR COALESCE(t."openTechRequests", 0) > 0
      )
      AND ${
        q
          ? Prisma.sql`(
              i."sku" ILIKE ${like}
              OR i."name" ILIKE ${like}
              OR COALESCE(i."partNumber", '') ILIKE ${like}
              OR COALESCE(i."orderFrom", '') ILIKE ${like}
              OR COALESCE(i."manufacturer", '') ILIKE ${like}
            )`
          : Prisma.sql`TRUE`
      }
      AND ${includeIgnored ? Prisma.sql`TRUE` : Prisma.sql`i."reorderIgnored" = false`}
    ORDER BY i."reorderIgnored" ASC, i."sku" ASC
  `);

  const needsOrdering = rows
    .map((item) => {
      const available = item.onHandQty + item.orderedQty;
      const shortBy = Math.max(0, item.minQty - available);
      const hasTechRequest = item.openTechRequests > 0;
      const isBelowMin = shortBy > 0;
      const priority: "blue" | "red" | "yellow" = isBelowMin
        ? available <= 0
          ? "red"
          : "yellow"
        : "blue";
      const statusText = needsOrderingStatusLabel({ ...item, priority });
      return { ...item, available, shortBy, hasTechRequest, priority, statusText };
    })
    .filter((item) => item.shortBy > 0 || item.hasTechRequest)
    .filter((item) => (focus === "all" ? true : item.priority === focus))
    .filter((item) => includesCI(item.sku, skuFilter))
    .filter((item) => includesCI(item.name, itemFilter))
    .filter((item) => includesCI(item.partNumber, partFilter))
    .filter((item) => includesCI(item.orderFrom, supplierFilter))
    .filter((item) => includesCI(item.manufacturer, manufacturerFilter))
    .filter((item) => includesCI(item.statusText, statusFilter))
    .filter((item) => numEquals(item.onHandQty, onHandFilter))
    .filter((item) => numEquals(item.orderedQty, orderedFilter))
    .filter((item) => numEquals(item.available, availableFilter))
    .filter((item) => numEquals(item.minQty, minFilter))
    .filter((item) => numEquals(item.shortBy, shortByFilter))
    .filter((item) => numEquals(item.openTechRequests, techReqFilter))
    .filter((item) => {
      if (!ignoredFilter) return true;
      if (["yes", "true", "1", "ignored"].includes(ignoredFilter)) return item.reorderIgnored;
      if (["no", "false", "0", "active"].includes(ignoredFilter)) return !item.reorderIgnored;
      return true;
    })
    .sort((a, b) => {
      const priorityRank = { blue: 0, red: 1, yellow: 2 } as const;
      const statusRank = { "Tech Requested": 0, Out: 1, "Below Min": 2, Ignored: 3 } as const;

      let base = 0;
      switch (sortBy) {
        case "priority":
          base = priorityRank[a.priority] - priorityRank[b.priority];
          break;
        case "sku":
          base = a.sku.localeCompare(b.sku, undefined, { sensitivity: "base" });
          break;
        case "name":
          base = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
          break;
        case "partNumber":
          base = cmpNullableString(a.partNumber, b.partNumber);
          break;
        case "orderFrom":
          base = cmpNullableString(a.orderFrom, b.orderFrom);
          break;
        case "manufacturer":
          base = cmpNullableString(a.manufacturer, b.manufacturer);
          break;
        case "onHandQty":
          base = a.onHandQty - b.onHandQty;
          break;
        case "orderedQty":
          base = a.orderedQty - b.orderedQty;
          break;
        case "available":
          base = a.available - b.available;
          break;
        case "minQty":
          base = a.minQty - b.minQty;
          break;
        case "shortBy":
          base = a.shortBy - b.shortBy;
          break;
        case "status": {
          const aStatus = a.reorderIgnored
            ? "Ignored"
            : a.priority === "blue"
              ? "Tech Requested"
              : a.priority === "red"
                ? "Out"
                : "Below Min";
          const bStatus = b.reorderIgnored
            ? "Ignored"
            : b.priority === "blue"
              ? "Tech Requested"
              : b.priority === "red"
                ? "Out"
                : "Below Min";
          base = statusRank[aStatus] - statusRank[bStatus];
          break;
        }
        case "openTechRequests":
          base = a.openTechRequests - b.openTechRequests;
          break;
        case "reorderIgnored":
          base = Number(a.reorderIgnored) - Number(b.reorderIgnored);
          break;
        default:
          base = 0;
          break;
      }

      const dirFactor = sortDir === "desc" ? -1 : 1;
      if (base !== 0) return base * dirFactor;

      const secondary = a.sku.localeCompare(b.sku, undefined, { sensitivity: "base" });
      if (secondary !== 0) return secondary;

      return a.id.localeCompare(b.id);
    });

  const sortLabel = SORT_FIELDS.find((f) => f.value === sortBy)?.label ?? "Priority";

  const activeCount = needsOrdering.filter((x) => !x.reorderIgnored).length;
  const ignoredCount = needsOrdering.filter((x) => x.reorderIgnored).length;
  const redCount = needsOrdering.filter((x) => x.priority === "red").length;
  const yellowCount = needsOrdering.filter((x) => x.priority === "yellow").length;
  const blueCount = needsOrdering.filter((x) => x.priority === "blue").length;
  const orderMoreItems = needsOrdering.filter((x) => x.hasTechRequest && x.shortBy === 0);

  const supplierGroups = Array.from(
    needsOrdering.reduce((map, row) => {
      const supplier = normSupplier(row.orderFrom);
      const key = normSupplierGroupKey(row.orderFrom);
      const bucket = map.get(key) ?? { supplier, items: [] as typeof needsOrdering };
      bucket.items.push(row);
      map.set(key, bucket);
      return map;
    }, new Map<string, { supplier: string; items: typeof needsOrdering }>())
  )
    .map(([, group]) => group)
    .sort((a, b) => a.supplier.localeCompare(b.supplier, undefined, { sensitivity: "base" }))
    .map((group) => ({
      supplier: group.supplier,
      subtotal: group.items.reduce((sum, row) => sum + row.shortBy * decimalToNumber(row.cost), 0),
      items: [...group.items].sort((a, b) => {
        const shortDiff = b.shortBy - a.shortBy;
        if (shortDiff !== 0) return shortDiff;
        return a.sku.localeCompare(b.sku, undefined, { sensitivity: "base" });
      }),
    }));

  const groupedEstimatedSubtotal = supplierGroups.reduce((sum, group) => sum + group.subtotal, 0);
  const groupedEstimatedUnits = supplierGroups.reduce(
    (sum, group) => sum + group.items.reduce((groupSum, row) => groupSum + row.shortBy, 0),
    0
  );

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1300, margin: "0 auto", color: "var(--foreground)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Report: Needs Ordering</h1>

          <Link
            href="/admin/reports"
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
            ← Report Hub
          </Link>
        </div>

        <div style={{ marginTop: 8, opacity: 0.85, lineHeight: 1.5 }}>
          Items where <code>onHand + ordered &lt; min</code> are listed here. Items flagged from checkout as &quot;Need to order
          more&quot; are also included and highlighted in magenta when they are not already short. Use Ignore to hide
          non-actionable rows.
        </div>

        {okMsg ? (
          <div style={{ marginTop: 10, padding: 10, border: "1px solid rgba(128,128,128,0.25)", borderRadius: 10 }}>
            {okMsg}
          </div>
        ) : null}

        <form method="get" style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            name="q"
            defaultValue={q}
            placeholder="Search sku, item, part, supplier..."
            style={{
              minWidth: 280,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(128,128,128,0.25)",
              background: "var(--background)",
              color: "var(--foreground)",
            }}
          />

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" name="includeIgnored" value="1" defaultChecked={includeIgnored} />
            Include ignored
          </label>

          <input type="hidden" name="focus" value={focus} />
          <input type="hidden" name="view" value={groupedBySupplier ? "supplier" : "table"} />

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Sort By
            <select
              name="sortBy"
              defaultValue={sortBy}
              style={{
                padding: "9px 10px",
                borderRadius: 10,
                border: "1px solid rgba(128,128,128,0.25)",
                background: "var(--background)",
                color: "var(--foreground)",
              }}
            >
              {SORT_FIELDS.map((field) => (
                <option key={field.value} value={field.value}>
                  {field.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Direction
            <select
              name="sortDir"
              defaultValue={sortDir}
              style={{
                padding: "9px 10px",
                borderRadius: 10,
                border: "1px solid rgba(128,128,128,0.25)",
                background: "var(--background)",
                color: "var(--foreground)",
              }}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>

          <div style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
            <input name="sku" defaultValue={skuFilter} placeholder="Filter SKU" style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid rgba(128,128,128,0.25)", background: "var(--background)", color: "var(--foreground)" }} />
            <input name="item" defaultValue={itemFilter} placeholder="Filter Item" style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid rgba(128,128,128,0.25)", background: "var(--background)", color: "var(--foreground)" }} />
            <input name="part" defaultValue={partFilter} placeholder="Filter Part #" style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid rgba(128,128,128,0.25)", background: "var(--background)", color: "var(--foreground)" }} />
            <input name="supplier" defaultValue={supplierFilter} placeholder="Filter Supplier" style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid rgba(128,128,128,0.25)", background: "var(--background)", color: "var(--foreground)" }} />
            <input name="manufacturer" defaultValue={manufacturerFilter} placeholder="Filter Manufacturer" style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid rgba(128,128,128,0.25)", background: "var(--background)", color: "var(--foreground)" }} />
            <input name="status" defaultValue={statusFilter} placeholder="Filter Status" style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid rgba(128,128,128,0.25)", background: "var(--background)", color: "var(--foreground)" }} />
            <input name="onHand" defaultValue={onHandFilter} placeholder="On Hand =" style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid rgba(128,128,128,0.25)", background: "var(--background)", color: "var(--foreground)" }} />
            <input name="ordered" defaultValue={orderedFilter} placeholder="Ordered =" style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid rgba(128,128,128,0.25)", background: "var(--background)", color: "var(--foreground)" }} />
            <input name="available" defaultValue={availableFilter} placeholder="Available =" style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid rgba(128,128,128,0.25)", background: "var(--background)", color: "var(--foreground)" }} />
            <input name="min" defaultValue={minFilter} placeholder="Min =" style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid rgba(128,128,128,0.25)", background: "var(--background)", color: "var(--foreground)" }} />
            <input name="shortBy" defaultValue={shortByFilter} placeholder="Short By =" style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid rgba(128,128,128,0.25)", background: "var(--background)", color: "var(--foreground)" }} />
            <input name="techReq" defaultValue={techReqFilter} placeholder="Tech Requests =" style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid rgba(128,128,128,0.25)", background: "var(--background)", color: "var(--foreground)" }} />
            <input name="ignored" defaultValue={ignoredFilter} placeholder="Ignored (yes/no)" style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid rgba(128,128,128,0.25)", background: "var(--background)", color: "var(--foreground)" }} />
          </div>

          <button
            type="submit"
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(128,128,128,0.25)",
              background: "var(--background)",
              color: "var(--foreground)",
              fontWeight: 900,
            }}
          >
            Apply
          </button>

          <Link href="/admin/reports/needs-ordering" style={{ textDecoration: "underline" }}>
            Reset
          </Link>

          <Link
            href={`/admin/reports/needs-ordering${qs({
              q: q || undefined,
              includeIgnored: includeIgnored ? "1" : undefined,
              focus: "red",
              view: groupedBySupplier ? "supplier" : undefined,
              sortBy,
              sortDir,
              sku: skuFilter || undefined,
              item: itemFilter || undefined,
              part: partFilter || undefined,
              supplier: supplierFilter || undefined,
              manufacturer: manufacturerFilter || undefined,
              status: statusFilter || undefined,
              onHand: onHandFilter || undefined,
              ordered: orderedFilter || undefined,
              available: availableFilter || undefined,
              min: minFilter || undefined,
              shortBy: shortByFilter || undefined,
              techReq: techReqFilter || undefined,
              ignored: ignoredFilter || undefined,
            })}`}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: focus === "red" ? "1px solid rgba(220,38,38,0.8)" : "1px solid rgba(220,38,38,0.45)",
              background: focus === "red" ? "rgba(220,38,38,0.2)" : "rgba(220,38,38,0.10)",
              color: "var(--foreground)",
              fontWeight: 900,
              textDecoration: "none",
            }}
          >
            Red Items
          </Link>

          <Link
            href={`/admin/reports/needs-ordering${qs({
              q: q || undefined,
              includeIgnored: includeIgnored ? "1" : undefined,
              focus: "yellow",
              view: groupedBySupplier ? "supplier" : undefined,
              sortBy,
              sortDir,
              sku: skuFilter || undefined,
              item: itemFilter || undefined,
              part: partFilter || undefined,
              supplier: supplierFilter || undefined,
              manufacturer: manufacturerFilter || undefined,
              status: statusFilter || undefined,
              onHand: onHandFilter || undefined,
              ordered: orderedFilter || undefined,
              available: availableFilter || undefined,
              min: minFilter || undefined,
              shortBy: shortByFilter || undefined,
              techReq: techReqFilter || undefined,
              ignored: ignoredFilter || undefined,
            })}`}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: focus === "yellow" ? "1px solid rgba(245,158,11,0.85)" : "1px solid rgba(245,158,11,0.5)",
              background: focus === "yellow" ? "rgba(245,158,11,0.22)" : "rgba(245,158,11,0.12)",
              color: "var(--foreground)",
              fontWeight: 900,
              textDecoration: "none",
            }}
          >
            Yellow Items
          </Link>

          <Link
            href={`/admin/reports/needs-ordering${qs({
              q: q || undefined,
              includeIgnored: includeIgnored ? "1" : undefined,
              focus,
              view: groupedBySupplier ? undefined : "supplier",
              sortBy,
              sortDir,
              sku: skuFilter || undefined,
              item: itemFilter || undefined,
              part: partFilter || undefined,
              supplier: supplierFilter || undefined,
              manufacturer: manufacturerFilter || undefined,
              status: statusFilter || undefined,
              onHand: onHandFilter || undefined,
              ordered: orderedFilter || undefined,
              available: availableFilter || undefined,
              min: minFilter || undefined,
              shortBy: shortByFilter || undefined,
              techReq: techReqFilter || undefined,
              ignored: ignoredFilter || undefined,
            })}`}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: groupedBySupplier ? "1px solid rgba(16,185,129,0.85)" : "1px solid rgba(16,185,129,0.5)",
              background: groupedBySupplier ? "rgba(16,185,129,0.22)" : "rgba(16,185,129,0.12)",
              color: "var(--foreground)",
              fontWeight: 900,
              textDecoration: "none",
            }}
          >
            {groupedBySupplier ? "Show Flat Table" : "Group By Supplier"}
          </Link>
        </form>

        <div style={{ marginTop: 12, opacity: 0.9 }}>
          Showing <b>{needsOrdering.length}</b> items (Blue: <b>{blueCount}</b>, Red: <b>{redCount}</b>, Yellow: <b>{yellowCount}</b>, Active: <b>{activeCount}</b>, Ignored: <b>{ignoredCount}</b>)
        </div>

        <div style={{ marginTop: 6, opacity: 0.85, fontSize: 13 }}>
          Sorted by <b>{sortLabel}</b> ({sortDir === "asc" ? "ascending" : "descending"})
        </div>

        <div
          style={{
            marginTop: 10,
            padding: 10,
            border: "1px solid rgba(219,39,119,0.42)",
            borderRadius: 10,
            background: "rgba(219,39,119,0.12)",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Order More Flags</div>
          {orderMoreItems.length === 0 ? (
            <div style={{ opacity: 0.8 }}>No active Order More flags outside the main report.</div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {orderMoreItems.map((x) => (
                <span
                  key={`order-more-${x.id}`}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 999,
                    border: "1px solid rgba(219,39,119,0.5)",
                    background: "rgba(219,39,119,0.2)",
                    fontWeight: 800,
                    fontSize: 12,
                  }}
                >
                  {x.sku} - {x.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {groupedBySupplier ? (
          <section style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {supplierGroups.length === 0 ? (
              <div style={{ padding: 14, opacity: 0.8, border: "1px solid rgba(128,128,128,0.25)", borderRadius: 10 }}>
                No items currently need ordering for your filters.
              </div>
            ) : (
              <>
                {supplierGroups.map((group) => (
                  <details key={`supplier-${group.supplier}`} style={{ border: "1px solid rgba(128,128,128,0.25)", borderRadius: 10, overflow: "hidden" }}>
                    <summary
                      style={{
                        cursor: "pointer",
                        padding: "12px 14px",
                        fontWeight: 900,
                        background: "rgba(128,128,128,0.08)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <span>{group.supplier} ({group.items.length})</span>
                      <span style={{ whiteSpace: "nowrap" }}>Subtotal: {money(group.subtotal)}</span>
                    </summary>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                        <thead>
                          <tr>
                            {["SKU", "Item", "Web", "On Hand", "Ordered", "Available", "Min", "Short By", "Status", "Ignore"].map((h) => (
                              <th
                                key={h}
                                style={{
                                  textAlign: "left",
                                  padding: "10px",
                                  borderBottom: "1px solid rgba(128,128,128,0.25)",
                                  fontSize: 12,
                                  opacity: 0.85,
                                }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((row) => {
                            const itemUrl = normalizeExternalUrl(row.webUrl);
                            const highlight =
                              row.priority === "blue"
                                ? "rgba(219,39,119,0.16)"
                                : row.priority === "red"
                                  ? "rgba(220,38,38,0.12)"
                                  : "rgba(245,158,11,0.12)";
                            const borderTint =
                              row.priority === "blue"
                                ? "rgba(219,39,119,0.38)"
                                : row.priority === "red"
                                  ? "rgba(220,38,38,0.22)"
                                  : "rgba(245,158,11,0.24)";

                            return (
                              <tr
                                key={row.id}
                                style={{
                                  borderBottom: `1px solid ${borderTint}`,
                                  background: highlight,
                                  opacity: row.reorderIgnored ? 0.62 : 1,
                                }}
                              >
                              <td style={{ padding: 10, fontWeight: 800, wordBreak: "break-word" }}>{row.sku}</td>
                              <td style={{ padding: 10 }}>
                                <div style={{ fontWeight: 700 }}>{row.name}</div>
                                <div style={{ fontSize: 12, opacity: 0.82 }}>{row.partNumber || "—"}</div>
                                <div style={{ fontSize: 12, opacity: 0.82 }}>{row.manufacturer || ""}</div>
                              </td>
                              <td style={{ padding: 10 }}>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                  <Link
                                    href={`/admin/price-lookup?partNumber=${encodeURIComponent(String(row.partNumber || row.sku || "").trim())}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                      padding: "6px 10px",
                                      borderRadius: 10,
                                      border: "1px solid rgba(128,128,128,0.25)",
                                      background: "var(--background)",
                                      color: "var(--foreground)",
                                      fontWeight: 800,
                                      textDecoration: "none",
                                      display: "inline-block",
                                    }}
                                  >
                                    AI Lookup
                                  </Link>
                                  {itemUrl ? (
                                    <a
                                      href={itemUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{
                                        padding: "6px 10px",
                                        borderRadius: 10,
                                        border: "1px solid rgba(128,128,128,0.25)",
                                        background: "var(--background)",
                                        color: "var(--foreground)",
                                        fontWeight: 800,
                                        textDecoration: "none",
                                        display: "inline-block",
                                      }}
                                    >
                                      Open
                                    </a>
                                  ) : (
                                    <span style={{ opacity: 0.6 }}>—</span>
                                  )}
                                </div>
                              </td>
                              <td style={{ padding: 10 }}>{row.onHandQty}</td>
                              <td style={{ padding: 10 }}>{row.orderedQty}</td>
                              <td style={{ padding: 10 }}>{row.available}</td>
                              <td style={{ padding: 10 }}>{row.minQty}</td>
                              <td style={{ padding: 10, fontWeight: 900 }}>{row.shortBy}</td>
                              <td style={{ padding: 10 }}>
                                {row.statusText}
                              </td>
                              <td style={{ padding: 10 }}>
                                {canEdit ? (
                                  <form action={setIgnoredAction}>
                                    <input type="hidden" name="itemId" value={row.id} />
                                    <input type="hidden" name="nextIgnored" value={row.reorderIgnored ? "0" : "1"} />
                                    <input type="hidden" name="q" value={q} />
                                    <input type="hidden" name="includeIgnored" value={includeIgnored ? "1" : ""} />
                                    <input type="hidden" name="focus" value={focus} />
                                    <input type="hidden" name="sortBy" value={sortBy} />
                                    <input type="hidden" name="sortDir" value={sortDir} />
                                    <input type="hidden" name="view" value={groupedBySupplier ? "supplier" : "table"} />
                                    <input type="hidden" name="sku" value={skuFilter} />
                                    <input type="hidden" name="item" value={itemFilter} />
                                    <input type="hidden" name="part" value={partFilter} />
                                    <input type="hidden" name="supplier" value={supplierFilter} />
                                    <input type="hidden" name="manufacturer" value={manufacturerFilter} />
                                    <input type="hidden" name="status" value={statusFilter} />
                                    <input type="hidden" name="onHand" value={onHandFilter} />
                                    <input type="hidden" name="ordered" value={orderedFilter} />
                                    <input type="hidden" name="available" value={availableFilter} />
                                    <input type="hidden" name="min" value={minFilter} />
                                    <input type="hidden" name="shortBy" value={shortByFilter} />
                                    <input type="hidden" name="techReq" value={techReqFilter} />
                                    <input type="hidden" name="ignored" value={ignoredFilter} />
                                    <button
                                      type="submit"
                                      style={{
                                        padding: "6px 10px",
                                        borderRadius: 10,
                                        border: "1px solid rgba(128,128,128,0.25)",
                                        background: "var(--background)",
                                        color: "var(--foreground)",
                                        fontWeight: 800,
                                        cursor: "pointer",
                                      }}
                                    >
                                      {row.reorderIgnored ? "Unignore" : "Ignore"}
                                    </button>
                                  </form>
                                ) : (
                                  <span style={{ opacity: 0.65 }}>View only</span>
                                )}
                              </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}

                <div
                  style={{
                    position: "sticky",
                    bottom: 12,
                    zIndex: 5,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    alignItems: "center",
                    padding: "14px 16px",
                    borderRadius: 12,
                    border: "1px solid rgba(16,185,129,0.4)",
                    background: "rgba(16,185,129,0.12)",
                    backdropFilter: "blur(8px)",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 900 }}>GROUPED VIEW TOTAL</div>
                    <div style={{ fontSize: 13, opacity: 0.88 }}>
                      Estimated reorder for <b>{groupedEstimatedUnits}</b> units across <b>{supplierGroups.length}</b> suppliers
                    </div>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 900, whiteSpace: "nowrap" }}>
                    Estimated Subtotal: {money(groupedEstimatedSubtotal)}
                  </div>
                </div>
              </>
            )}
          </section>
        ) : (
          <div style={{ marginTop: 12, border: "1px solid rgba(128,128,128,0.25)", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead>
              <tr>
                {[
                  "SKU",
                  "Item",
                  "Supplier",
                  "Web",
                  "On Hand",
                  "Ordered",
                  "Available",
                  "Min",
                  "Short By",
                  "Status",
                  "Ignore",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "10px",
                      borderBottom: "1px solid rgba(128,128,128,0.25)",
                      fontSize: 12,
                      opacity: 0.85,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {needsOrdering.map((row) => {
                const itemUrl = normalizeExternalUrl(row.webUrl);
                const highlight =
                  row.priority === "blue"
                    ? "rgba(219,39,119,0.16)"
                    : row.priority === "red"
                    ? "rgba(220,38,38,0.12)"
                    : "rgba(245,158,11,0.12)";
                const borderTint =
                  row.priority === "blue"
                    ? "rgba(219,39,119,0.38)"
                    : row.priority === "red"
                    ? "rgba(220,38,38,0.22)"
                    : "rgba(245,158,11,0.24)";
                return (
                  <tr
                    key={row.id}
                    style={{
                      borderBottom: `1px solid ${borderTint}`,
                      background: highlight,
                      opacity: row.reorderIgnored ? 0.62 : 1,
                    }}
                  >
                  <td style={{ padding: 10, fontWeight: 800, wordBreak: "break-word" }}>{row.sku}</td>
                  <td style={{ padding: 10 }}>
                    <div style={{ fontWeight: 700 }}>{row.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.82 }}>{row.partNumber || "—"}</div>
                  </td>
                  <td style={{ padding: 10 }}>
                    <div>{row.orderFrom || "—"}</div>
                    <div style={{ fontSize: 12, opacity: 0.82 }}>{row.manufacturer || ""}</div>
                  </td>
                  <td style={{ padding: 10 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Link
                        href={`/admin/price-lookup?partNumber=${encodeURIComponent(String(row.partNumber || row.sku || "").trim())}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          padding: "6px 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(128,128,128,0.25)",
                          background: "var(--background)",
                          color: "var(--foreground)",
                          fontWeight: 800,
                          textDecoration: "none",
                          display: "inline-block",
                        }}
                      >
                        AI Lookup
                      </Link>
                      {itemUrl ? (
                        <a
                          href={itemUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: "6px 10px",
                            borderRadius: 10,
                            border: "1px solid rgba(128,128,128,0.25)",
                            background: "var(--background)",
                            color: "var(--foreground)",
                            fontWeight: 800,
                            textDecoration: "none",
                            display: "inline-block",
                          }}
                        >
                          Open
                        </a>
                      ) : (
                        <span style={{ opacity: 0.6 }}>—</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: 10 }}>{row.onHandQty}</td>
                  <td style={{ padding: 10 }}>{row.orderedQty}</td>
                  <td style={{ padding: 10 }}>{row.available}</td>
                  <td style={{ padding: 10 }}>{row.minQty}</td>
                  <td style={{ padding: 10, fontWeight: 900 }}>{row.shortBy}</td>
                  <td style={{ padding: 10 }}>
                    {row.statusText}
                  </td>
                  <td style={{ padding: 10 }}>
                    {canEdit ? (
                      <form action={setIgnoredAction}>
                        <input type="hidden" name="itemId" value={row.id} />
                        <input type="hidden" name="nextIgnored" value={row.reorderIgnored ? "0" : "1"} />
                        <input type="hidden" name="q" value={q} />
                        <input type="hidden" name="includeIgnored" value={includeIgnored ? "1" : ""} />
                        <input type="hidden" name="focus" value={focus} />
                        <input type="hidden" name="sortBy" value={sortBy} />
                        <input type="hidden" name="sortDir" value={sortDir} />
                        <input type="hidden" name="view" value={groupedBySupplier ? "supplier" : "table"} />
                        <input type="hidden" name="sku" value={skuFilter} />
                        <input type="hidden" name="item" value={itemFilter} />
                        <input type="hidden" name="part" value={partFilter} />
                        <input type="hidden" name="supplier" value={supplierFilter} />
                        <input type="hidden" name="manufacturer" value={manufacturerFilter} />
                        <input type="hidden" name="status" value={statusFilter} />
                        <input type="hidden" name="onHand" value={onHandFilter} />
                        <input type="hidden" name="ordered" value={orderedFilter} />
                        <input type="hidden" name="available" value={availableFilter} />
                        <input type="hidden" name="min" value={minFilter} />
                        <input type="hidden" name="shortBy" value={shortByFilter} />
                        <input type="hidden" name="techReq" value={techReqFilter} />
                        <input type="hidden" name="ignored" value={ignoredFilter} />
                        <button
                          type="submit"
                          style={{
                            padding: "6px 10px",
                            borderRadius: 10,
                            border: "1px solid rgba(128,128,128,0.25)",
                            background: "var(--background)",
                            color: "var(--foreground)",
                            fontWeight: 800,
                            cursor: "pointer",
                          }}
                        >
                          {row.reorderIgnored ? "Unignore" : "Ignore"}
                        </button>
                      </form>
                    ) : (
                      <span style={{ opacity: 0.65 }}>View only</span>
                    )}
                  </td>
                </tr>
                );
              })}

              {needsOrdering.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ padding: 14, opacity: 0.8 }}>
                    No items currently need ordering for your filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
