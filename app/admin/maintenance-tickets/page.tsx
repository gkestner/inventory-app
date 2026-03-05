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
      taxableSnapshot: true,
      createdAt: true,
      itemId: true,
    },
  });

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

      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Maintenance Tickets</h1>
      <div style={{ opacity: 0.8, marginBottom: 12 }}>
        Review part checkouts. Mark invoiced or void (void restores inventory atomically).
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
            </div>
          </div>
        );
      })}

      {tickets.length === 0 ? <div style={{ opacity: 0.8 }}>No tickets match your filters.</div> : null}
    </div>
  );
}