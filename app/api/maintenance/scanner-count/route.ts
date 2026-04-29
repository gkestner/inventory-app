import { NextRequest, NextResponse } from "next/server";
import { Permission, Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { buildStructuredSku, parseSkuRoomParts, parseStructuredSkuParts } from "@/app/lib/item-sku";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type SaveBody = {
  itemId?: unknown;
  name?: unknown;
  onHandQty?: unknown;
  location?: unknown;
  shelf?: unknown;
  bin?: unknown;
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function normalize2(value: string | null | undefined): string {
  const n = Number(String(value ?? "").replace(/\D/g, ""));
  if (!Number.isFinite(n)) return "";
  return String(Math.max(0, Math.trunc(n))).padStart(2, "0");
}

function normalizeLocation(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "vault") return "vault";
  const normalized = normalize2(raw);
  if (!normalized) throw new Error("Invalid location");
  return normalized;
}

function parseNonNegativeInt(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${field}`);
  return Math.trunc(n);
}

function parseShortCode(value: unknown, field: string): string {
  const normalized = normalize2(typeof value === "string" || typeof value === "number" ? String(value) : "");
  if (!normalized) throw new Error(`Invalid ${field}`);
  return normalized;
}

function isReturnRecord(note: string | null | undefined, voidNote: string | null | undefined): boolean {
  const combined = `${note ?? ""} ${voidNote ?? ""}`.toUpperCase();
  return combined.includes("[RETURN]") || combined.includes("LINKEDTOCHECKOUT=");
}

function monthKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function hasStructuredRoomSlot(sku: string): boolean {
  const parsed = parseSkuRoomParts(sku);
  return Boolean(parsed?.location && parsed?.shelf && parsed?.bin);
}

function recentMonths(count: number): Array<{ key: string; label: string; start: Date }> {
  const out: Array<{ key: string; label: string; start: Date }> = [];
  const now = new Date();
  const anchor = new Date(now.getFullYear(), now.getMonth(), 1);

  for (let index = count - 1; index >= 0; index -= 1) {
    const current = new Date(anchor.getFullYear(), anchor.getMonth() - index, 1);
    out.push({ key: monthKey(current), label: monthLabel(current), start: current });
  }

  return out;
}

async function requireScannerCountAccess() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) return { ok: false as const, status: 401, error: "Unauthorized" };

  const perms = await loadUserPermissions(session);
  const allowed =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_EDIT_ITEMS,
    ]);

  if (!allowed) return { ok: false as const, status: 403, error: "Forbidden" };

  const email = String(session.user?.email ?? "").trim().toLowerCase();
  const actor = email
    ? await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } })
    : null;

  if (!actor?.id || !actor.active) return { ok: false as const, status: 401, error: "Unauthorized" };

  return { ok: true as const, actorId: actor.id };
}

export async function GET(req: NextRequest) {
  const gate = await requireScannerCountAccess();
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  const itemId = req.nextUrl.searchParams.get("itemId")?.trim() ?? "";
  if (!itemId) return json({ error: "Missing itemId" }, 400);

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      labelNumber: true,
      sku: true,
      partNumber: true,
      name: true,
      onHandQty: true,
      minQty: true,
      cost: true,
      price: true,
      updatedAt: true,
    },
  });

  if (!item) return json({ error: "Item not found" }, 404);

  const locationParts = parseSkuRoomParts(item.sku);
  const costRows = await prisma.inventoryOrder.findMany({
    where: {
      itemId,
      unitPrice: { not: null },
    },
    orderBy: { orderedAt: "desc" },
    take: 24,
    select: {
      orderedAt: true,
      unitPrice: true,
    },
  });

  const months = recentMonths(12);
  const usageRows = await prisma.partsCheckoutTicket.findMany({
    where: {
      itemId,
      createdAt: { gte: months[0]?.start ?? new Date() },
    },
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true,
      quantity: true,
      status: true,
      note: true,
      voidNote: true,
    },
  });

  const usageByMonth = new Map(months.map((entry) => [entry.key, 0]));
  for (const row of usageRows) {
    let delta = 0;
    if (isReturnRecord(row.note, row.voidNote)) delta = -row.quantity;
    else if (row.status === "OPEN" || row.status === "INVOICED") delta = row.quantity;
    else delta = 0;

    const key = monthKey(row.createdAt);
    if (!usageByMonth.has(key)) continue;
    usageByMonth.set(key, (usageByMonth.get(key) ?? 0) + delta);
  }

  return json({
    id: item.id,
    labelNumber: item.labelNumber,
    sku: item.sku,
    partNumber: item.partNumber,
    name: item.name,
    onHandQty: item.onHandQty,
    minQty: item.minQty,
    cost: (item.cost ?? item.price) == null ? null : (item.cost ?? item.price)?.toString(),
    location: locationParts?.location ?? "01",
    shelf: locationParts?.shelf ?? "01",
    bin: locationParts?.bin ?? "01",
    costHistory: costRows
      .slice()
      .reverse()
      .map((row) => ({
        label: row.orderedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        value: Number(row.unitPrice ?? 0),
      })),
    usageHistory: months.map((entry) => ({
      label: entry.label,
      value: usageByMonth.get(entry.key) ?? 0,
    })),
    updatedAt: item.updatedAt.toISOString(),
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireScannerCountAccess();
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!itemId) return json({ error: "Missing itemId" }, 400);
  if (!name) return json({ error: "Part name is required" }, 400);

  let onHandQty: number;
  let location: string;
  let shelf: string;
  let bin: string;

  try {
    onHandQty = parseNonNegativeInt(body.onHandQty, "on hand quantity");
    location = normalizeLocation(body.location);
    shelf = parseShortCode(body.shelf, "shelf");
    bin = parseShortCode(body.bin, "bin");
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid request" }, 400);
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.item.findUnique({
        where: { id: itemId },
        select: {
          id: true,
          labelNumber: true,
          sku: true,
          partNumber: true,
          vendor: true,
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
          onHandQty: true,
          orderedQty: true,
          usedQty: true,
          minQty: true,
          updatedAt: true,
        },
      });

      if (!current) throw new Error("Item not found");

      await tx.$queryRaw`SELECT id FROM "Item" WHERE id = ${itemId} FOR UPDATE`;

      const latest = await tx.itemVersion.findFirst({
        where: { itemId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const nextVersion = (latest?.version ?? 0) + 1;

      await tx.itemVersion.create({
        data: {
          itemId,
          version: nextVersion,
          sku: current.sku,
          partNumber: current.partNumber,
          vendor: current.vendor,
          name: current.name,
          description: current.description,
          category: current.category,
          manufacturer: current.manufacturer,
          orderFrom: current.orderFrom,
          webUrl: current.webUrl,
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

      const nextSku = hasStructuredRoomSlot(current.sku)
        ? (() => {
            const structuredSku = parseStructuredSkuParts(current.sku) ?? {
              zone: location === "vault" ? "VT" : location,
              location,
              shelf,
              bin,
              itemKey: current.sku,
            };
            return buildStructuredSku(structuredSku.zone, location, shelf, bin, structuredSku.itemKey);
          })()
        : current.sku;

      const saved = await tx.item.update({
        where: { id: itemId },
        data: {
          name,
          onHandQty,
          sku: nextSku,
        },
        select: {
          id: true,
          sku: true,
          name: true,
          onHandQty: true,
          updatedAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: gate.actorId,
          module: "INVENTORY_COUNT",
          action: "SCANNER_COUNT_SAVE",
          entityType: "Item",
          entityId: itemId,
          message: `Scanner count update for ${current.name}: qty ${current.onHandQty} -> ${onHandQty}, sku ${current.sku} -> ${nextSku}`,
          metadata: {
            previousName: current.name,
            nextName: name,
            previousOnHandQty: current.onHandQty,
            nextOnHandQty: onHandQty,
            previousSku: current.sku,
            nextSku,
            location,
            shelf,
            bin,
          },
        },
      });

      return saved;
    });

    return json({
      item: {
        id: updated.id,
        sku: updated.sku,
        name: updated.name,
        onHandQty: updated.onHandQty,
        location,
        shelf,
        bin,
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return json(
        {
          error:
            "Save failed because that room location would create a duplicate SKU. Try a different location, shelf, or bin.",
        },
        409
      );
    }
    return json({ error: error instanceof Error ? error.message : "Save failed" }, 500);
  }
}