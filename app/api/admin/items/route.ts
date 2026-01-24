import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";


/**
 * Admin-only guard
 */
async function requireAdmin() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return { ok: false as const, status: 401, error: "Unauthorized" };
  }

  if ((session.user as any).role !== "ADMIN") {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }

  return { ok: true as const };
}

/**
 * GET /api/admin/items
 */
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const active = searchParams.get("active");

  const where: any = {};

  if (active === "true") where.active = true;
  if (active === "false") where.active = false;

  if (q) {
    where.OR = [
     { sku: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { partNumber: { contains: q, mode: "insensitive" } }, // ✅ NEW
    ];
  }


  const items = await prisma.item.findMany({
    where,
    orderBy: [{ active: "desc" }, { sku: "asc" }],
  });

  return NextResponse.json({ items });
}

/**
 * POST /api/admin/items
 */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sku = String(body.sku ?? "").trim().toUpperCase();
  const name = String(body.name ?? "").trim();

  if (!sku) {
    return NextResponse.json({ error: "SKU is required" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Item name is required" }, { status: 400 });
  }

  const description = body.description ? String(body.description).trim() : null;
  const category = body.category ? String(body.category).trim() : null;
  const unit = body.unit ? String(body.unit).trim() : null;
  const partNumber = body.partNumber ? String(body.partNumber).trim() : null; // ✅ NEW


  const cost =
    body.cost === "" || body.cost === undefined || body.cost === null
      ? null
      : Number(body.cost);

  const price =
    body.price === "" || body.price === undefined || body.price === null
      ? null
      : Number(body.price);

  if (cost !== null && !Number.isFinite(cost)) {
    return NextResponse.json({ error: "Cost must be a number" }, { status: 400 });
  }

  if (price !== null && !Number.isFinite(price)) {
    return NextResponse.json({ error: "Price must be a number" }, { status: 400 });
  }

  const taxable = body.taxable === undefined ? true : Boolean(body.taxable);
  const active = body.active === undefined ? true : Boolean(body.active);

  try {
    const item = await prisma.item.create({
      data: {
       sku,
        partNumber, // ✅ NEW
        name,
        description,
        category,
        unit,
        cost,
        price,
        taxable,
        active,
      },


    return NextResponse.json({ item }, { status: 201 });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "SKU already exists" }, { status: 409 });
    }

    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
