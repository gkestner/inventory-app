// app/admin/live-orders/page.tsx
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { loadUserPermissions } from "@/app/lib/permissions";
import { Permission, Role } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

async function requireLiveOrdersView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const role = (session.user as unknown as { role?: Role | null } | null)?.role ?? null;
  if (role !== Role.ADMIN) redirect("/");

  // If your app uses fine-grained perms, keep this check.
  // (Admins often have allowAll; this is consistent with your other admin pages.)
  const perms = await loadUserPermissions(session as any);
  if (!perms?.allowAll) {
    const ok =
      perms?.permissions?.includes(Permission.ADMIN_VIEW_ITEMS) ||
      perms?.permissions?.includes(Permission.ADMIN_VIEW_WORK_ORDERS) ||
      perms?.permissions?.includes(Permission.ADMIN_IMPORT_EXPORT_ITEMS);
    if (!ok) redirect("/");
  }

  return session;
}

function fmtDate(iso: string | Date | null | undefined) {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizePhase(v: unknown): "ORDERED" | "ARRIVED" | "COMPLETED" {
  const s = String(v ?? "").toUpperCase();
  if (s.includes("COMP")) return "COMPLETED";
  if (s.includes("ARRIV") || s.includes("PROC")) return "ARRIVED";
  return "ORDERED";
}

async function getClientIp() {
  const h = headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "";
}

/**
 * NOTE:
 * This page is intentionally server-first and self-contained.
 * It expects your existing Inventory Orders schema:
 * - inventoryOrder (id, vendor/orderFrom?, phase, createdAt, note?)
 * - inventoryOrderLine (id, orderId, itemId, qty, qtyForTech?, qtyForStore?, createdAt?)
 * - item (id, sku, name, orderFrom, orderedQty, onHandQty, cost, etc.)
 *
 * If any field names differ slightly in your schema, adjust ONLY the Prisma select/include blocks below.
 */
export default async function LiveOrdersPage() {
  await requireLiveOrdersView();

  // Pull recent operational work. Keep it bounded so the board stays fast.
  // If you want a longer window, increase daysBack.
  const daysBack = 120;
  const minDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  // We fetch orders + lines + item and then render “cards” per line.
  // If your relation names differ, update include keys accordingly.
  const orders = (await prisma.inventoryOrder.findMany({
    where: {
      createdAt: { gte: minDate },
    },
    orderBy: [{ createdAt: "desc" }],
    include: {
      lines: {
        include: {
          item: true,
        },
      },
    },
  })) as any[];

  const cards = orders.flatMap((o) => {
    const phase = normalizePhase(o.phase);
    const orderedAt = o.createdAt ?? null;

    const vendor = o.vendor ?? o.orderFrom ?? o.supplier ?? null;

    const lines: any[] = Array.isArray(o.lines) ? o.lines : [];
    return lines.map((ln) => {
      const item = ln.item ?? null;

      const qty = Number(ln.qty ?? ln.quantity ?? 0);
      const forTech = Number(ln.qtyForTech ?? ln.forTechQty ?? 0);
      const forStore = Number(ln.qtyForStore ?? ln.forStoreQty ?? 0);

      const sku = String(item?.sku ?? "");
      const name = String(item?.name ?? "");

      const supplier =
        String(item?.orderFrom ?? vendor ?? item?.vendor ?? "").trim() || "—";

      return {
        phase,
        orderId: String(o.id),
        lineId: String(ln.id),
        itemId: String(item?.id ?? ln.itemId ?? ""),
        sku,
        name,
        qty,
        forTech,
        forStore,
        supplier,
        orderedAt,
      };
    });
  });

  const ordered = cards.filter((c) => c.phase === "ORDERED");
  const arrived = cards.filter((c) => c.phase === "ARRIVED");
  const completed = cards.filter((c) => c.phase === "COMPLETED");

  async function markArrived(formData: FormData) {
    "use server";

    const orderId = String(formData.get("orderId") ?? "");
    if (!orderId) return;

    await prisma.$transaction(async (tx) => {
      const existing = (await tx.inventoryOrder.findUnique({
        where: { id: orderId },
        select: { id: true, phase: true, note: true },
      })) as any;

      if (!existing) return;

      // Idempotent-ish: if already arrived/completed, do nothing.
      const current = normalizePhase(existing.phase);
      if (current !== "ORDERED") return;

      const ip = await getClientIp();

      const stamp = `[LIVE-ORDERS] Mark Arrived @ ${new Date().toISOString()} ip=${ip}`;
      const note = existing.note ? `${existing.note}\n${stamp}` : stamp;

      await tx.inventoryOrder.update({
        where: { id: orderId },
        data: {
          phase: "ARRIVED",
          note,
        } as any,
      });
    });

    revalidatePath("/admin/live-orders");
    revalidatePath("/admin/inventory-orders");
  }

  async function addToInventory(formData: FormData) {
    "use server";

    const lineId = String(formData.get("lineId") ?? "");
    if (!lineId) return;

    await prisma.$transaction(async (tx) => {
      const ln = (await tx.inventoryOrderLine.findUnique({
        where: { id: lineId },
        include: { item: true, order: true },
      })) as any;

      if (!ln || !ln.item) return;

      const orderId = String(ln.order?.id ?? ln.orderId ?? "");
      const itemId = String(ln.item.id ?? ln.itemId ?? "");
      const moveQty = Number(ln.qty ?? ln.quantity ?? 0);

      if (!orderId || !itemId || !Number.isFinite(moveQty) || moveQty <= 0) return;

      // Ensure the order is at least ARRIVED before adding to inventory.
      const phase = normalizePhase(ln.order?.phase);
      if (phase === "ORDERED") return;

      const item = (await tx.item.findUnique({
        where: { id: itemId },
        select: {
          id: true,
          orderedQty: true,
          onHandQty: true,
          cost: true,
          orderFrom: true,
        },
      })) as any;

      if (!item) return;

      const orderedQty = Number(item.orderedQty ?? 0);
      const onHandQty = Number(item.onHandQty ?? 0);

      // Safe inventory guards
      if (!Number.isFinite(orderedQty) || !Number.isFinite(onHandQty)) return;
      if (orderedQty < moveQty) {
        // Guard against going negative — do nothing if out of sync.
        return;
      }

      const ip = await getClientIp();
      const stamp = `[LIVE-ORDERS] Add to Inventory line=${lineId} qty=${moveQty} @ ${new Date().toISOString()} ip=${ip}`;

      // Atomic move:
      // - onHandQty += moveQty
      // - orderedQty -= moveQty
      // - mark order completed if all lines are effectively processed (best-effort)
      await tx.item.update({
        where: { id: itemId },
        data: {
          onHandQty: onHandQty + moveQty,
          orderedQty: orderedQty - moveQty,
        } as any,
      });

      // Append audit to order note (keeps your “full audit lines in note” pattern)
      const existingOrder = (await tx.inventoryOrder.findUnique({
        where: { id: orderId },
        select: { id: true, note: true },
      })) as any;

      if (existingOrder) {
        const note = existingOrder.note ? `${existingOrder.note}\n${stamp}` : stamp;
        await tx.inventoryOrder.update({
          where: { id: orderId },
          data: { note } as any,
        });
      }

      // Best-effort completion:
      // If the *sum of remaining orderedQty on items for this order* is 0, set COMPLETED.
      // (This avoids relying on extra per-line fields; adjust if you track received/added per line.)
      const orderWithLines = (await tx.inventoryOrder.findUnique({
        where: { id: orderId },
        include: { lines: { include: { item: true } } },
      })) as any;

      if (orderWithLines) {
        const anyRemaining = (orderWithLines.lines ?? []).some((l: any) => {
          const it = l.item;
          const q = Number(l.qty ?? l.quantity ?? 0);
          const itOrdered = Number(it?.orderedQty ?? 0);
          // Heuristic: if the item still has any orderedQty, treat as remaining.
          // If you want strict per-order tracking, replace this with your per-line “remaining” field.
          return q > 0 && itOrdered > 0;
        });

        if (!anyRemaining) {
          await tx.inventoryOrder.update({
            where: { id: orderId },
            data: { phase: "COMPLETED" } as any,
          });
        }
      }
    });

    revalidatePath("/admin/live-orders");
    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/items");
  }

  const pageWrap: CSSProperties = {
    padding: 16,
    maxWidth: 1400,
    margin: "0 auto",
  };

  const colsWrap: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 12,
    alignItems: "start",
  };

  const colStyle: CSSProperties = {
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 12,
    background: "#fff",
    minHeight: 200,
  };

  const colHeader: CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 10,
  };

  const badge: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 12,
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
  };

  const cardBase: CSSProperties = {
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    padding: 10,
    background: "#fff",
    marginBottom: 10,
  };

  const cardOrdered: CSSProperties = {
    ...cardBase,
    borderLeft: "6px solid #f59e0b",
    background: "#fffbeb",
  };

  const cardArrived: CSSProperties = {
    ...cardBase,
    borderLeft: "6px solid #3b82f6",
    background: "#eff6ff",
  };

  const cardCompleted: CSSProperties = {
    ...cardBase,
    borderLeft: "6px solid #10b981",
    background: "#ecfdf5",
  };

  const row: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap" };
  const meta: CSSProperties = { fontSize: 12, color: "#374151" };
  const title: CSSProperties = { fontWeight: 700, fontSize: 13, marginBottom: 6 };
  const sku: CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };

  const btn: CSSProperties = {
    border: "1px solid #111827",
    background: "#111827",
    color: "#fff",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 12,
    cursor: "pointer",
  };

  const btnSecondary: CSSProperties = {
    border: "1px solid #111827",
    background: "#fff",
    color: "#111827",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 12,
    cursor: "pointer",
  };

  const empty: CSSProperties = {
    color: "#6b7280",
    fontSize: 13,
    padding: 8,
    border: "1px dashed #d1d5db",
    borderRadius: 10,
    background: "#fafafa",
  };

  function Card({
    c,
    variant,
  }: {
    c: any;
    variant: "ORDERED" | "ARRIVED" | "COMPLETED";
  }) {
    const style =
      variant === "ORDERED" ? cardOrdered : variant === "ARRIVED" ? cardArrived : cardCompleted;

    return (
      <div style={style} key={c.lineId}>
        <div style={title}>
          <span style={sku}>{c.sku}</span> — {c.name}
        </div>

        <div style={row}>
          <div style={meta}>
            <strong>Qty:</strong> {c.qty}
          </div>
          <div style={meta}>
            <strong>Supplier:</strong> {c.supplier}
          </div>
          <div style={meta}>
            <strong>Ordered:</strong> {fmtDate(c.orderedAt)}
          </div>
        </div>

        <div style={{ ...row, marginTop: 6 }}>
          <div style={meta}>
            <strong>For tech:</strong> {c.forTech || 0}
          </div>
          <div style={meta}>
            <strong>For store:</strong> {c.forStore || 0}
          </div>
        </div>

        {variant === "ORDERED" ? (
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <form action={markArrived}>
              <input type="hidden" name="orderId" value={c.orderId} />
              <button style={btn} type="submit">
                Mark Arrived
              </button>
            </form>
          </div>
        ) : null}

        {variant === "ARRIVED" ? (
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <form action={addToInventory}>
              <input type="hidden" name="lineId" value={c.lineId} />
              <button style={btn} type="submit">
                Add to Inventory
              </button>
            </form>

            <form action={markArrived}>
              <input type="hidden" name="orderId" value={c.orderId} />
              <button style={btnSecondary} type="submit" title="No-op if already ARRIVED">
                Re-stamp Arrived
              </button>
            </form>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <main style={pageWrap}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Live Orders Board</h1>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Window: last {daysBack} days • Refreshes on action
        </div>
      </div>

      <div style={{ marginTop: 12, ...colsWrap }}>
        {/* ORDERED */}
        <section style={colStyle}>
          <div style={colHeader}>
            <div style={{ fontWeight: 800 }}>ORDERED</div>
            <span style={badge}>{ordered.length}</span>
          </div>
          {ordered.length === 0 ? (
            <div style={empty}>No ordered items in the current window.</div>
          ) : (
            ordered.map((c) => <Card key={c.lineId} c={c} variant="ORDERED" />)
          )}
        </section>

        {/* ARRIVED / PROCESSING */}
        <section style={colStyle}>
          <div style={colHeader}>
            <div style={{ fontWeight: 800 }}>ARRIVED / PROCESSING</div>
            <span style={badge}>{arrived.length}</span>
          </div>
          {arrived.length === 0 ? (
            <div style={empty}>No arrived/processing items right now.</div>
          ) : (
            arrived.map((c) => <Card key={c.lineId} c={c} variant="ARRIVED" />)
          )}
        </section>

        {/* COMPLETED */}
        <section style={colStyle}>
          <div style={colHeader}>
            <div style={{ fontWeight: 800 }}>COMPLETED</div>
            <span style={badge}>{completed.length}</span>
          </div>
          {completed.length === 0 ? (
            <div style={empty}>No completed items in the current window.</div>
          ) : (
            completed.map((c) => <Card key={c.lineId} c={c} variant="COMPLETED" />)
          )}
        </section>
      </div>
    </main>
  );
}