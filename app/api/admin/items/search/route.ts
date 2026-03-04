// app/api/admin/items/search/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { Role, Prisma, InvoiceVendor } from "@prisma/client";

function toInt(v: string | null, fallback: number) {
  const n = Number(v ?? "");
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
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

function vendorFromToken(tok: string): InvoiceVendor | null {
  const t = tok.toLowerCase();
  if (t.includes("american")) return InvoiceVendor.AMERICAN_PLUS;
  if (t.includes("success")) return InvoiceVendor.SUCCESS_PLUS;
  if (t === "ap") return InvoiceVendor.AMERICAN_PLUS;
  if (t === "sp") return InvoiceVendor.SUCCESS_PLUS;
  return null;
}

/**
 * Build WHERE:
 * - AND across tokens
 * - OR across fields for each token
 * - contains + insensitive for partial matches
 * - ALSO: allow vendor token mapping (since vendor is enum)
 */
function buildWhere(qRaw: string): Prisma.ItemWhereInput {
  const tokens = tokenize(qRaw);
  if (tokens.length === 0) return {};

  const tokenClauses: Prisma.ItemWhereInput[] = tokens.map((tok) => {
    const vs = variants(tok);
    const vendor = vendorFromToken(tok);

    const ors: Prisma.ItemWhereInput[] = vs.flatMap((v) => [
      { sku: { contains: v, mode: "insensitive" } },
      { partNumber: { contains: v, mode: "insensitive" } },
      { name: { contains: v, mode: "insensitive" } },
      { category: { contains: v, mode: "insensitive" } },
      { description: { contains: v, mode: "insensitive" } },
      { manufacturer: { contains: v, mode: "insensitive" } },
      { orderFrom: { contains: v, mode: "insensitive" } },
      { webUrl: { contains: v, mode: "insensitive" } },
    ]);

    if (vendor) {
      // vendor is an enum (no "contains"), so match directly
      ors.push({ vendor: vendor });
    }

    return { OR: ors };
  });

  return { AND: tokenClauses };
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