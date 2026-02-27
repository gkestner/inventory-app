// app/api/admin/items/search/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { Role } from "@prisma/client";

function toInt(v: string | null, fallback: number) {
  const n = Number(v ?? "");
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

  const tokens = tokenizeQ(qRaw);

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

  const where =
    tokens.length === 0
      ? {}
      : {
          AND: tokens.map((tok) => ({
            OR: fields.map((f) => ({
              [f]: { contains: tok, mode: "insensitive" as const },
            })),
          })),
        };

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