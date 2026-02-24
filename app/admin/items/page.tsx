// app/admin/items/page.tsx
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Prisma, Permission, InvoiceVendor } from "@prisma/client";

import ItemsToolbar from "./ItemsToolbar";
import ItemsTableClient from "./ItemsTableClient";
import { loadUserPermissions, hasAnyPermission } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  active?: string; // all | true | false

  // pagination + sorting
  page?: string; // 1-based
  perPage?: string; // 10/25/50/100
  sort?: string; // sku | partNumber | name | category | manufacturer | orderFrom | cost | price | taxable | active | updatedAt | createdAt
  dir?: string; // asc | desc

  // optional highlight
  createdSku?: string;
};

async function requireItemsAdminView() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return session;

  const ok = hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS]);
  if (!ok) redirect("/");

  return session;
}

function asInt(v: string | undefined, fallback: number) {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseDir(v: string | undefined): "asc" | "desc" {
  return v === "asc" ? "asc" : "desc";
}

function parseActive(v: string | undefined): boolean | null {
  if (!v || v === "all") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function normalizeQ(v: string | undefined): string {
  const s = (v || "").trim();
  if (!s) return "";
  return s.replace(/\s+/g, " ");
}

function tokenizeQ(q: string): string[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return s
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function parsePerPage(v: string | undefined): number {
  const n = asInt(v, 25);
  const allowed = new Set([10, 25, 50, 100]);
  return allowed.has(n) ? n : 25;
}

type SortKey =
  | "sku"
  | "partNumber"
  | "name"
  | "category"
  | "manufacturer"
  | "orderFrom"
  | "cost"
  | "price"
  | "taxable"
  | "active"
  | "updatedAt"
  | "createdAt";

function parseSort(v: string | undefined): SortKey {
  // Back-compat: older URLs may still use sort=unit. Treat it as name.
  if (v === "unit") return "name";

  const allowed: SortKey[] = [
    "sku",
    "partNumber",
    "name",
    "category",
    "manufacturer",
    "orderFrom",
    "cost",
    "price",
    "taxable",
    "active",
    "updatedAt",
    "createdAt",
  ];
  if (v && (allowed as string[]).includes(v)) return v as SortKey;
  return "updatedAt";
}

function buildWhere(tokens: string[], activeFilter: boolean | null): Prisma.ItemWhereInput {
  const and: Prisma.ItemWhereInput[] = [];

  if (activeFilter !== null) {
    and.push({ active: activeFilter });
  }

  for (const t of tokens) {
    and.push({
      OR: [
        { sku: { contains: t, mode: "insensitive" } },
        { partNumber: { contains: t, mode: "insensitive" } },
        { name: { contains: t, mode: "insensitive" } },
        { category: { contains: t, mode: "insensitive" } },
        { manufacturer: { contains: t, mode: "insensitive" } },
        { orderFrom: { contains: t, mode: "insensitive" } },
      ],
    });
  }

  return and.length ? { AND: and } : {};
}

export default async function ItemsAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireItemsAdminView();

  const sp = await searchParams;

  const q = normalizeQ(sp.q);
  const tokens = tokenizeQ(q);
  const activeFilter = parseActive(sp.active);

  const page = clamp(asInt(sp.page, 1), 1, 10_000);
  const perPage = parsePerPage(sp.perPage);
  const sort = parseSort(sp.sort);
  const dir = parseDir(sp.dir);

  const createdSku = typeof sp.createdSku === "string" ? sp.createdSku.trim() || null : null;

  const where: Prisma.ItemWhereInput = buildWhere(tokens, activeFilter);

  // ✅ Stable pagination ordering: primary sort + deterministic tie-breaker
  const orderBy: Prisma.ItemOrderByWithRelationInput[] = [{ [sort]: dir }, { id: dir }];

  const [total, items, vendorConfigs] = await Promise.all([
    prisma.item.count({ where }),
    prisma.item.findMany({
      where,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
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

        onHandQty: true,
        orderedQty: true,
        usedQty: true,
        minQty: true,

        manufacturer: true,
        orderFrom: true,
        webUrl: true,
      },
    }),
    prisma.invoiceVendorConfig.findMany({
      select: { vendor: true, taxFormula: true },
    }),
  ]);

  const vendorFormulas: Record<"SUCCESS_PLUS" | "AMERICAN_PLUS", string> = {
    SUCCESS_PLUS: "lineSubtotal * (taxRatePct / 100)",
    AMERICAN_PLUS: "lineSubtotal * (taxRatePct / 100)",
  };

  for (const vc of vendorConfigs) {
    if (vc.vendor === InvoiceVendor.SUCCESS_PLUS) vendorFormulas.SUCCESS_PLUS = vc.taxFormula;
    if (vc.vendor === InvoiceVendor.AMERICAN_PLUS) vendorFormulas.AMERICAN_PLUS = vc.taxFormula;
  }

  const initialItems = items.map((it) => ({
    id: it.id,
    sku: it.sku,
    partNumber: it.partNumber,
    vendor: it.vendor,
    name: it.name,
    description: it.description,
    category: it.category,
    unit: null as string | null, // legacy tolerated
    cost: it.cost == null ? null : it.cost.toString(),
    price: it.price == null ? null : it.price.toString(),
    taxable: it.taxable,
    active: it.active,
    createdAt: it.createdAt.toISOString(),
    updatedAt: it.updatedAt.toISOString(),

    onHandQty: it.onHandQty,
    orderedQty: it.orderedQty,
    usedQty: it.usedQty,
    minQty: it.minQty,

    manufacturer: it.manufacturer,
    orderFrom: it.orderFrom,
    webUrl: it.webUrl,
  }));

  return (
    <div style={{ padding: 24 }}>
      <ItemsToolbar />
      <div style={{ height: 12 }} />

      <ItemsTableClient
        initialItems={initialItems}
        createdSku={createdSku}
        page={page}
        perPage={perPage}
        total={total}
        vendorFormulas={vendorFormulas}
      />
    </div>
  );
}