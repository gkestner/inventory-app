// app/admin/maintenance-tickets/[id]/invoice/page.tsx
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";

export const dynamic = "force-dynamic";

type AdminSession = Session & {
  user: Session["user"] & {
    role?: string;
    id?: string;
    name?: string | null;
  };
};

function isAdminSession(session: Session | null): session is AdminSession {
  const u = session?.user as unknown;
  if (!u || typeof u !== "object") return false;
  const role = (u as { role?: unknown }).role;
  return typeof role === "string" && role === "ADMIN";
}

async function requireAdmin(): Promise<AdminSession> {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!isAdminSession(session)) redirect("/");
  return session;
}

type InvoiceParams =
  | Promise<{ id: string }>
  | { id: string };

function money(v: unknown): string {
  return v == null ? "—" : String(v);
}

export default async function InvoicePage({
  params,
}: {
  // Support both shapes: some of your pages use Promise-wrapped props
  params: InvoiceParams;
}) {
  await requireAdmin();

  const p = (await params) as { id?: string };
  const ticketId = String(p?.id || "");

  if (!ticketId) {
    return (
      <div style={{ padding: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 900, marginBottom: 10 }}>Invoice</h1>
        <div style={{ opacity: 0.85, marginBottom: 14 }}>Missing ticket id in route params.</div>
        <a href="/admin/maintenance-tickets" style={{ textDecoration: "underline" }}>
          ← Back to tickets
        </a>
      </div>
    );
  }

  const ticket = await prisma.partsCheckoutTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      invoicedAt: true,
      voidedAt: true,
      voidNote: true,

      storeName: true,
      createdByName: true,
      quantity: true,
      needToOrderMore: true,
      note: true,

      skuSnapshot: true,
      partNumberSnapshot: true,
      nameSnapshot: true,
      costSnapshot: true,
      priceSnapshot: true,
      taxableSnapshot: true,
    },
  });

  if (!ticket) {
    return (
      <div style={{ padding: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 900, marginBottom: 10 }}>Invoice</h1>
        <div style={{ opacity: 0.85, marginBottom: 14 }}>Ticket not found.</div>
        <a href="/admin/maintenance-tickets" style={{ textDecoration: "underline" }}>
          ← Back to tickets
        </a>
      </div>
    );
  }

  const alerts = await prisma.inventoryAlert.findMany({
    where: { checkoutId: ticket.id },
    orderBy: [{ resolvedAt: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      type: true,
      createdAt: true,
      note: true,
      qtyDelta: true,
      onHandAfter: true,
      orderedAfter: true,
      availableAfter: true,
      minQtyAtTime: true,
      resolvedAt: true,
      resolvedByName: true,
    },
  });

  async function resolveAlertAction(formData: FormData): Promise<void> {
    "use server";
    const s = await getServerSession(authOptions);
    if (!isAdminSession(s)) throw new Error("Forbidden");

    const alertId = String(formData.get("alertId") || "");
    const note = String(formData.get("note") || "").trim();
    if (!alertId) throw new Error("Missing alertId");

    const adminId = typeof s.user.id === "string" ? s.user.id : null;
    const adminName = typeof s.user.name === "string" && s.user.name ? s.user.name : "ADMIN";

    await prisma.inventoryAlert.update({
      where: { id: alertId },
      data: {
        resolvedAt: new Date(),
        resolvedByUserId: adminId,
        resolvedByName: adminName,
        ...(note ? { note } : {}),
      },
    });

    revalidatePath(`/admin/maintenance-tickets/${ticketId}/invoice`);
    revalidatePath("/admin/inventory-alerts");
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>Invoice</h1>
          <div style={{ opacity: 0.85 }}>
            Ticket <span style={{ fontFamily: "monospace", fontWeight: 800 }}>{ticket.id}</span> •{" "}
            <b>{ticket.status}</b>
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 900 }}>{ticket.storeName}</div>
          <div style={{ opacity: 0.85 }}>Tech: {ticket.createdByName}</div>
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          border: "1px solid var(--border, rgba(0,0,0,0.2))",
          borderRadius: 14,
          padding: 14,
        }}
      >
        <div style={{ fontFamily: "monospace", fontWeight: 900 }}>
          {ticket.skuSnapshot}
          {ticket.partNumberSnapshot ? ` — ${ticket.partNumberSnapshot}` : ""} — {ticket.nameSnapshot}
        </div>

        <div style={{ marginTop: 8, display: "flex", gap: 18, flexWrap: "wrap" }}>
          <div>
            <div style={{ opacity: 0.8, fontSize: 12 }}>Quantity</div>
            <div style={{ fontWeight: 900 }}>{ticket.quantity}</div>
          </div>
          <div>
            <div style={{ opacity: 0.8, fontSize: 12 }}>Cost snapshot</div>
            <div style={{ fontWeight: 900 }}>{money(ticket.costSnapshot)}</div>
          </div>
          <div>
            <div style={{ opacity: 0.8, fontSize: 12 }}>Price snapshot</div>
            <div style={{ fontWeight: 900 }}>{money(ticket.priceSnapshot)}</div>
          </div>
          <div>
            <div style={{ opacity: 0.8, fontSize: 12 }}>Taxable</div>
            <div style={{ fontWeight: 900 }}>{ticket.taxableSnapshot ? "Yes" : "No"}</div>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
          Created: {new Date(ticket.createdAt).toLocaleString()}
          {ticket.invoicedAt ? ` • Invoiced: ${new Date(ticket.invoicedAt).toLocaleString()}` : ""}
          {ticket.voidedAt ? ` • Voided: ${new Date(ticket.voidedAt).toLocaleString()}` : ""}
        </div>

        {ticket.needToOrderMore ? <div style={{ marginTop: 10, fontWeight: 900 }}>Need to order more: YES</div> : null}

        {ticket.note ? (
          <div style={{ marginTop: 10 }}>
            <div style={{ opacity: 0.8, fontSize: 12 }}>Note</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{ticket.note}</div>
          </div>
        ) : null}

        {ticket.voidNote ? (
          <div style={{ marginTop: 10 }}>
            <div style={{ opacity: 0.8, fontSize: 12 }}>Void reason</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{ticket.voidNote}</div>
          </div>
        ) : null}
      </div>

      <h2 style={{ marginTop: 18, fontSize: 16, fontWeight: 900 }}>Alerts for this ticket</h2>

      {alerts.length === 0 ? (
        <div style={{ opacity: 0.8, marginTop: 8 }}>No alerts linked to this checkout.</div>
      ) : (
        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {alerts.map((a) => (
            <div
              key={a.id}
              style={{
                border: "1px solid var(--border, rgba(0,0,0,0.2))",
                borderRadius: 14,
                padding: 12,
                opacity: a.resolvedAt ? 0.7 : 1,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 900 }}>
                  {a.type} {a.resolvedAt ? "• RESOLVED" : ""}
                </div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>{new Date(a.createdAt).toLocaleString()}</div>
              </div>

              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>
                qtyDelta: {a.qtyDelta ?? "—"} • onHandAfter: {a.onHandAfter ?? "—"} • orderedAfter:{" "}
                {a.orderedAfter ?? "—"} • availableAfter: {a.availableAfter ?? "—"} • minQtyAtTime:{" "}
                {a.minQtyAtTime ?? "—"}
              </div>

              {a.note ? <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{a.note}</div> : null}

              {a.resolvedAt ? (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  Resolved: {new Date(a.resolvedAt).toLocaleString()}
                  {a.resolvedByName ? ` • by ${a.resolvedByName}` : ""}
                </div>
              ) : (
                <form action={resolveAlertAction} style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input type="hidden" name="alertId" value={a.id} />
                  <input
                    name="note"
                    placeholder="Resolution note (optional)…"
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid var(--border, rgba(0,0,0,0.2))",
                      background: "transparent",
                      color: "inherit",
                      minWidth: 280,
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid var(--border, rgba(0,0,0,0.2))",
                      background: "transparent",
                      color: "inherit",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Resolve Alert
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <a href="/admin/maintenance-tickets" style={{ textDecoration: "underline" }}>
          ← Back to tickets
        </a>
      </div>
    </div>
  );
}
