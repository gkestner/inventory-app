// app/admin/items/actions.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { Permission, Prisma, InvoiceVendor } from "@prisma/client";
import type { Session } from "next-auth";
import { revalidatePath } from "next/cache";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

/**
 * NOTE:
 * After the auth typing change, `session.user` can be `null`.
 * Keep this guard minimal and local (no refactors).
 */
async function requireAdminOrThrow(session: Session | null): Promise<void> {
  if (!session || !session.user) throw new Error("Unauthorized");
  const perms = await loadUserPermissions(session);
  const canEditItems = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
  if (!canEditItems) throw new Error("Forbidden");
}

function normNullableText(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  return s;
}

function normBool(v: unknown): boolean | undefined {
  if (v === undefined) return undefined;
  if (v === null) return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
  return undefined;
}

function normMoney(v: unknown): Prisma.Decimal | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return new Prisma.Decimal(s);
}

function normVendor(v: unknown): InvoiceVendor | undefined {
  if (v === undefined) return undefined;
  if (v === null) return undefined;
  const s = String(v).trim().toUpperCase();
  if (s === "SUCCESS_PLUS") return InvoiceVendor.SUCCESS_PLUS;
  if (s === "AMERICAN_PLUS") return InvoiceVendor.AMERICAN_PLUS;
  return undefined;
}

export type UpdateItemInput = {
  id: string;
  sku?: unknown;
  partNumber?: unknown;
  vendor?: unknown; // ✅ ADD
  name?: unknown;
  description?: unknown;
  category?: unknown;
  unit?: unknown;
  cost?: unknown;
  price?: unknown;
  taxable?: unknown;
  active?: unknown;
  manufacturer?: unknown;
  orderFrom?: unknown;
  webUrl?: unknown;
};

export async function updateItemAction(input: UpdateItemInput) {
  const session = (await getServerSession(authOptions)) as Session | null;
  await requireAdminOrThrow(session);

  const id = String(input.id ?? "").trim();
  if (!id) throw new Error("Missing id");

  const data: Record<string, unknown> = {};

  if ("sku" in input) {
    const v = normNullableText(input.sku);
    if (v === undefined) throw new Error("Invalid sku");
    data.sku = v ?? "";
  }
  if ("partNumber" in input) {
    const v = normNullableText(input.partNumber);
    if (v === undefined) throw new Error("Invalid partNumber");
    data.partNumber = v ?? null;
  }

  // ✅ Vendor (American Plus / Success Plus)
  if ("vendor" in input) {
    const v = normVendor(input.vendor);
    if (v === undefined) throw new Error("Invalid vendor");
    data.vendor = v;
  }

  if ("name" in input) {
    const v = normNullableText(input.name);
    if (v === undefined) throw new Error("Invalid name");
    data.name = v ?? "";
  }
  if ("description" in input) {
    const v = normNullableText(input.description);
    if (v === undefined) throw new Error("Invalid description");
    data.description = v ?? null;
  }
  if ("category" in input) {
    const v = normNullableText(input.category);
    if (v === undefined) throw new Error("Invalid category");
    data.category = v ?? null;
  }
  if ("unit" in input) {
    const v = normNullableText(input.unit);
    if (v === undefined) throw new Error("Invalid unit");
    data.unit = v ?? null;
  }
  if ("cost" in input) {
    const v = normMoney(input.cost);
    if (v === undefined) throw new Error("Invalid cost");
    data.cost = v;
  }
  if ("price" in input) {
    const v = normMoney(input.price);
    if (v === undefined) throw new Error("Invalid price");
    data.price = v;
  }
  if ("taxable" in input) {
    const v = normBool(input.taxable);
    if (v === undefined) throw new Error("Invalid taxable");
    data.taxable = v;
  }
  if ("active" in input) {
    const v = normBool(input.active);
    if (v === undefined) throw new Error("Invalid active");
    data.active = v;
  }

  // expanded fields
  if ("manufacturer" in input) {
    const v = normNullableText(input.manufacturer);
    if (v === undefined) throw new Error("Invalid manufacturer");
    data.manufacturer = v ?? null;
  }
  if ("orderFrom" in input) {
    const v = normNullableText(input.orderFrom);
    if (v === undefined) throw new Error("Invalid orderFrom");
    data.orderFrom = v ?? null;
  }
  if ("webUrl" in input) {
    const v = normNullableText(input.webUrl);
    if (v === undefined) throw new Error("Invalid webUrl");
    data.webUrl = v ?? null;
  }

  if (Object.keys(data).length === 0) return { ok: true };

  await prisma.item.update({
    where: { id },
    data,
  });

  revalidatePath("/admin/items");
  return { ok: true };
}