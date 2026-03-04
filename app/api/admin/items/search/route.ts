// app/api/admin/items/search/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { Role, Prisma } from "@prisma/client";

function toInt(v: string | null, fallback: number) {
  const n = Number(v ?? "");
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

/**
 * Normalize enough to tokenize reliably, but keep original chars
 * so we can generate multiple dash variants later.
 */
function normalizeQuery(q: string): string {
  return (q ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split on whitespace AND common dash characters, so "A–B" becomes ["A","B"]
 * Keep tokens length >= 2 (same idea as your page.tsx).
 */
function tokenize(q: string): string[] {
  const s = normalizeQuery(q);
  if (!s) return [];
  return s
    .split(/[ \-\u2010\u2011\u2012\u2013\u2014\u2212]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/**
 * Expand a token into variants:
 * - lowercased, trimmed punctuation
 * - singular/plural
 * - dash-alternates (so "-" matches "–", "—", etc. AND vice versa)
 */
function variants(token: string): string[] {
  const cleaned = token
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");

  if (!cleaned) return [];

  const out = new Set<string>();
  out.add(cleaned);

  // Basic singular/plural
  if (cleaned.endsWith("s") && cleaned.length > 3) out.add(cleaned.slice(0, -1));
  else if (cleaned.length > 2) out.add(`${cleaned}s`);

  // Dash variants
  const DASHES = ["-", "\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2212"]; // hyphen, NB-hyphen, figure dash, en, em, minus, etc.
  const hasAnyDash = DASHES.some((d) => cleaned.includes(d));

  if (hasAnyDash) {
    // Normalize all dash-like chars to "-" then re-expand
    const normalizedToHyphen = cleaned.replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-");
    out.add(normalizedToHyphen);

    for (const d of DASHES) {
      out.add(normalizedToHyphen.replace(/-/g, d));
    }
  }

  return Array.from(out);
}

function buildWhere(qRaw: string): Prisma.ItemWhereInput {
  const tokens = tokenize(qRaw);
  if (tokens.length === 0) return {};

  const fields = [
    "sku",
    "partNumber",
    "name",
    "category",
    "description",
    "manufacturer",
    "orderFrom",
    "webUrl",
  ] as const;

  const clauses: Prisma.ItemWhereInput[] = tokens.map((tok) => {
    const vs = variants(tok);

    // OR across (field x variant)
    const ors: Prisma.ItemWhereInput[] = [];
    for (const v of vs) {
      for (const f of fields) {
        ors.push({ [f]: { contains: v, mode: "insensitive" as const } });
      }
    }

    return { OR: ors };
  });

  return { AND: clauses };
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as unknown as { role?: Role | null } | null)?.role ?? null;
  if (!session || role !== Role.ADMIN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const qRaw = (url.searchParams.get("q") ?? "").trim();
  const page = toInt(url.searchParams.get("page"), 1);
  const perPage = Math.min(100, toInt(url.searchParams.get("perPage"), 25));

  const where = buildWhere(qRaw);

  const [total, items] = await Promise.all([
    prisma.item.count({ where }),
    prisma.item.findMany({
      where,
      orderBy: { updatedAt: "desc" },
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
        manufacturer: true,
        orderFrom: true,
        webUrl: true,
        onHandQty: true,
        orderedQty: true,
        usedQty: true,
        minQty: true,
      },
    }),
  ]);

  const shaped = items.map((it) => ({
    ...it,
    cost: it.cost ? String(it.cost) : null,
    price: it.price ? String(it.price) : null,
    createdAt: it.createdAt.toISOString(),
    updatedAt: it.updatedAt.toISOString(),
  }));

  return NextResponse.json({ total, items: shaped, page, perPage });
}