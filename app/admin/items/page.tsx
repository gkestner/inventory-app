// app/admin/items/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import ItemsTableClient from "./ItemsTableClient";
import { Role } from "@prisma/client";

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

export default async function AdminItemsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();

  const page = toInt(first(searchParams.page), 1);
  const perPage = Math.min(200, toInt(first(searchParams.perPage), 25));
  const qRaw = (first(searchParams.q) ?? "").trim();
  const createdSku = (first(searchParams.createdSku) ?? "").trim() || null;

  // Build WHERE clause for search
  const where =
    qRaw.length > 0
      ? {
          OR: [
            { sku: { contains: qRaw, mode: "insensitive" as const } },
            { partNumber: { contains: qRaw, mode: "insensitive" as const } },
            { name: { contains: qRaw, mode: "insensitive" as const } },
            { category: { contains: qRaw, mode: "insensitive" as const } },
            { description: { contains: qRaw, mode: "insensitive" as const } },
            { manufacturer: { contains: qRaw, mode: "insensitive" as const } },
            { orderFrom: { contains: qRaw, mode: "insensitive" as const } },
          ],
        }
      : {};

  const skip = (page - 1) * perPage;

  // Vendor formulas (global)
  // Adjust this section to match where you store the formulas.
  // If you already pass vendorFormulas from somewhere else, keep your version.
  const vendorSettings = await prisma.vendorSettings.findMany({
    select: { vendor: true, costPlusFormula: true },
  });

  const vendorFormulas: Record<Vendor, string> = {
    SUCCESS_PLUS: "",
    AMERICAN_PLUS: "",
  };

  for (const s of vendorSettings) {
    if (s.vendor === "SUCCESS_PLUS" || s.vendor === "AMERICAN_PLUS") {
      vendorFormulas[s.vendor] = (s.costPlusFormula ?? "").trim();
    }
  }

  // IMPORTANT: total must respect the same WHERE, or pagination will be wrong
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

        // If you’re adding qty fields via joins/aggregates elsewhere,
        // you can keep doing that; otherwise remove these from the client type.
        onHandQty: true,
        orderedQty: true,
        usedQty: true,
        minQty: true,
      },
    }),
  ]);

  // Shape to match your client expectations (decimal -> string)
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