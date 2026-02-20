// app/api/admin/items/[id]/route.ts
import type { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";
import { Prisma, Role, InvoiceVendor } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

export const dynamic = "force-dynamic";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function getUserRole(session: Session | null): Role | null {
  const u = session?.user as unknown;
  if (!u || typeof u !== "object") return null;
  const role = (u as { role?: unknown }).role;
  return typeof role === "string" && (role === Role.ADMIN || role === Role.EMPLOYEE || role === Role.MANAGER)
    ? (role as Role)
    : null;
}

function parseMoneyToDecimal(input: unknown): Decimal | null {
  if (input === null || input === undefined) return null;

  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return new Decimal(String(input));
  }

  const s = String(input).trim();
  if (!s) return null;

  const cleaned = s.replace(/\$/g, "").replace(/,/g, "").trim();
  if (!cleaned) return null;

  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;

  return new Decimal(cleaned);
}

function parseBoolStrict(input: unknown): boolean | null {
  if (typeof input === "boolean") return input;
  if (input === null || input === undefined) return null;

  const s = String(input).trim().toLowerCase();
  if (["true", "t", "yes", "y", "1", "on"].includes(s)) return true;
  if (["false", "f", "no", "n", "0", "off"].includes(s)) return false;
  return null;
}

function parseVendorStrict(input: unknown): InvoiceVendor | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().toUpperCase();
  if (s === InvoiceVendor.SUCCESS_PLUS) return InvoiceVendor.SUCCESS_PLUS;
  if (s === InvoiceVendor.AMERICAN_PLUS) return InvoiceVendor.AMERICAN_PLUS;
  return null;
}

