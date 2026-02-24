// app/api/admin/items/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma, InvoiceVendor, Permission, Role } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

type AdminSession = {
  user?: { id?: string | null; email?: string | null; role?: Role | null } | null;
} | null;

async function requireAdminEditItems() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) throw new Error("UNAUTHENTICATED");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return { session, perms };

  const ok = hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) throw new Error("FORBIDDEN");

  return { session, perms };
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

function parseMoneyOrNull(v: unknown): Prisma.Decimal | null {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;

  // Keep it strict-ish: numbers only, optional 2 decimals
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;

  try {
    return new Prisma.Decimal(s);
  } catch {
    return null;
  }
}

function parseOptionalString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function parseRequiredString(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim();
}

function parseBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

function parseVendor(v: unknown): InvoiceVendor | null {
  if (v === "SUCCESS_PLUS") return InvoiceVendor.SUCCESS_PLUS;
  if (v === "AMERICAN_PLUS") return InvoiceVendor.AMERICAN_PLUS;
  return null;
}

function shapeItemForClient(item: {
  id: string;
  sku: string;
  partNumber: string | null;
  vendor: InvoiceVendor;
  name: string;
  description: string | null;
  category: string | null;
  cost: Prisma.Decimal | null;
  price: Prisma.Decimal | null;
  taxable: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;

  onHandQty: number;
  orderedQty: number;
  usedQty: number;
  minQty: number;

  manufacturer: string | null;
  orderFrom: string | null;
  webUrl: string | null;
}) {
  return {
    id: item.id,
    sku: item.sku,
    partNumber: item.partNumber,
    vendor: item.vendor,
    name: item.name,
    description: item.description,
    category: item.category,
    unit: null as string | null, // tolerated legacy prop
    cost: item.cost == null ? null : item.cost.toString(),
    price: item.price == null ? null : item.price.toString(),
    taxable: item.taxable,
    active: item.active,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),

    onHandQty: item.onHandQty,
    orderedQty: item.orderedQty,
    usedQty: item.usedQty,
    minQty: item.minQty,

    manufacturer: item.manufacturer,
    orderFrom: item.orderFrom,
    webUrl: item.webUrl,
  };
}

type PatchBody = {
  sku?: unknown;
  name?: unknown;

  partNumber?: unknown;
  description?: unknown;
  category?: unknown;

  manufacturer?: unknown;
  orderFrom?: unknown;
  webUrl?: unknown;

  cost?: unknown;
  price?: unknown;

  taxable?: unknown;
  active?: unknown;

  vendor?: unknown;
};

type PrismaErrorLike = {
  code?: string;
  message?: string;
};

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminEditItems();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "FORBIDDEN";
    if (msg === "UNAUTHENTICATED") return jsonError(401, "Unauthorized");
    if (msg === "FORBIDDEN") return jsonError(403, "Forbidden");
    return jsonError(500, "Auth error");
  }

  const { id } = await ctx.params;
  if (!id) return jsonError(400, "Missing id");

  let body: PatchBody | null = null;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return jsonError(400, "Invalid JSON");
  }

  const sku = parseRequiredString(body?.sku);
  const name = parseRequiredString(body?.name);

  if (!sku) return jsonError(400, "SKU is required");
  if (!name) return jsonError(400, "Name is required");

  const partNumber = parseOptionalString(body?.partNumber);
  const description = parseOptionalString(body?.description);
  const category = parseOptionalString(body?.category);

  const manufacturer = parseOptionalString(body?.manufacturer);
  const orderFrom = parseOptionalString(body?.orderFrom);
  const webUrl = parseOptionalString(body?.webUrl);

  const cost = body?.cost === null || body?.cost === "" ? null : parseMoneyOrNull(body?.cost);
  const price = body?.price === null || body?.price === "" ? null : parseMoneyOrNull(body?.price);

  // If provided but invalid format, reject (so we don’t silently null it)
  if (body?.cost != null && body?.cost !== "" && cost == null) return jsonError(400, "Invalid cost");
  if (body?.price != null && body?.price !== "" && price == null) return jsonError(400, "Invalid price");

  const taxable = parseBool(body?.taxable);
  const active = parseBool(body?.active);

  if (taxable == null) return jsonError(400, "Invalid taxable");
  if (active == null) return jsonError(400, "Invalid active");

  const vendor = body?.vendor == null ? null : parseVendor(body?.vendor);
  if (body?.vendor != null && vendor == null) return jsonError(400, "Invalid vendor");

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.item.findUnique({
        where: { id },
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
      });

      if (!current) throw new Error("NOT_FOUND");

      const updatedItem = await tx.item.update({
        where: { id },
        data: {
          sku,
          partNumber,
          vendor: vendor ?? current.vendor,
          name,
          description,
          category,

          manufacturer,
          orderFrom,
          webUrl,

          cost,
          price,
          taxable,
          active,
        },
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
      });

      const last = await tx.itemVersion.findFirst({
        where: { itemId: id },
        orderBy: { version: "desc" },
        select: { version: true },
      });

      const nextVersion = (last?.version ?? 0) + 1;

      await tx.itemVersion.create({
        data: {
          itemId: id,
          version: nextVersion,

          sku: updatedItem.sku,
          partNumber: updatedItem.partNumber,
          vendor: updatedItem.vendor,

          name: updatedItem.name,
          description: updatedItem.description,
          category: updatedItem.category,

          unit: null,

          cost: updatedItem.cost,
          price: updatedItem.price,
          taxable: updatedItem.taxable,
          active: updatedItem.active,

          manufacturer: updatedItem.manufacturer,
          orderFrom: updatedItem.orderFrom,
          webUrl: updatedItem.webUrl,

          onHandQty: updatedItem.onHandQty,
          orderedQty: updatedItem.orderedQty,
          usedQty: updatedItem.usedQty,
          minQty: updatedItem.minQty,
        },
      });

      return updatedItem;
    });

    return NextResponse.json(shapeItemForClient(updated));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return jsonError(404, "Item not found");
    return jsonError(500, "Failed to update item");
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminEditItems();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "FORBIDDEN";
    if (msg === "UNAUTHENTICATED") return jsonError(401, "Unauthorized");
    if (msg === "FORBIDDEN") return jsonError(403, "Forbidden");
    return jsonError(500, "Auth error");
  }

  const { id } = await ctx.params;
  if (!id) return jsonError(400, "Missing id");

  try {
    await prisma.item.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const err = e as PrismaErrorLike | null;

    // Prisma not-found / FK violations
    if (err?.code === "P2025") return jsonError(404, "Item not found");
    if (err?.code === "P2003") {
      return NextResponse.json(
        {
          error:
            "Delete blocked: item has related records (tickets/orders/alerts/versions). Use PURGE if you intend to remove everything.",
        },
        { status: 409 }
      );
    }
    return jsonError(500, "Failed to delete item");
  }
}