// app/api/admin/items/[id]/versions/route.ts
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { Role } from "@prisma/client";

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

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (getUserRole(session) !== Role.ADMIN) return json({ error: "Forbidden" }, 403);

  const { id } = await ctx.params;
  const itemId = typeof id === "string" ? id.trim() : "";
  if (!itemId) return json({ error: "Missing id." }, 400);

  // Ensure item exists (clean 404 instead of empty array ambiguity)
  const exists = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true },
  });
  if (!exists) return json({ error: "Item not found." }, 404);

  const versions = await prisma.itemVersion.findMany({
    where: { itemId },
    orderBy: { version: "desc" },
    take: 200, // safety cap for UI modal
    select: {
      id: true,
      itemId: true,
      version: true,
      createdAt: true,

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

      onHandQty: true,
      orderedQty: true,
      usedQty: true,
      minQty: true,
    },
  });

  return json(
    versions.map((v) => ({
      id: v.id,
      itemId: v.itemId,
      version: v.version,
      createdAt: v.createdAt.toISOString(),

      sku: v.sku,
      partNumber: v.partNumber,
      vendor: v.vendor,
      name: v.name,
      description: v.description,
      category: v.category,

      // ✅ unit removed

      manufacturer: v.manufacturer,
      orderFrom: v.orderFrom,
      webUrl: v.webUrl,

      cost: v.cost == null ? null : v.cost.toString(),
      price: v.price == null ? null : v.price.toString(),
      taxable: v.taxable,
      active: v.active,

      onHandQty: v.onHandQty,
      orderedQty: v.orderedQty,
      usedQty: v.usedQty,
      minQty: v.minQty,
    })),
    200
  );
}