// app/api/admin/items/[id]/rollback/route.ts
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma, Role } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

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

function getUserRole(session: unknown): Role | null {
  if (!session || typeof session !== "object") return null;
  const user = (session as { user?: unknown }).user;
  if (!user || typeof user !== "object") return null;
  const role = (user as { role?: unknown }).role;
  if (role === Role.ADMIN || role === "ADMIN") return Role.ADMIN;
  if (role === Role.MANAGER || role === "MANAGER") return Role.MANAGER;
  if (role === Role.EMPLOYEE || role === "EMPLOYEE") return Role.EMPLOYEE;
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseVersion(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return Math.trunc(input);
  if (typeof input === "string") {
    const n = Number(input.trim());
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (getUserRole(session) !== Role.ADMIN) return json({ error: "Forbidden" }, 403);

  const { id } = await ctx.params;
  const itemId = typeof id === "string" ? id.trim() : "";
  if (!itemId) return json({ error: "Missing id." }, 400);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (!isRecord(raw)) return json({ error: "Invalid JSON body." }, 400);

  const targetVersion = parseVersion(raw.version);
  if (!targetVersion || targetVersion <= 0) return json({ error: "Invalid version." }, 400);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // 1) Get current item (must exist)
      const current = await tx.item.findUnique({
        where: { id: itemId },
        select: {
          id: true,
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

          // qty fields
          onHandQty: true,
          orderedQty: true,
          usedQty: true,
          minQty: true,

          createdAt: true,
          updatedAt: true,
        },
      });

      if (!current) return null;

      // 2) Load the version to rollback to
      const v = await tx.itemVersion.findFirst({
        where: { itemId, version: targetVersion },
        select: {
          id: true,
          itemId: true,
          version: true,

          sku: true,
          partNumber: true,
          vendor: true,
          name: true,
          description: true,
          category: true,

          // ✅ unit removed

          manufacturer: true,
          orderFrom: true,
          webUrl: true,

          cost: true,
          price: true,
          taxable: true,
          active: true,

          // qty fields stored on version snapshots too
          onHandQty: true,
          orderedQty: true,
          usedQty: true,
          minQty: true,
        },
      });

      if (!v) throw new Error("Version not found.");

      // 3) Determine next version number for the snapshot we create BEFORE mutation
      const agg = await tx.itemVersion.aggregate({
        where: { itemId },
        _max: { version: true },
      });
      const nextVersion = (agg._max.version ?? 0) + 1;

      // 4) Snapshot current state (pre-mutation)
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

      // 5) Apply rollback
      const data: Prisma.ItemUpdateInput = {
        sku: v.sku,
        partNumber: v.partNumber,
        vendor: v.vendor,
        name: v.name,
        description: v.description,
        category: v.category,

        manufacturer: v.manufacturer,
        orderFrom: v.orderFrom,
        webUrl: v.webUrl,

        cost: v.cost,
        price: v.price,
        taxable: v.taxable,
        active: v.active,

        // qty fields rollback too (consistent with "version is full snapshot")
        onHandQty: v.onHandQty,
        orderedQty: v.orderedQty,
        usedQty: v.usedQty,
        minQty: v.minQty,
      };

      const u = await tx.item.update({
        where: { id: itemId },
        data,
        select: {
          id: true,
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

          createdAt: true,
          updatedAt: true,
        },
      });

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

        // ✅ unit removed

        manufacturer: updated.manufacturer,
        orderFrom: updated.orderFrom,
        webUrl: updated.webUrl,

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
    const msg = e instanceof Error ? e.message : "Rollback failed.";
    if (msg === "Version not found.") return json({ error: msg }, 404);
    return json({ error: msg }, 500);
  }
}