// app/maintenance/checkout/page.tsx
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { revalidatePath } from "next/cache";
import type { CSSProperties } from "react";
import { Permission } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

// ✅ Reuse the same searchable picker used on inventory-orders
import ItemPicker from "@/app/admin/inventory-orders/ItemPicker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SearchParams = {
  ok?: string;
  err?: string;
};

function toInt(v: FormDataEntryValue | null): number {
  if (v === null) return NaN;
  const n = Number(String(v));
  return Number.isFinite(n) ? Math.floor(n) : NaN;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function getSessionUserId(session: unknown): string | null {
  if (!isRecord(session)) return null;
  const user = session.user;
  if (!isRecord(user)) return null;
  const id = user.id;
  return typeof id === "string" && id.trim() ? id : null;
}

async function requireCheckoutView() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return { session, perms };

  const ok = hasAnyPermission(perms, [Permission.VIEW_CHECKOUT, Permission.CREATE_CHECKOUT]);

  // ✅ IMPORTANT: do NOT redirect("/") here (can cause redirect loops)
  if (!ok) redirect("/maintenance");

  return { session, perms };
}

async function requireCheckoutCreate() {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("Unauthorized");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return { session, perms };

  const ok = hasAnyPermission(perms, [Permission.CREATE_CHECKOUT]);
  if (!ok) throw new Error("Forbidden");

  return { session, perms };
}

