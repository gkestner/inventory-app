// app/admin/items/page.tsx
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { InvoiceVendor, Permission, Role } from "@prisma/client";

import ItemsTableClient from "./ItemsTableClient";

export const dynamic = "force-dynamic";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

type HasToString = { toString: () => string };
type HasToNumber = { toNumber: () => number };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function hasFn<T extends string>(
  obj: Record<string, unknown>,
  key: T
): obj is Record<T, (...args: never[]) => unknown> {
  return typeof obj[key] === "function";
}

function moneyToString(v: unknown): string | null {
  if (v === null || v === undefined) return null;

  // Prisma Decimal at runtime has toString()
  if (isObject(v) && hasFn(v, "toString")) {
    const s = String((v as unknown as HasToString).toString());
    return s;
  }

  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string") return v;
  return null;
}

function decimalToNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;

  if (typeof v === "number" && Number.isFinite(v)) return v;

  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  if (isObject(v)) {
    // Prisma Decimal (decimal.js) commonly supports toNumber()
    if (hasFn(v, "toNumber")) {
      const n = (v as unknown as HasToNumber).toNumber();
      return Number.isFinite(n) ? n : null;
    }

    if (hasFn(v, "toString")) {
      const n = Number(String((v as unknown as HasToString).toString()));
      return Number.isFinite(n) ? n : null;
    }
  }

  return null;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

async function requireItemsView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  // Admins allowed; otherwise require permission
  if (session.user?.role === Role.ADMIN) {
    return { session, perms: { allowAll: true } as const };
  }

  const perms = await loadUserPermissions(session);
  const ok = hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS]);
  if (!ok) redirect("/");

  return { session, perms };
}

function clampInt(v: unknown, def: number, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export default async function AdminItemsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireItemsView();

  const page = clampInt(searchParams?.page, 1, 1, 10_000);
  const perPage = clampInt(searchParams?.perPage, 25, 5, 200);
  const qRaw = Array.isArray(searchParams?.q) ? searchParams?.q[0] : searchParams?.q;
  const q = (qRaw ?? "").trim();

  const createdSkuRaw = Array.isArray(searchParams?.createdSku)
    ? searchParams?.createdSku[0]
    : searchParams?.createdSku;
  const createdSku = (createdSkuRaw ?? "").trim() || null;

  const where =
    q.length > 0
      ? {
          OR: [
            { sku: { contains: q, mode: "insensitive" as const } },
            { partNumber: { contains: q, mode: "insensitive" as const } },
            { name: { contains: q, mode: "insensitive" as const } },
            { category: { contains: q, mode: "insensitive" as const } },
            { manufacturer: { contains: q, mode: "insensitive" as const } },
            { orderFrom: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {};

  const [total, items, vendorConfigs] = await Promise.all([
    prisma.item.count({ where }),
    prisma.item.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { sku: "asc" }],
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
        manufacturer: true,
        orderFrom: true,
        webUrl: true,
        onHandQty: true,
        orderedQty: true,
        usedQty: true,
        minQty: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.invoiceVendorConfig.findMany({
      select: { vendor: true, partsUpchargePct: true },
    }),
  ]);

  // ✅ Build ONE formula per vendor based on vendor config (partsUpchargePct)
  // Formula grammar supported by client evaluator: numbers, cost, + - * /, parentheses
  const vendorFormulas: Record<"SUCCESS_PLUS" | "AMERICAN_PLUS", string> = {
    SUCCESS_PLUS: "",
    AMERICAN_PLUS: "",
  };

  for (const cfg of vendorConfigs) {
    const pct = decimalToNumber(cfg.partsUpchargePct);
    if (pct === null) continue;

    const multiplier = round4(1 + pct / 100);
    const formula = `cost * ${multiplier}`;

    if (cfg.vendor === InvoiceVendor.SUCCESS_PLUS) vendorFormulas.SUCCESS_PLUS = formula;
    if (cfg.vendor === InvoiceVendor.AMERICAN_PLUS) vendorFormulas.AMERICAN_PLUS = formula;
  }

  const initialItems = items.map((it) => ({
    id: it.id,
    sku: it.sku,
    partNumber: it.partNumber,
    vendor: it.vendor,
    name: it.name,
    description: it.description,
    category: it.category,
    cost: moneyToString(it.cost),
    price: moneyToString(it.price),
    taxable: it.taxable,
    active: it.active,
    manufacturer: it.manufacturer,
    orderFrom: it.orderFrom,
    webUrl: it.webUrl,
    onHandQty: it.onHandQty,
    orderedQty: it.orderedQty,
    usedQty: it.usedQty,
    minQty: it.minQty,
    createdAt: it.createdAt.toISOString(),
    updatedAt: it.updatedAt.toISOString(),
  }));

  return (
    <main style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 34, fontWeight: 900, margin: 0 }}>Items</h1>
        <div style={{ opacity: 0.8, fontSize: 13 }}>Admin</div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link
            href="/admin"
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "8px 12px",
              textDecoration: "none",
              color: "var(--text)",
              fontWeight: 800,
            }}
          >
            Admin Dashboard
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 14, marginBottom: 14, fontSize: 12, opacity: 0.85 }}>
        Vendor formulas (global):{" "}
        <span style={{ fontFamily: "monospace" }}>SUCCESS_PLUS: {vendorFormulas.SUCCESS_PLUS || "—"}</span> •{" "}
        <span style={{ fontFamily: "monospace" }}>AMERICAN_PLUS: {vendorFormulas.AMERICAN_PLUS || "—"}</span>
      </div>

      <ItemsTableClient
        key={`${q}::${page}::${perPage}`} // ✅ force remount so client state can’t “stick” across URL changes
        initialItems={initialItems}
        createdSku={createdSku}
        page={page}
        perPage={perPage}
        total={total}
        vendorFormulas={vendorFormulas}
      />
    </main>
  );
}