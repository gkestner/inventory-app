import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { InvoiceVendor, Permission, Prisma } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function normalizeVendor(v: unknown): InvoiceVendor | null {
  const s = String(v ?? "")
    .trim()
    .toUpperCase()
    .replace(/[-\s]+/g, "_");
  if (s === "AMERICAN_PLUS") return InvoiceVendor.AMERICAN_PLUS;
  if (s === "SUCCESS_PLUS") return InvoiceVendor.SUCCESS_PLUS;
  return null;
}

function toInt(v: FormDataEntryValue | null): number {
  if (v === null) return NaN;
  const n = Number(String(v));
  return Number.isFinite(n) ? Math.floor(n) : NaN;
}

function sanitizeForQuery(value: string): string {
  return String(value ?? "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function returnRedirect(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/maintenance/checkout", req.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, sanitizeForQuery(value));
  }
  return NextResponse.redirect(url, { status: 303 });
}

function isReturnTicketRecord(note: string | null | undefined, voidNote: string | null | undefined): boolean {
  const combined = `${note ?? ""}\n${voidNote ?? ""}`.toUpperCase();
  return combined.includes("[RETURN]") || combined.includes("LINKEDTOCHECKOUT=");
}

function buildItemVersionSnapshot(
  item: {
    id: string;
    sku: string;
    partNumber: string | null;
    vendor: unknown;
    name: string;
    description: string | null;
    category: string | null;
    manufacturer: string | null;
    orderFrom: string | null;
    webUrl: string | null;
    cost: Prisma.Decimal | null;
    price: Prisma.Decimal | null;
    taxable: boolean;
    active: boolean;
    onHandQty: number;
    orderedQty: number;
    usedQty: number;
    minQty: number;
  },
  version: number
) {
  return {
    itemId: item.id,
    version,
    sku: item.sku,
    partNumber: item.partNumber,
    vendor: normalizeVendor(item.vendor) ?? InvoiceVendor.SUCCESS_PLUS,
    name: item.name,
    description: item.description,
    category: item.category,
    manufacturer: item.manufacturer,
    orderFrom: item.orderFrom,
    webUrl: item.webUrl,
    cost: item.cost,
    price: item.price,
    taxable: item.taxable,
    active: item.active,
    onHandQty: item.onHandQty,
    orderedQty: item.orderedQty,
    usedQty: item.usedQty,
    minQty: item.minQty,
  };
}

