// app/api/admin/items/export/route.ts
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";
import { Permission, Prisma, InvoiceVendor } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

function parseActive(raw: string | null): boolean | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "all") return null;
  return null;
}

type SortKey =
  | "sku"
  | "partNumber"
  | "vendor"
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

function parseSort(raw: string | null): SortKey {
  const v = (raw || "").trim();

  // Back-compat: old URLs may have sort=unit (removed). Map to name.
  if (v === "unit") return "name";

  const allowed: SortKey[] = [
    "sku",
    "partNumber",
    "vendor",
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
  return allowed.includes(v as SortKey) ? (v as SortKey) : "updatedAt";
}

function parseDir(raw: string | null): "asc" | "desc" {
  return (raw || "").trim().toLowerCase() === "asc" ? "asc" : "desc";
}

function normalizeSearch(raw: string | null): string[] {
  const q = (raw || "").trim().toLowerCase();
  if (!q) return [];
  return q.split(/\s+/).map((t) => t.trim()).filter(Boolean);
}

function buildWhere(tokens: string[], active: boolean | null): Prisma.ItemWhereInput {
  const and: Prisma.ItemWhereInput[] = [];

  if (active !== null) and.push({ active });

  for (const t of tokens) {
    and.push({
      OR: [
        { sku: { contains: t, mode: "insensitive" } },
        { partNumber: { contains: t, mode: "insensitive" } },
        { name: { contains: t, mode: "insensitive" } },
        { description: { contains: t, mode: "insensitive" } },
        { category: { contains: t, mode: "insensitive" } },
        { manufacturer: { contains: t, mode: "insensitive" } },
        { orderFrom: { contains: t, mode: "insensitive" } },
      ],
    });
  }

  return and.length ? { AND: and } : {};
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // RFC4180-ish: quote if contains comma/quote/newline
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function vendorLabel(v: InvoiceVendor | null): string {
  if (v === InvoiceVendor.AMERICAN_PLUS) return "AMERICAN_PLUS";
  if (v === InvoiceVendor.SUCCESS_PLUS) return "SUCCESS_PLUS";
  return "";
}

function formatBool(b: boolean): string {
  return b ? "true" : "false";
}

function formatIso(d: Date): string {
  return d.toISOString();
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });
  const perms = await loadUserPermissions(session);
  const canExportItems =
    perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_IMPORT_EXPORT_ITEMS, Permission.ADMIN_VIEW_ITEMS]);
  if (!canExportItems) return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);

  const tokens = normalizeSearch(url.searchParams.get("q"));
  const active = parseActive(url.searchParams.get("active"));
  const sort = parseSort(url.searchParams.get("sort"));
  const dir = parseDir(url.searchParams.get("dir"));

  const where = buildWhere(tokens, active);

  // Deterministic ordering with tie-breaker
  const orderBy: Prisma.ItemOrderByWithRelationInput[] = [
    { [sort]: dir } as unknown as Prisma.ItemOrderByWithRelationInput,
    { id: dir },
  ];

  const items = await prisma.item.findMany({
    where,
    orderBy,
    select: {
      sku: true,
      partNumber: true,
      vendor: true,
      name: true,
      description: true,
      category: true,

      manufacturer: true,
      orderFrom: true,
      webUrl: true,

      cost: true,
      price: true,
      taxable: true,
      active: true,

      onHandQty: true,
      orderedQty: true,
      usedQty: true,
      minQty: true,

      createdAt: true,
      updatedAt: true,
    },
  });

  // ✅ Unit (UOM) intentionally removed (everything is per-each)
  const header = [
    "SKU",
    "PartNumber",
    "Vendor",
    "Name",
    "Description",
    "Category",
    "Manufacturer",
    "OrderFrom",
    "WebUrl",
    "Cost",
    "Price",
    "Taxable",
    "Active",
    "OnHandQty",
    "OrderedQty",
    "UsedQty",
    "MinQty",
    "CreatedAt",
    "UpdatedAt",
  ];

  const lines: string[] = [];
  lines.push(header.map(csvEscape).join(","));

  for (const it of items) {
    lines.push(
      [
        it.sku,
        it.partNumber ?? "",
        vendorLabel(it.vendor),
        it.name,
        it.description ?? "",
        it.category ?? "",
        it.manufacturer ?? "",
        it.orderFrom ?? "",
        it.webUrl ?? "",
        it.cost == null ? "" : it.cost.toString(),
        it.price == null ? "" : it.price.toString(),
        formatBool(it.taxable),
        formatBool(it.active),
        it.onHandQty,
        it.orderedQty,
        it.usedQty,
        it.minQty,
        formatIso(it.createdAt),
        formatIso(it.updatedAt),
      ].map(csvEscape).join(",")
    );
  }

  const csv = lines.join("\r\n");
  const filename = `items_export_${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}