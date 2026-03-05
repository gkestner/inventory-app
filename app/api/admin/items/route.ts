// app/api/admin/items/route.ts
import type { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { Permission, Prisma } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

type CreateBody = {
  sku?: unknown;
  partNumber?: unknown;
  name?: unknown;
  description?: unknown;
  category?: unknown;
  // unit removed
  cost?: unknown; // string | number | null | ""
  price?: unknown; // string | number | null | ""
  taxable?: unknown; // boolean
  active?: unknown; // boolean

  // NEW
  manufacturer?: unknown;
  orderFrom?: unknown;
  webUrl?: unknown;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

type Gate = { ok: true } | { ok: false; status: number; error: string };

async function requireAnyPermission(session: Session | null, required: Permission[]): Promise<Gate> {
  if (!session) return { ok: false, status: 401, error: "Unauthorized" };
  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return { ok: true };
  if (!hasAnyPermission(perms, required)) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
}

function isMoneyString(v: string) {
  // allow "0", "0.0", "0.00", "12.34"
  return /^\d+(\.\d{1,2})?$/.test(v.trim());
}

function toDecimalOrNull(v: unknown): Prisma.Decimal | null {
  if (v === null || v === undefined) return null;

  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("Invalid money format");
    const s = String(v);
    if (!isMoneyString(s)) throw new Error("Invalid money format");
    return new Prisma.Decimal(s);
  }

  if (typeof v !== "string") throw new Error("Invalid money format");

  const s = v.trim();
  if (s === "") return null;
  if (!isMoneyString(s)) throw new Error("Invalid money format");
  return new Prisma.Decimal(s);
}

function normNullableText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new Error("Invalid string");
  const s = v.trim();
  return s === "" ? null : s;
}

function safeUrl(raw: string | null | undefined): string | null {
  const v = (raw || "").trim();
  if (!v) return null;

  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/].*)?$/i.test(v)) return `https://${v}`;
  return null;
}

function requireBool(v: unknown, field: string): boolean {
  if (typeof v !== "boolean") throw new Error(`Invalid ${field}`);
  return v;
}

function parsePerPage(raw: string | null): number {
  const n = raw ? Number(raw) : NaN;
  const allowed = new Set([10, 25, 50, 100]);
  if (!Number.isFinite(n) || !allowed.has(n)) return 25;
  return n;
}

function parsePage(raw: string | null): number {
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

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

  // Back-compat: older URLs may have sort=unit. Unit (UOM) was removed; map to name.
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
  return (allowed.includes(v as SortKey) ? (v as SortKey) : "updatedAt") as SortKey;
}

function parseDir(raw: string | null): "asc" | "desc" {
  const v = (raw || "").trim().toLowerCase();
  return v === "asc" ? "asc" : "desc";
}

function normalizeSearch(raw: string | null): string[] {
  const q = (raw || "").trim().toLowerCase();
  if (!q) return [];
  // Split on whitespace; drop empties
  return q.split(/\s+/).map((t) => t.trim()).filter(Boolean);
}

function buildWhere(tokens: string[], active: boolean | null): Prisma.ItemWhereInput {
  const and: Prisma.ItemWhereInput[] = [];

  if (active !== null) {
    and.push({ active });
  }

  for (const t of tokens) {
    // AND across tokens; within a token OR across fields
    and.push({
      OR: [
        { sku: { contains: t, mode: "insensitive" } },
        { name: { contains: t, mode: "insensitive" } },
        { partNumber: { contains: t, mode: "insensitive" } },
        { category: { contains: t, mode: "insensitive" } },
        { manufacturer: { contains: t, mode: "insensitive" } },
        { orderFrom: { contains: t, mode: "insensitive" } },
      ],
    });
  }

  return and.length ? { AND: and } : {};
}