function getSessionEmail(session: unknown): string {
  if (!isRecord(session)) return "";
  const user = session.user;
  if (!isRecord(user)) return "";
  const email = user.email;
  return typeof email === "string" ? email.toLowerCase().trim() : "";
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return returnRedirect(req, { err: "Unauthorized" });

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.CREATE_CHECKOUT])) {
    return returnRedirect(req, { err: "Forbidden" });
  }

  const formData = await req.formData();
  const itemId = String(formData.get("returnItemId") || "").trim();
  const storeId = String(formData.get("returnStoreId") || "").trim();
  const createdByUserId = String(formData.get("returnCreatedByUserId") || "").trim();
  const quantity = toInt(formData.get("returnQuantity"));
  const originalCheckoutIdSelect = String(formData.get("returnOriginalCheckoutIdSelect") || "").trim();
  const originalCheckoutIdManual = String(formData.get("returnOriginalCheckoutId") || "").trim();
  const note = String(formData.get("returnNote") || "").trim();

  const originalCheckoutId = originalCheckoutIdManual || originalCheckoutIdSelect;
  if (originalCheckoutIdManual && originalCheckoutIdSelect && originalCheckoutIdManual !== originalCheckoutIdSelect) {
    return returnRedirect(req, { err: "Selected checkout ticket does not match the manually entered ticket ID." });
  }

  if (!itemId) return returnRedirect(req, { err: "Missing itemId" });
  if (!storeId) return returnRedirect(req, { err: "Missing storeId" });
  if (!createdByUserId) return returnRedirect(req, { err: "Missing createdByUserId" });
  if (!Number.isFinite(quantity) || quantity <= 0) return returnRedirect(req, { err: "Invalid return quantity" });

  try {
    const actorEmail = getSessionEmail(session);
    if (!perms.allowAll) {
      if (!actorEmail) throw new Error("Unauthorized");
      const me = await prisma.user.findUnique({
        where: { email: actorEmail },
        select: {
          id: true,
          active: true,
          locationId: true,
          allowedLocations: { select: { locationId: true } },
        },
      });
      if (!me || !me.active) throw new Error("Unauthorized");
      const allowed = new Set<string>();
      if (me.locationId) allowed.add(me.locationId);
      for (const ul of me.allowedLocations) allowed.add(ul.locationId);
      if (!allowed.has(storeId)) {
        throw new Error("You are not allowed to create a checkout ticket for that store.");
      }
    }

    const [store, createdBy] = await Promise.all([
      prisma.location.findUnique({
        where: { id: storeId },
        select: { id: true, name: true, active: true, receiptEnabled: true },
      }),
      prisma.user.findUnique({
        where: { id: createdByUserId },
        select: {
          id: true,
          name: true,
          active: true,
          locationId: true,
          allowedLocations: { select: { locationId: true } },
        },
      }),
    ]);

    if (!store || !store.active || !store.receiptEnabled) throw new Error("Store not found");
    if (!createdBy || !createdBy.active) throw new Error("Created-by user not found");

    const createdByAllowedStores = new Set<string>();
    if (createdBy.locationId) createdByAllowedStores.add(createdBy.locationId);
    for (const ul of createdBy.allowedLocations) createdByAllowedStores.add(ul.locationId);
    if (!createdByAllowedStores.has(storeId)) {
      throw new Error("Selected user is not assigned to the selected store.");
    }

    await prisma.$transaction(async (tx) => {
      let originalCheckout: {
        id: string;
        status: "OPEN" | "INVOICED" | "VOIDED";
        itemId: string;
        storeId: string;
        quantity: number;
        note: string | null;
        voidNote: string | null;
        voidedAt: Date | null;
      } | null = null;

      if (originalCheckoutId) {
        originalCheckout = await tx.partsCheckoutTicket.findUnique({
          where: { id: originalCheckoutId },
          select: {
            id: true,
            status: true,
            itemId: true,
            storeId: true,
            quantity: true,
            note: true,
            voidNote: true,
            voidedAt: true,
          },
        });
        if (!originalCheckout) throw new Error("Original checkout ticket not found.");
        if (isReturnTicketRecord(originalCheckout.note, originalCheckout.voidNote)) {
          throw new Error("Original checkout ticket is a return record and cannot be linked for return.");
        }
        if (originalCheckout.status === "VOIDED" || originalCheckout.voidedAt) {
          throw new Error("Original checkout ticket is already voided and cannot be linked for return.");
        }
        if (originalCheckout.itemId !== itemId) {
          throw new Error("Original checkout ticket item does not match selected return item.");
        }
        if (originalCheckout.storeId !== storeId) {
          throw new Error("Original checkout ticket store does not match selected return store.");
        }

        const linkedReturns = await tx.partsCheckoutTicket.aggregate({
          where: {
            status: "VOIDED",
            itemId,
            storeId,
            note: { contains: `linkedToCheckout=${originalCheckout.id}` },
          },
          _sum: { quantity: true },
        });
        const returnedQty = linkedReturns._sum.quantity ?? 0;
        const remainingQty = Math.max(0, originalCheckout.quantity - returnedQty);
        if (remainingQty <= 0) throw new Error("Original checkout ticket has already been fully returned.");
        if (quantity > remainingQty) {
          throw new Error(`Return quantity exceeds remaining linked checkout quantity (${remainingQty} remaining).`);
        }
      }

      const item = await tx.item.findUnique({
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
          onHandQty: true,
          orderedQty: true,
          usedQty: true,
          minQty: true,
        },
      });
      if (!item) throw new Error("Item not found");

      const last = await tx.itemVersion.findFirst({
        where: { itemId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const nextVersion = (last?.version ?? 0) + 1;

      await tx.itemVersion.create({ data: buildItemVersionSnapshot(item, nextVersion) });

      const usedQtyDecrement = Math.min(quantity, Math.max(0, item.usedQty));
      await tx.item.update({
        where: { id: itemId },
        data: {
          onHandQty: { increment: quantity },
          usedQty: { decrement: usedQtyDecrement },
        },
      });

      const returnTicketNoteParts: string[] = ["[RETURN]"];
      if (originalCheckout) returnTicketNoteParts.push(`linkedToCheckout=${originalCheckout.id}`);
      if (note) returnTicketNoteParts.push(note);

      await tx.partsCheckoutTicket.create({
        data: {
          status: "VOIDED",
          itemId,
          storeId,
          storeName: store.name,
          quantity,
          needToOrderMore: false,
          createdByUserId,
          createdByName: createdBy.name,
          note:
            returnTicketNoteParts.length > 1
              ? returnTicketNoteParts.join(" ")
              : "[RETURN] Item returned to inventory from checkout page.",
          voidedAt: new Date(),
          voidNote: originalCheckout
            ? note
              ? `[RETURN] Linked original checkout ${originalCheckout.id}. ${note}`
              : `[RETURN] Linked original checkout ${originalCheckout.id}.`
            : note
              ? `[RETURN] ${note}`
              : "[RETURN] Return to inventory entry.",
          skuSnapshot: item.sku,
          partNumberSnapshot: item.partNumber,
          nameSnapshot: item.name,
          costSnapshot: item.cost,
          vendorSnapshot: normalizeVendor(item.vendor) ?? InvoiceVendor.SUCCESS_PLUS,
          priceSnapshot: item.price,
          taxableSnapshot: item.taxable,
        },
      });
    });

    return returnRedirect(req, { okReturn: "1" });
  } catch (e: unknown) {
    const msg =
      typeof e === "object" && e !== null && "message" in e && typeof (e as { message: unknown }).message === "string"
        ? (e as { message: string }).message
        : "Return failed";
    return returnRedirect(req, { err: msg });
  }
}