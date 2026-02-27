// app/admin/items/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { Role, Permission } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

import ItemsTableClient from "./ItemsTableClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SearchParams = {
  page?: string;
  perPage?: string;
  q?: string;
  createdSku?: string;
};

type Vendor = "SUCCESS_PLUS" | "AMERICAN_PLUS";

type AdminSession = {
  user?: { email?: string | null; role?: Role | null } | null;
} | null;

async function requireAdmin() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");
  const role = session.user?.role ?? null;
  if (role !== Role.ADMIN) redirect("/");
  return session;
}

function toInt(v: string | undefined, fallback: number) {
  const n = Number(String(v ?? ""));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

function tokenizeQ(q: string): string[] {
  return q
    .trim()
    .toLowerCase()
    .split(/\s+/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

function buildItemSearchWhere(qRaw: string) {
  const q = (qRaw || "").trim();
  if (!q) return {};

  // AND semantics across tokens: every word must be found somewhere (any field)
  const tokens = tokenizeQ(q);
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

  return {
    AND: tokens.map((tok) => ({
      OR: fields.map((f) => ({
        [f]: { contains: tok, mode: "insensitive" as const },
      })),
    })),
  };
}

export default async function AdminItemsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();

  // Optional: permissions gate if you use it
  const session = await getServerSession(authOptions);
  const perms = await loadUserPermissions(session);
  const canView = hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS]);
  if (!canView) redirect("/");

  const page = toInt(searchParams.page, 1);
  const perPage = Math.min(100, toInt(searchParams.perPage, 25));
  const q = (searchParams.q || "").trim();
  const createdSku = (searchParams.createdSku || "").trim() || null;

  // ✅ Replace this with your CURRENT working way of loading vendor formulas:
  // It must produce: Record<"SUCCESS_PLUS"|"AMERICAN_PLUS", string>
  const vendorFormulas: Record<Vendor, string> = {
    SUCCESS_PLUS: "",
    AMERICAN_PLUS: "",
  };

  const where = buildItemSearchWhere(q);

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

        // If you include qty fields in your table, adjust to your schema:
        // onHandQty: true, usedQty: true, minQty: true, orderedQty: true,
      },
    }),
  ]);

  // ItemsTableClient expects strings for decimals; if Prisma returns Decimal, stringify it.
  const initialItems = items.map((it) => ({
    ...it,
    cost: it.cost ? String(it.cost) : null,
    price: it.price ? String(it.price) : null,
    createdAt: it.createdAt.toISOString(),
    updatedAt: it.updatedAt.toISOString(),
  }));

  const shell: CSSProperties = {
    padding: 16,
  };

  return (
    <div style={shell}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Items</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <Link href="/admin" style={{ textDecoration: "none" }}>
            Back
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