function parseIntStrict(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return Math.trunc(input);
  }
  const s = String(input).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (getUserRole(session) !== Role.ADMIN) return json({ error: "Forbidden" }, 403);

  const params = await ctx.params;
  const id = asNonEmptyString(params?.id);
  if (!id) return json({ error: "Missing id." }, 400);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!isRecord(raw)) return json({ error: "Invalid JSON body." }, 400);
  const body = raw;

  const data: Prisma.ItemUpdateInput = {};
  let anyQtyFieldTouched = false;

  // ---------- identity fields ----------
  if (body.sku !== undefined) {
    const v = String(body.sku).trim();
    if (!v) return json({ error: "SKU is required." }, 400);
    data.sku = v;
  }

  if (body.partNumber !== undefined) {
    data.partNumber = body.partNumber ? String(body.partNumber).trim() : null;
  }

  // vendor
  if (body.vendor !== undefined) {
    const v = parseVendorStrict(body.vendor);
    if (v === null) return json({ error: "Invalid vendor." }, 400);
    data.vendor = v;
  }

  if (body.name !== undefined) {
    const v = String(body.name).trim();
    if (!v) return json({ error: "Name is required." }, 400);
    data.name = v;
  }

  if (body.description !== undefined) {
    data.description = body.description ? String(body.description).trim() : null;
  }

  if (body.category !== undefined) {
    data.category = body.category ? String(body.category).trim() : null;
  }

  // IMPORTANT: Unit/UOM was removed from Item model. Do not accept/emit it.
  if (body.unit !== undefined) {
    return json({ error: "Field 'unit' is not supported (per-each model)." }, 400);
  }

  if (body.cost !== undefined) {
    if (body.cost === null) data.cost = null;
    else {
      const d = parseMoneyToDecimal(body.cost);
      if (d === null) return json({ error: "Invalid cost." }, 400);
      data.cost = d;
    }
  }

  if (body.price !== undefined) {
    if (body.price === null) data.price = null;
    else {
      const d = parseMoneyToDecimal(body.price);
      if (d === null) return json({ error: "Invalid price." }, 400);
      data.price = d;
    }
  }

  if (body.taxable !== undefined) {
    const b = parseBoolStrict(body.taxable);
    if (b === null) return json({ error: "Invalid taxable." }, 400);
    data.taxable = b;
  }

  if (body.active !== undefined) {
    const b = parseBoolStrict(body.active);
    if (b === null) return json({ error: "Invalid active." }, 400);
    data.active = b;
  }

  // ---------- qty fields ----------
  if (body.onHandQty !== undefined) {
    const n = parseIntStrict(body.onHandQty);
    if (n === null) return json({ error: "Invalid onHandQty." }, 400);
    // negative allowed
    data.onHandQty = n;
    anyQtyFieldTouched = true;
  }

  if (body.orderedQty !== undefined) {
    const n = parseIntStrict(body.orderedQty);
    if (n === null || n < 0) return json({ error: "Invalid orderedQty (must be >= 0)." }, 400);
    data.orderedQty = n;
    anyQtyFieldTouched = true;
  }

  if (body.usedQty !== undefined) {
    const n = parseIntStrict(body.usedQty);
    if (n === null || n < 0) return json({ error: "Invalid usedQty (must be >= 0)." }, 400);
    data.usedQty = n;
    anyQtyFieldTouched = true;
  }

  if (body.minQty !== undefined) {
    const n = parseIntStrict(body.minQty);
    if (n === null || n < 0) return json({ error: "Invalid minQty (must be >= 0)." }, 400);
    data.minQty = n;
    anyQtyFieldTouched = true;
  }

  if (Object.keys(data).length === 0) {
    return json({ error: "No fields to update." }, 400);
  }

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

          onHandQty: true,
          orderedQty: true,
          usedQty: true,
          minQty: true,

          createdAt: true,
          updatedAt: true,
        },
      });

      if (!current) return null;

      const agg = await tx.itemVersion.aggregate({
        where: { itemId: id },
        _max: { version: true },
      });
      const nextVersion = (agg._max.version ?? 0) + 1;

      // snapshot pre-change
      await tx.itemVersion.create({
        data: {
          itemId: id,
          version: nextVersion,

          sku: current.sku,
          partNumber: current.partNumber,
          vendor: current.vendor,
          name: current.name,
          description: current.description,
          category: current.category,
          cost: current.cost,
          price: current.price,
          taxable: current.taxable,
          active: current.active,

          onHandQty: current.onHandQty,
          orderedQty: current.orderedQty,
          usedQty: current.usedQty,
          minQty: current.minQty,
        },
      });

      const u = await tx.item.update({
        where: { id },
        data,
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

          onHandQty: true,
          orderedQty: true,
          usedQty: true,
          minQty: true,

          createdAt: true,
          updatedAt: true,
        },
      });

      // If quantities were changed, create an inventory alert (audit trail for manual qty edits)
      if (anyQtyFieldTouched) {
        const onHandAfter = u.onHandQty;
        const orderedAfter = u.orderedQty;
        const minQtyAtTime = u.minQty;
        const availableAfter = onHandAfter + orderedAfter;

        const qtyDelta =
          body.onHandQty !== undefined ? onHandAfter - current.onHandQty : 0;

        const alertType =
          onHandAfter < 0
            ? "NEGATIVE_ON_HAND"
            : availableAfter < minQtyAtTime
              ? "BELOW_MIN"
              : "TECH_REQUEST_ORDER";

        const userId = (session.user as unknown as { id?: string }).id ?? null;
        const userName = (session.user as unknown as { name?: string }).name ?? "Admin";

        await tx.inventoryAlert.create({
          data: {
            type: alertType,
            itemId: id,
            storeId: null,
            storeName: "ADMIN",
            checkoutId: null,
            createdByUserId: userId,
            createdByName: userName,
            qtyDelta,
            onHandAfter,
            orderedAfter,
            availableAfter,
            minQtyAtTime,
            note: "Manual quantity edit via Items admin (PATCH /api/admin/items/[id]).",
          },
        });
      }

      return u;
    });

    if (!updated) return json({ error: "Item not found." }, 404);

    return json(
      {
        id: updated.id,
        sku: updated.sku,
        partNumber: updated.partNumber,
        vendor: updated.vendor,
        name: updated.name,
        description: updated.description,
        category: updated.category,
        cost: updated.cost == null ? null : updated.cost.toString(),
        price: updated.price == null ? null : updated.price.toString(),
        taxable: updated.taxable,
        active: updated.active,

        onHandQty: updated.onHandQty,
        orderedQty: updated.orderedQty,
        usedQty: updated.usedQty,
        minQty: updated.minQty,

        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
      200
    );
  } catch (e: unknown) {
    const msg =
      e instanceof Prisma.PrismaClientKnownRequestError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Update failed";

    return json({ error: msg }, 500);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (getUserRole(session) !== Role.ADMIN) return json({ error: "Forbidden" }, 403);

  const params = await ctx.params;
  const id = asNonEmptyString(params?.id);
  if (!id) return json({ error: "Missing id." }, 400);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.item.findUnique({
        where: { id },
        select: { id: true },
      });

      if (!existing) return { ok: false, notFound: true };

      // Block if any checkout tickets reference this item (onDelete: Restrict)
      const blocking = await tx.partsCheckoutTicket.findMany({
        where: { itemId: id },
        select: { id: true, status: true },
        take: 25,
      });

      if (blocking.length > 0) {
        return {
          ok: false,
          blocked: true,
          reason:
            "This item is referenced by checkout tickets (onDelete: Restrict). Void/resolve those tickets first.",
          examples: blocking,
        };
      }

      // Delete versions first, then item
      await tx.itemVersion.deleteMany({ where: { itemId: id } });
      await tx.item.delete({ where: { id } });

      return { ok: true, deletedId: id };
    });

    if (result.notFound) return json({ error: "Item not found." }, 404);
    if ((result as { blocked?: boolean }).blocked) return json(result, 409);

    return json(result, 200);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Delete failed";
    return json({ error: msg }, 500);
  }
}