function toRow(it: {
  id: string;
  sku: string;
  partNumber: string | null;
  name: string;
  description: string | null;
  category: string | null;
  manufacturer: string | null;
  orderFrom: string | null;
  webUrl: string | null;
  cost: Prisma.Decimal | null;
  price: Prisma.Decimal | null;
  taxable: boolean;
  active: boolean;
  onHandQty: number;
  orderedQty: number;
  usedQty: number;
  minQty: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: it.id,
    sku: it.sku,
    partNumber: it.partNumber,
    name: it.name,
    description: it.description,
    category: it.category,
    cost: it.cost == null ? null : it.cost.toString(),
    price: it.price == null ? null : it.price.toString(),
    taxable: it.taxable,
    active: it.active,

    // qty
    onHandQty: it.onHandQty,
    orderedQty: it.orderedQty,
    usedQty: it.usedQty,
    minQty: it.minQty,

    // NEW
    manufacturer: it.manufacturer,
    orderFrom: it.orderFrom,
    webUrl: it.webUrl,

    createdAt: it.createdAt.toISOString(),
    updatedAt: it.updatedAt.toISOString(),
  };
}

// GET: list endpoint (deterministic ordering + server-side normalized search)
// Supports two modes:
// - Cursor mode (preferred): ?cursor=<lastId>&perPage=25&sort=updatedAt&dir=desc&q=...
// - Page mode (compat): ?page=1&perPage=25&sort=updatedAt&dir=desc&q=...
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const gate = await requireAnyPermission(session, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  const url = new URL(req.url);
  const tokens = normalizeSearch(url.searchParams.get("q"));
  const active = parseActive(url.searchParams.get("active"));

  const perPage = parsePerPage(url.searchParams.get("perPage"));
  const page = parsePage(url.searchParams.get("page"));

  const sort = parseSort(url.searchParams.get("sort"));
  const dir = parseDir(url.searchParams.get("dir"));

  const cursor = (url.searchParams.get("cursor") || "").trim() || null;

  const where = buildWhere(tokens, active);

  // Deterministic ordering with a stable tie-breaker on id
  const orderBy: Prisma.ItemOrderByWithRelationInput[] = [
    { [sort]: dir } as unknown as Prisma.ItemOrderByWithRelationInput,
    { id: dir },
  ];

  const select = {
    id: true,
    sku: true,
    partNumber: true,
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

    // qty
    onHandQty: true,
    orderedQty: true,
    usedQty: true,
    minQty: true,

    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.ItemSelect;

  try {
    // Count is stable and cheap enough for admin list usage; keeps UI pagination accurate.
    const total = await prisma.item.count({ where });

    // Cursor mode: keyset pagination (no offset drift under concurrent writes)
    if (cursor) {
      const take = perPage + 1;

      const rows = await prisma.item.findMany({
        where,
        orderBy,
        take,
        skip: 1, // skip the cursor row itself
        cursor: { id: cursor },
        select,
      });

      const hasMore = rows.length > perPage;
      const pageRows = hasMore ? rows.slice(0, perPage) : rows;

      const nextCursor = pageRows.length ? pageRows[pageRows.length - 1]!.id : null;

      return json({
        mode: "cursor",
        q: tokens.join(" "),
        active: active === null ? "all" : String(active),
        sort,
        dir,
        perPage,
        total,
        items: pageRows.map(toRow),
        nextCursor: hasMore ? nextCursor : null,
        hasMore,
      });
    }

    // Page mode: deterministic + tie-breaker, but uses offset (kept for compatibility).
    const skip = (page - 1) * perPage;

    const rows = await prisma.item.findMany({
      where,
      orderBy,
      skip,
      take: perPage,
      select,
    });

    return json({
      mode: "page",
      q: tokens.join(" "),
      active: active === null ? "all" : String(active),
      sort,
      dir,
      page,
      perPage,
      total,
      items: rows.map(toRow),
    });
  } catch (e: unknown) {
    return json({ error: errorMessage(e, "List failed.") }, 500);
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const gate = await requireAnyPermission(session, [Permission.ADMIN_EDIT_ITEMS]);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!isRecord(raw)) return json({ error: "Invalid JSON body." }, 400);
  const body = raw as CreateBody;

  let sku = "";
  let name = "";
  let partNumber: string | null = null;
  let description: string | null = null;
  let category: string | null = null;
  let cost: Prisma.Decimal | null = null;
  let price: Prisma.Decimal | null = null;
  let taxable = true;
  let active = true;

  // NEW
  let manufacturer: string | null = null;
  let orderFrom: string | null = null;
  let webUrl: string | null = null;

  try {
    sku = typeof body.sku === "string" ? body.sku.trim() : "";
    name = typeof body.name === "string" ? body.name.trim() : "";

    if (!sku) return json({ error: "SKU is required." }, 400);
    if (!name) return json({ error: "Name is required." }, 400);

    partNumber = normNullableText(body.partNumber);
    description = normNullableText(body.description);
    category = normNullableText(body.category);

    // NEW
    manufacturer = normNullableText(body.manufacturer);
    orderFrom = normNullableText(body.orderFrom);

    // Normalize / validate webUrl server-side (matches client behavior)
    const rawWeb = normNullableText(body.webUrl);
    if (rawWeb) {
      const normalized = safeUrl(rawWeb);
      if (!normalized) return json({ error: "Invalid URL (use https://… or a domain like example.com)." }, 400);
      webUrl = normalized;
    } else {
      webUrl = null;
    }

    // cost/price may be null or "" -> null
    cost = toDecimalOrNull(body.cost);
    price = toDecimalOrNull(body.price);

    if (body.taxable !== undefined) taxable = requireBool(body.taxable, "taxable");
    if (body.active !== undefined) active = requireBool(body.active, "active");
  } catch (e: unknown) {
    return json({ error: errorMessage(e, "Invalid input.") }, 400);
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      // 1) Create item
      const item = await tx.item.create({
        data: {
          sku,
          partNumber,
          name,
          description,
          category,
          cost,
          price,
          taxable,
          active,

          // NEW
          manufacturer,
          orderFrom,
          webUrl,

          // qty fields are in schema with defaults
        },
        select: {
          id: true,
          sku: true,
          partNumber: true,
          name: true,
          description: true,
          category: true,
          cost: true,
          price: true,
          taxable: true,
          active: true,

          // qty
          onHandQty: true,
          orderedQty: true,
          usedQty: true,
          minQty: true,

          // NEW
          manufacturer: true,
          orderFrom: true,
          webUrl: true,

          createdAt: true,
          updatedAt: true,
        },
      });

      // 2) Snapshot version 1 (includes qty fields)
      await tx.itemVersion.create({
        data: {
          itemId: item.id,
          version: 1,

          sku: item.sku,
          partNumber: item.partNumber,
          name: item.name,
          description: item.description,
          category: item.category,
          cost: item.cost,
          price: item.price,
          taxable: item.taxable,
          active: item.active,

          // NEW
          manufacturer: item.manufacturer,
          orderFrom: item.orderFrom,
          webUrl: item.webUrl,

          onHandQty: item.onHandQty,
          orderedQty: item.orderedQty,
          usedQty: item.usedQty,
          minQty: item.minQty,
        },
      });

      return item;
    });

    // Return the exact shape ItemsTableClient expects (+ new optional fields)
    return json(
      {
        id: created.id,
        sku: created.sku,
        partNumber: created.partNumber,
        name: created.name,
        description: created.description,
        category: created.category,
        cost: created.cost == null ? null : created.cost.toString(),
        price: created.price == null ? null : created.price.toString(),
        taxable: created.taxable,
        active: created.active,

        // qty
        onHandQty: created.onHandQty,
        orderedQty: created.orderedQty,
        usedQty: created.usedQty,
        minQty: created.minQty,

        // NEW
        manufacturer: created.manufacturer,
        orderFrom: created.orderFrom,
        webUrl: created.webUrl,

        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
      200
    );
  } catch (e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return json({ error: "SKU already exists." }, 409);
    }
    return json({ error: errorMessage(e, "Create failed.") }, 500);
  }
}