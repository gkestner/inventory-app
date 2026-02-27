// app/admin/items/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import ItemsTableClient from "./ItemsTableClient";
import { Role, Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Vendor = "SUCCESS_PLUS" | "AMERICAN_PLUS";

type SearchParams = {
  page?: string | string[];
  perPage?: string | string[];
  q?: string | string[];
  createdSku?: string | string[];
};

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

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const role = (session.user as unknown as { role?: Role | null } | null)?.role ?? null;
  if (role !== Role.ADMIN) redirect("/");
  return session;
}

/**
 * Split input into tokens:
 * - trims
 * - collapses whitespace
 * - splits on spaces
 * - ignores very short tokens (1 char)
 */
function tokenize(q: string): string[] {
  const s = (q || "").trim().replace(/\s+/g, " ");
  if (!s) return [];
  return s
    .split(" ")
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

/**
 * Simple singular/plural helper:
 * - bulb -> bulbs
 * - bulbs -> bulb
 */
function variants(t: string): string[] {
  const lower = t.toLowerCase();
  const out = new Set<string>([t, lower]);

  if (lower.endsWith("s") && lower.length > 3) {
    out.add(lower.slice(0, -1));
  } else {
    out.add(`${lower}s`);
  }

  return Array.from(out);
}

/**
 * Build WHERE:
 * - AND across tokens
 * - OR across fields for each token
 * - contains + insensitive for partial matches
 */
function buildWhere(qRaw: string): Prisma.ItemWhereInput {
  const tokens = tokenize(qRaw);
  if (tokens.length === 0) return {};

  const tokenClauses: Prisma.ItemWhereInput[] = tokens.map((tok) => {
    const vs = variants(tok);

    const ors: Prisma.ItemWhereInput[] = vs.flatMap((v) => [
      { sku: { contains: v, mode: "insensitive" } },
      { partNumber: { contains: v, mode: "insensitive" } },
      { name: { contains: v, mode: "insensitive" } },
      { category: { contains: v, mode: "insensitive" } },
      { description: { contains: v, mode: "insensitive" } },
      { manufacturer: { contains: v, mode: "insensitive" } },
      { orderFrom: { contains: v, mode: "insensitive" } },
      { webUrl: { contains: v, mode: "insensitive" } }, // ✅ include webUrl too since it’s shown
    ]);

    return { OR: ors };
  });

  return { AND: tokenClauses };
}

export default async function AdminItemsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();

  const page = toInt(first(searchParams.page), 1);
  const perPage = Math.min(200, toInt(first(searchParams.perPage), 25));
  const qRaw = (first(searchParams.q) ?? "").trim();
  const createdSku = (first(searchParams.createdSku) ?? "").trim() || null;

  const where = buildWhere(qRaw);

  const skip = (page - 1) * perPage;

  // ✅ Safe fallback: vendor formulas blank unless you’ve wired them.
  const vendorFormulas: Record<Vendor, string> = {
    SUCCESS_PLUS: "",
    AMERICAN_PLUS: "",
  };

  const [total, items] = await Promise.all([
    prisma.item.count({ where }),
    prisma.item.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
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

  const initialItems = items.map((r) => ({
    ...r,
    cost: r.cost ? String(r.cost) : null,
    price: r.price ? String(r.price) : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  const shell: CSSProperties = { padding: 16 };

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