export default async function MaintenanceCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { session, perms } = await requireCheckoutView();

  const sp = await searchParams;
  const ok = sp.ok === "1";
  const err = typeof sp.err === "string" && sp.err.trim() ? sp.err.trim() : null;

  const sessionUserId = getSessionUserId(session);

  // Resolve allowed store locations for non-admin users.
  // Admin (allowAll) can see all active locations.
  let orderedAllowedLocations: Array<{ id: string; name: string }> | null = null;

  if (!perms.allowAll) {
    const email =
      typeof (session.user as unknown as { email?: unknown })?.email === "string"
        ? ((session.user as unknown as { email?: string }).email ?? "").toLowerCase().trim()
        : "";

    if (!email) redirect("/login");

    const me = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        active: true,
        location: { select: { id: true, name: true, active: true, receiptEnabled: true } },
        allowedLocations: {
          select: { isPrimary: true, location: { select: { id: true, name: true, active: true, receiptEnabled: true } } },
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { location: { name: "asc" } }],
        },
      },
    });

    if (!me || !me.active) redirect("/login");

    const primary: Array<{ id: string; name: string }> = [];
    const optional: Array<{ id: string; name: string }> = [];
    const seen = new Set<string>();

    if (me.location?.active && me.location.receiptEnabled) {
      seen.add(me.location.id);
      primary.push({ id: me.location.id, name: me.location.name });
    }

    for (const ul of me.allowedLocations) {
      if (!ul.location?.active || !ul.location.receiptEnabled) continue;
      if (seen.has(ul.location.id)) continue;
      seen.add(ul.location.id);
      if (ul.isPrimary) primary.push({ id: ul.location.id, name: ul.location.name });
      else optional.push({ id: ul.location.id, name: ul.location.name });
    }

    orderedAllowedLocations = [...primary, ...optional];
  }

  const [items, locationsAllActive, users] = await Promise.all([
    prisma.item.findMany({
      where: { active: true },
      orderBy: { sku: "asc" },
      select: {
        id: true,
        sku: true,
        partNumber: true,
        name: true,
        onHandQty: true,
        orderedQty: true,
        minQty: true,

        // ✅ helps the same search behavior as the inventory-orders picker
        category: true,
        manufacturer: true,
        orderFrom: true,
      },
    }),
    prisma.location.findMany({
      where: { active: true, receiptEnabled: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
  ]);

  const locations = orderedAllowedLocations ?? locationsAllActive;

  async function checkoutAction(formData: FormData) {
    "use server";
    try {
      const { session: s, perms: p } = await requireCheckoutCreate();

      const itemId = String(formData.get("itemId") || "");
      const storeId = String(formData.get("storeId") || "");
      const createdByUserId = String(formData.get("createdByUserId") || "");
      const quantity = toInt(formData.get("quantity"));
      const needToOrderMore = formData.get("needToOrderMore") === "on";
      const note = String(formData.get("note") || "").trim();

      if (!itemId) throw new Error("Missing itemId");
      if (!storeId) throw new Error("Missing storeId");
      if (!createdByUserId) throw new Error("Missing createdByUserId");
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Invalid quantity");

      // Enforce allowed store locations for non-admin.
      if (!p.allowAll) {
        const email =
          typeof (s.user as unknown as { email?: unknown })?.email === "string"
            ? ((s.user as unknown as { email?: string }).email ?? "").toLowerCase().trim()
            : "";

        if (!email) throw new Error("Unauthorized");

        const me = await prisma.user.findUnique({
          where: { email },
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

      // Lookups (outside tx is okay, but we keep the write path atomic)
      const store = await prisma.location.findUnique({
        where: { id: storeId },
        select: { id: true, name: true, active: true, receiptEnabled: true },
      });
      if (!store || !store.active || !store.receiptEnabled) throw new Error("Store not found");

      const createdBy = await prisma.user.findUnique({ where: { id: createdByUserId } });
      if (!createdBy) throw new Error("Created-by user not found");

      await prisma.$transaction(async (tx) => {
        const item = await tx.item.findUnique({ where: { id: itemId } });
        if (!item) throw new Error("Item not found");

        // Determine next version number (simple + safe)
        const last = await tx.itemVersion.findFirst({
          where: { itemId },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        const nextVersion = (last?.version ?? 0) + 1;

        // Snapshot before mutation (includes qty fields)
        await tx.itemVersion.create({
          data: {
            itemId,
            version: nextVersion,
            sku: item.sku,
            partNumber: item.partNumber,
            vendor: item.vendor,
            name: item.name,
            description: item.description,
            category: item.category,
            cost: item.cost,
            price: item.price,
            taxable: item.taxable,
            active: item.active,

            onHandQty: item.onHandQty,
            orderedQty: item.orderedQty,
            usedQty: item.usedQty,
            minQty: item.minQty,
          },
        });

        // Apply inventory updates (never block; can go negative)
        const onHandAfter = item.onHandQty - quantity;
        const orderedAfter = item.orderedQty;
        const availableAfter = onHandAfter + orderedAfter;
        const minQtyAtTime = item.minQty;
        await tx.item.update({
          where: { id: itemId },
          data: {
            onHandQty: { decrement: quantity },
            usedQty: { increment: quantity },
          },
        });

        // Create ticket (uses snapshots for invoicing stability)
        const ticket = await tx.partsCheckoutTicket.create({
          data: {
            status: "OPEN",
            itemId,
            storeId,
            storeName: store.name,

            quantity,
            needToOrderMore,

            createdByUserId,
            createdByName: createdBy.name,

            note: note || null,

            skuSnapshot: item.sku,
            partNumberSnapshot: item.partNumber,
            nameSnapshot: item.name,
            costSnapshot: item.cost,
            vendorSnapshot: item.vendor,
            priceSnapshot: item.price,
            taxableSnapshot: item.taxable,
          },
          select: { id: true },
        });

        // NEGATIVE_ON_HAND
        if (onHandAfter < 0) {
          await tx.inventoryAlert.create({
            data: {
              type: "NEGATIVE_ON_HAND",
              itemId,
              storeId,
              storeName: store.name,
              checkoutId: ticket.id,

              createdByUserId,
              createdByName: createdBy.name,

              qtyDelta: -quantity,
              onHandAfter,
              orderedAfter,
              availableAfter,
              minQtyAtTime,
            },
          });
        }

        // BELOW_MIN
        if (availableAfter < minQtyAtTime) {
          await tx.inventoryAlert.create({
            data: {
              type: "BELOW_MIN",
              itemId,
              storeId,
              storeName: store.name,
              checkoutId: ticket.id,

              createdByUserId,
              createdByName: createdBy.name,

              qtyDelta: -quantity,
              onHandAfter,
              orderedAfter,
              availableAfter,
              minQtyAtTime,
            },
          });
        }

        // TECH_REQUEST_ORDER
        if (needToOrderMore) {
          await tx.inventoryAlert.create({
            data: {
              type: "TECH_REQUEST_ORDER",
              itemId,
              storeId,
              storeName: store.name,
              checkoutId: ticket.id,

              createdByUserId,
              createdByName: createdBy.name,

              note: note || "Technician requested ordering more.",
            },
          });
        }
      });

      revalidatePath("/admin/inventory-alerts");
      revalidatePath("/admin/maintenance-tickets");
      revalidatePath("/maintenance");
      revalidatePath("/maintenance/checkout");

      redirect(`/maintenance/checkout?ok=1`);
    } catch (e: unknown) {
      if (isRedirectError(e)) {
        throw e;
      }

      const msg =
        typeof e === "object" && e !== null && "message" in e && typeof (e as { message: unknown }).message === "string"
          ? (e as { message: string }).message
          : "Checkout failed";

      redirect(`/maintenance/checkout?err=${encodeURIComponent(msg)}`);
    }
  }

  const fieldStyle: CSSProperties = {
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",

    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(128,128,128,0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
    outline: "none",
  };

  const labelStyle: CSSProperties = { display: "grid", gap: 6, minWidth: 0 };

  const twoCol: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    gap: 12,
    alignItems: "start",
  };

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Maintenance Checkout</h1>
      <div style={{ opacity: 0.8, marginBottom: 12 }}>
        Creates a ticket and inventory alerts (never blocks; on-hand may go negative).
      </div>

      {ok ? (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 10,
            border: "1px solid rgba(128,128,128,0.25)",
            background: "var(--background)",
            color: "var(--foreground)",
          }}
        >
          ✅ Checkout submitted.
        </div>
      ) : null}

      {err ? (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 10,
            border: "1px solid rgba(220,53,69,0.45)",
            background: "rgba(220,53,69,0.08)",
            color: "var(--foreground)",
          }}
        >
          Checkout failed: {err}
        </div>
      ) : null}

      {!perms.allowAll && locations.length === 0 ? (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 10,
            border: "1px solid rgba(128,128,128,0.25)",
            background: "var(--background)",
            color: "var(--foreground)",
          }}
        >
          ⚠️ No stores are assigned to your account yet. Ask an admin to assign your primary/optional locations.
        </div>
      ) : null}

      <form
        action={checkoutAction}
        style={{
          border: "1px solid rgba(128,128,128,0.25)",
          borderRadius: 10,
          padding: 16,
          display: "grid",
          gap: 12,
          background: "var(--background)",
          color: "var(--foreground)",
        }}
      >
        <label style={labelStyle}>
          <span style={{ fontWeight: 700 }}>Part (Item)</span>

          {/* ✅ Searchable picker (SKU, part#, name, etc.) */}
          <div style={{ marginTop: 2 }}>
            <ItemPicker name="itemId" items={items} placeholder="Search ID, SKU, part #, name, category, manufacturer…" />
          </div>

          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Tip: search by <b>ID</b>, <b>SKU</b>, <b>Part #</b>, <b>Name</b>, <b>Category</b>, or <b>Manufacturer</b>.
          </div>
        </label>

        <div style={twoCol}>
          <label style={labelStyle}>
            <span style={{ fontWeight: 700 }}>Store (Location)</span>
            <select name="storeId" required style={fieldStyle} disabled={!perms.allowAll && locations.length === 0}>
              <option value="">Select a store…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            <span style={{ fontWeight: 700 }}>Quantity taken</span>
            <input name="quantity" type="number" min={1} step={1} required defaultValue={1} style={fieldStyle} />
          </label>
        </div>

        <label style={labelStyle}>
          <span style={{ fontWeight: 700 }}>Created by</span>
          <select name="createdByUserId" required defaultValue={sessionUserId ?? ""} style={fieldStyle}>
            <option value="">Select user…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role})
              </option>
            ))}
          </select>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Defaults to your session user. Can be changed to another maintenance user.
          </div>
        </label>

        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="checkbox" name="needToOrderMore" />
          <span style={{ fontWeight: 700 }}>Need to order more</span>
        </label>

        <label style={labelStyle}>
          <span style={{ fontWeight: 700 }}>Note (optional)</span>
          <input name="note" placeholder="Optional note…" style={fieldStyle} />
        </label>

        <button
          type="submit"
          style={{
            padding: "10px 12px",
            fontWeight: 800,
            width: 220,
            borderRadius: 10,
            background: "var(--checkout-submit-bg, rgba(33, 150, 243, 0.18))",
            border: "1px solid var(--checkout-submit-border, rgba(33, 150, 243, 0.55))",
            color: "var(--foreground)",
            cursor: "pointer",
          }}
          disabled={!perms.allowAll && locations.length === 0}
        >
          Submit Checkout
        </button>

        <div style={{ fontSize: 12, opacity: 0.75 }}>
          Alerts created when: onHand goes negative, available falls below min, or “Need to order more” is checked.
        </div>
      </form>
    </div>
  );
}