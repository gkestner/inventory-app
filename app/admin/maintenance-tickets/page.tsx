// app/admin/maintenance-tickets/page.tsx
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { canAccessAdmin } from "@/app/lib/admin-access";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { PartsCheckoutStatus, Prisma, InventoryAlertType } from "@prisma/client";
import type { Session } from "next-auth";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  status?: string; // OPEN | INVOICED | VOIDED | all
};

type AdminSession = Session & {
  user: Session["user"] & {
    id?: string;
    name?: string | null;
  };
};

async function requireAdmin(): Promise<AdminSession> {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!(await canAccessAdmin(session))) redirect("/");
  return session;
}

function normStatus(v: string | undefined) {
  const s = (v || "OPEN").toUpperCase();
  if (s === "ALL") return "all";
  if (s === "OPEN" || s === "INVOICED" || s === "VOIDED") return s as PartsCheckoutStatus;
  return "OPEN" as PartsCheckoutStatus;
}

function userAssignedToStore(
  user: { locationId: string | null; allowedLocations: Array<{ locationId: string }> },
  storeId: string
): boolean {
  if (user.locationId === storeId) return true;
  return user.allowedLocations.some((x) => x.locationId === storeId);
}

export default async function MaintenanceTicketsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const sp = await searchParams;

  const q = (sp.q || "").trim();
  const status = normStatus(sp.status);

  async function markInvoicedAction(formData: FormData) {
    "use server";
    const session = await getServerSession(authOptions);
    if (!(await canAccessAdmin(session))) throw new Error("Forbidden");

    const id = String(formData.get("id") || "");
    if (!id) throw new Error("Missing ticket id");

    await prisma.partsCheckoutTicket.update({
      where: { id },
      data: {
        status: "INVOICED",
        invoicedAt: new Date(),
      },
    });

    revalidatePath("/admin/maintenance-tickets");
    revalidatePath(`/admin/maintenance-tickets/${id}/invoice`);
  }

  async function editTicketAction(formData: FormData) {
    "use server";
    const session = await getServerSession(authOptions);
    if (!(await canAccessAdmin(session))) throw new Error("Forbidden");

    const id = String(formData.get("id") || "").trim();
    const itemId = String(formData.get("itemId") || "").trim();
    const storeId = String(formData.get("storeId") || "").trim();
    const createdByUserId = String(formData.get("createdByUserId") || "").trim();
    const quantity = Number(String(formData.get("quantity") || "").trim());
    if (!id) throw new Error("Missing ticket id");
    if (!itemId) throw new Error("Missing item");
    if (!storeId) throw new Error("Missing store");
    if (!createdByUserId) throw new Error("Missing tech");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Invalid quantity");

    const noteRaw = String(formData.get("note") ?? "").trim();
    const note = noteRaw ? noteRaw : null;
    const needToOrderMore = String(formData.get("needToOrderMore") || "") === "1";

    await prisma.$transaction(async (tx) => {
      const existing = await tx.partsCheckoutTicket.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          itemId: true,
          storeId: true,
          quantity: true,
        },
      });
      if (!existing) throw new Error("Ticket not found");
      if (existing.status !== "OPEN") {
        throw new Error("Only OPEN tickets can edit item, store, quantity, and tech.");
      }

      const store = await tx.location.findUnique({
        where: { id: storeId },
        select: { id: true, name: true, active: true, receiptEnabled: true },
      });
      if (!store || !store.active || !store.receiptEnabled) throw new Error("Store not found");

      const createdBy = await tx.user.findUnique({
        where: { id: createdByUserId },
        select: {
          id: true,
          name: true,
          active: true,
          locationId: true,
          allowedLocations: { select: { locationId: true } },
        },
      });
      if (!createdBy || !createdBy.active) throw new Error("Created-by user not found");
      if (!userAssignedToStore(createdBy, storeId)) {
        throw new Error("Selected user is not assigned to the selected store.");
      }

      const itemIds = Array.from(new Set([existing.itemId, itemId]));
      const itemsForAdjust = await tx.item.findMany({
        where: { id: { in: itemIds } },
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
        },
      });

      const itemMap = new Map(itemsForAdjust.map((i) => [i.id, i]));
      const originalItem = itemMap.get(existing.itemId);
      const nextItem = itemMap.get(itemId);
      if (!originalItem) throw new Error("Original ticket item not found");
      if (!nextItem) throw new Error("Selected item not found");

      // Snapshot all touched items before applying rebalance.
      for (const item of itemsForAdjust) {
        const latest = await tx.itemVersion.findFirst({
          where: { itemId: item.id },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        const nextVersion = (latest?.version ?? 0) + 1;

        await tx.itemVersion.create({
          data: {
            itemId: item.id,
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
      }

      let onHandAfter = 0;
      let orderedAfter = 0;
      let minQtyAtTime = 0;

      if (existing.itemId === itemId) {
        const usedAfter = originalItem.usedQty - existing.quantity + quantity;
        if (usedAfter < 0) {
          throw new Error("Cannot apply edit: ticket appears partially returned. Void and recreate instead.");
        }

        const updated = await tx.item.update({
          where: { id: itemId },
          data: {
            onHandQty: originalItem.onHandQty + existing.quantity - quantity,
            usedQty: usedAfter,
          },
          select: { onHandQty: true, orderedQty: true, minQty: true },
        });

        onHandAfter = updated.onHandQty;
        orderedAfter = updated.orderedQty;
        minQtyAtTime = updated.minQty;
      } else {
        if (originalItem.usedQty < existing.quantity) {
          throw new Error("Cannot move ticket: original item usage is lower than this ticket quantity.");
        }

        await tx.item.update({
          where: { id: existing.itemId },
          data: {
            onHandQty: { increment: existing.quantity },
            usedQty: { decrement: existing.quantity },
          },
          select: { id: true },
        });

        const updatedNext = await tx.item.update({
          where: { id: itemId },
          data: {
            onHandQty: { decrement: quantity },
            usedQty: { increment: quantity },
          },
          select: { onHandQty: true, orderedQty: true, minQty: true },
        });

        onHandAfter = updatedNext.onHandQty;
        orderedAfter = updatedNext.orderedQty;
        minQtyAtTime = updatedNext.minQty;
      }

      const availableAfter = onHandAfter + orderedAfter;

      await tx.partsCheckoutTicket.update({
        where: { id },
        data: {
          itemId,
          storeId,
          storeName: store.name,
          quantity,
          needToOrderMore,
          createdByUserId,
          createdByName: createdBy.name,
          note,
          skuSnapshot: nextItem.sku,
          partNumberSnapshot: nextItem.partNumber,
          nameSnapshot: nextItem.name,
          vendorSnapshot: nextItem.vendor,
          costSnapshot: nextItem.cost,
          priceSnapshot: nextItem.price,
          taxableSnapshot: nextItem.taxable,
        },
      });

      await tx.inventoryAlert.deleteMany({
        where: {
          checkoutId: id,
          resolvedAt: null,
        },
      });

      if (onHandAfter < 0) {
        await tx.inventoryAlert.create({
          data: {
            type: "NEGATIVE_ON_HAND",
            itemId,
            storeId,
            storeName: store.name,
            checkoutId: id,
            createdByUserId,
            createdByName: createdBy.name,
            qtyDelta: -quantity,
            onHandAfter,
            orderedAfter,
            availableAfter,
            minQtyAtTime,
            note: "Checkout edited: on-hand is negative after recalculation.",
          },
        });
      }

      if (availableAfter < minQtyAtTime) {
        await tx.inventoryAlert.create({
          data: {
            type: "BELOW_MIN",
            itemId,
            storeId,
            storeName: store.name,
            checkoutId: id,
            createdByUserId,
            createdByName: createdBy.name,
            qtyDelta: -quantity,
            onHandAfter,
            orderedAfter,
            availableAfter,
            minQtyAtTime,
            note: "Checkout edited: available quantity is below min after recalculation.",
          },
        });
      }

      if (needToOrderMore) {
        await tx.inventoryAlert.create({
          data: {
            type: InventoryAlertType.TECH_REQUEST_ORDER,
            itemId,
            storeId,
            storeName: store.name,
            checkoutId: id,
            createdByUserId,
            createdByName: createdBy.name,
            qtyDelta: -quantity,
            onHandAfter,
            orderedAfter,
            availableAfter,
            minQtyAtTime,
            note: note ? `Checkout edited: ${note}` : "Checkout edited: technician requested ordering more.",
          },
        });
      }
    });

    revalidatePath("/admin/maintenance-tickets");
    revalidatePath(`/admin/maintenance-tickets/${id}/invoice`);
    revalidatePath("/maintenance/checkout");
    revalidatePath("/admin/inventory-alerts");
    revalidatePath("/admin/reports/checkout-orders");
    revalidatePath("/admin/reports/needs-ordering");
  }

  async function voidRestoreAction(formData: FormData) {
    "use server";
    const session = await getServerSession(authOptions);
    if (!session || !(await canAccessAdmin(session))) throw new Error("Forbidden");

    const ticketId = String(formData.get("id") || "");
    const voidNote = String(formData.get("voidNote") || "").trim();
    if (!ticketId) throw new Error("Missing ticket id");
    if (!voidNote) throw new Error("Void reason required");

    const adminName = session.user.name ?? "ADMIN";
    const adminId = session.user.id ?? null;

    await prisma.$transaction(async (tx) => {
      const ticket = await tx.partsCheckoutTicket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          status: true,
          itemId: true,
          storeId: true,
          storeName: true,
          quantity: true,
        },
      });

      if (!ticket) throw new Error("Ticket not found");
      if (ticket.status === "VOIDED") return;

      const item = await tx.item.findUnique({
        where: { id: ticket.itemId },
        select: {
          id: true,
          sku: true,
          partNumber: true,
          name: true,
          description: true,
          category: true,
          // ✅ unit removed
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
      if (!item) throw new Error("Item not found for ticket");

      const last = await tx.itemVersion.findFirst({
        where: { itemId: item.id },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const nextVersion = (last?.version ?? 0) + 1;

      await tx.itemVersion.create({
        data: {
          itemId: item.id,
          sku: item.sku,
          partNumber: item.partNumber,
          name: item.name,
          description: item.description,
          category: item.category,
          // ✅ unit removed
          cost: item.cost,
          price: item.price,
          taxable: item.taxable,
          active: item.active,
          onHandQty: item.onHandQty,
          orderedQty: item.orderedQty,
          usedQty: item.usedQty,
          minQty: item.minQty,
          version: nextVersion,
        },
      });

      const restored = await tx.item.update({
        where: { id: item.id },
        data: {
          onHandQty: { increment: ticket.quantity },
          usedQty: { decrement: ticket.quantity },
        },
        select: { onHandQty: true, orderedQty: true, minQty: true },
      });

      const availableAfter = restored.onHandQty + restored.orderedQty;

      await tx.partsCheckoutTicket.update({
        where: { id: ticket.id },
        data: {
          status: "VOIDED",
          voidedAt: new Date(),
          voidNote,
        },
      });

      await tx.inventoryAlert.create({
        data: {
          type: InventoryAlertType.TECH_REQUEST_ORDER,
          itemId: item.id,
          storeId: ticket.storeId,
          storeName: ticket.storeName,
          checkoutId: ticket.id,

          createdByUserId: adminId,
          createdByName: adminName,

          qtyDelta: ticket.quantity,
          onHandAfter: restored.onHandQty,
          orderedAfter: restored.orderedQty,
          availableAfter,
          minQtyAtTime: restored.minQty,

          note: `[VOID RESTORE] Ticket voided + inventory restored. Reason: ${voidNote}`,
        },
      });
    });

    revalidatePath("/admin/maintenance-tickets");
    revalidatePath("/admin/inventory-alerts");
    revalidatePath(`/admin/maintenance-tickets/${ticketId}/invoice`);
  }

  const where: Prisma.PartsCheckoutTicketWhereInput = {
    ...(status === "all" ? {} : { status }),
    ...(q
      ? {
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { storeName: { contains: q, mode: "insensitive" } },
            { createdByName: { contains: q, mode: "insensitive" } },
            { skuSnapshot: { contains: q, mode: "insensitive" } },
            { partNumberSnapshot: { contains: q, mode: "insensitive" } },
            { nameSnapshot: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const tickets = await prisma.partsCheckoutTicket.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      storeName: true,
      createdByName: true,
      skuSnapshot: true,
      partNumberSnapshot: true,
      nameSnapshot: true,
      quantity: true,
      needToOrderMore: true,
      note: true,
      taxableSnapshot: true,
      createdAt: true,
      itemId: true,
      storeId: true,
      createdByUserId: true,
    },
  });

  const [stores, users, itemsForEdit] = await Promise.all([
    prisma.location.findMany({
      where: { active: true, receiptEnabled: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
      },
    }),
    prisma.item.findMany({
      where: { active: true },
      orderBy: [{ sku: "asc" }, { partNumber: "asc" }, { name: "asc" }],
      take: 2000,
      select: {
        id: true,
        sku: true,
        partNumber: true,
        name: true,
      },
    }),
  ]);

  const controlStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid currentColor",
    background: "transparent",
    color: "inherit",
    fontWeight: 900,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };

  const inputStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid currentColor",
    background: "transparent",
    color: "inherit",
    minWidth: 240,
  };

  return (
    <div style={{ padding: 16 }}>
      {/* DEBUG BANNER: if you don’t see this, you are not running this file */}
      <div style={{ padding: 8, border: "2px solid currentColor", borderRadius: 10, marginBottom: 12 }}>
        USING NEW maintenance-tickets/page.tsx (invoice link enabled)
      </div>

      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Maintenance Tickets (Parts Checkout)</h1>
      <div style={{ opacity: 0.8, marginBottom: 12 }}>
        Review part checkout tickets. Mark invoiced or void (void restores inventory atomically). This module is separate from Maintenance Requests.
      </div>
      <div style={{ marginBottom: 12 }}>
        <a href="/admin/maintenance-requests" style={{ textDecoration: "underline", fontWeight: 800 }}>
          Open Maintenance Requests Queue
        </a>
      </div>

      {/* ✅ NEW: Quick jump to Items search (search items from this page) */}
      <form
        method="get"
        action="/admin/items"
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "end",
          marginBottom: 14,
          padding: 12,
          border: "1px solid currentColor",
          borderRadius: 14,
        }}
      >
        <div style={{ minWidth: 420, flex: "1 1 420px" }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Search Items</div>
          <input name="q" placeholder="SKU, part #, name, category…" style={{ ...inputStyle, width: "100%" }} />
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
            This searches the Items admin page (opens in a new view).
          </div>
        </div>

        <button type="submit" style={controlStyle}>
          Go to Items →
        </button>
      </form>

      {/* Ticket filter */}
      <form method="get" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginBottom: 14 }}>
        <div style={{ minWidth: 420 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Search Tickets</div>
          <input
            name="q"
            defaultValue={q}
            placeholder="Ticket ID, store, tech, SKU, part #, item name…"
            style={{ ...inputStyle, width: "100%" }}
          />
        </div>

        <div style={{ minWidth: 240 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Status</div>
          <select name="status" defaultValue={status === "all" ? "all" : status} style={{ ...inputStyle, width: "100%" }}>
            <option value="OPEN">OPEN</option>
            <option value="INVOICED">INVOICED</option>
            <option value="VOIDED">VOIDED</option>
            <option value="all">ALL</option>
          </select>
        </div>

        <button type="submit" style={controlStyle}>
          Filter
        </button>

        <a href="/admin/maintenance-tickets" style={{ textDecoration: "underline", paddingBottom: 10 }}>
          Reset
        </a>
      </form>

      <div style={{ opacity: 0.8, marginBottom: 10 }}>Showing {tickets.length} (max 100)</div>

      {tickets.map((t) => {
        const invoiceHref = `/admin/maintenance-tickets/${t.id}/invoice`;
        const itemSearchHref = `/admin/items?q=${encodeURIComponent(t.skuSnapshot)}`;
        const itemInventoryHref = `/admin/items/${t.itemId}/inventory`;

        return (
          <div
            key={t.id}
            style={{
              border: "1px solid currentColor",
              borderRadius: 14,
              padding: 14,
              marginBottom: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 900 }}>
                  Ticket{" "}
                  <a href={invoiceHref} style={{ textDecoration: "underline", fontFamily: "monospace", color: "inherit" }}>
                    {t.id}
                  </a>
                </div>
                <div style={{ opacity: 0.85, marginTop: 2 }}>
                  {new Date(t.createdAt).toLocaleString()} • <b>{t.status}</b>
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 900 }}>{t.storeName}</div>
                <div style={{ opacity: 0.85 }}>Tech: {t.createdByName}</div>
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: "monospace", fontWeight: 800 }}>
                {t.skuSnapshot}
                {t.partNumberSnapshot ? ` — ${t.partNumberSnapshot}` : ""} — {t.nameSnapshot}
              </div>
              <div style={{ marginTop: 4, opacity: 0.9 }}>
                Qty: <b>{t.quantity}</b>
                {t.needToOrderMore ? " • Need to order more" : ""}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                Item ID: {t.itemId} • Taxable: {t.taxableSnapshot ? "Yes" : "No"}
              </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <a href={invoiceHref} style={controlStyle}>
                View Invoice →
              </a>

              {/* ✅ NEW: quick links to item pages */}
              <a href={itemSearchHref} style={controlStyle} title="Open Items page filtered by this SKU">
                View Item in Items →
              </a>
              <a href={itemInventoryHref} style={controlStyle} title="Open inventory adjustment page for this item">
                Inventory →
              </a>

              {t.status !== "INVOICED" && t.status !== "VOIDED" ? (
                <form action={markInvoicedAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <button type="submit" style={controlStyle}>
                    Mark Invoiced
                  </button>
                </form>
              ) : null}

              {t.status !== "VOIDED" ? (
                <form action={voidRestoreAction} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="hidden" name="id" value={t.id} />
                  <input name="voidNote" required placeholder="Void reason (required)…" style={inputStyle} />
                  <button type="submit" style={controlStyle}>
                    Void + Restore Inventory
                  </button>
                </form>
              ) : null}

              {t.status === "OPEN" ? (
                <details style={{ border: "1px solid currentColor", borderRadius: 10, padding: 8 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 900 }}>Edit Ticket</summary>
                  <form action={editTicketAction} style={{ marginTop: 10, display: "grid", gap: 8, minWidth: 360 }}>
                    <input type="hidden" name="id" value={t.id} />

                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 12, opacity: 0.8 }}>Item</span>
                      <select name="itemId" defaultValue={t.itemId} style={inputStyle}>
                        {itemsForEdit.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.sku}
                            {item.partNumber ? ` - ${item.partNumber}` : ""} - {item.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 12, opacity: 0.8 }}>Store</span>
                      <select name="storeId" defaultValue={t.storeId} style={inputStyle}>
                        {stores.map((store) => (
                          <option key={store.id} value={store.id}>
                            {store.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 12, opacity: 0.8 }}>Technician</span>
                      <select name="createdByUserId" defaultValue={t.createdByUserId} style={inputStyle}>
                        {users.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.name} ({user.role})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 12, opacity: 0.8 }}>Quantity</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        name="quantity"
                        defaultValue={t.quantity}
                        style={{ ...inputStyle, width: 120, minWidth: 120 }}
                        required
                      />
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="hidden" name="needToOrderMore" value="0" />
                      <input type="checkbox" name="needToOrderMore" value="1" defaultChecked={t.needToOrderMore} />
                      Need to order more
                    </label>

                    <textarea
                      name="note"
                      defaultValue={t.note ?? ""}
                      placeholder="Internal note (optional)…"
                      rows={3}
                      style={{
                        ...inputStyle,
                        width: "100%",
                        minWidth: 320,
                        resize: "vertical",
                        fontFamily: "inherit",
                      }}
                    />

                    <div>
                      <button type="submit" style={controlStyle}>
                        Save Edit
                      </button>
                    </div>
                  </form>
                </details>
              ) : null}
            </div>
          </div>
        );
      })}

      {tickets.length === 0 ? <div style={{ opacity: 0.8 }}>No tickets match your filters.</div> : null}
    </div>
  );
}