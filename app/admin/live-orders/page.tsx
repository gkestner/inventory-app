// app/admin/live-orders/page.tsx
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { loadUserPermissions } from "@/app/lib/permissions";
import { Permission, Prisma, Role } from "@prisma/client";

import AutoRefreshClient from "./AutoRefreshClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

type PermissionsResult = {
  allowAll: boolean;
  permissions: Set<Permission>;
};

type OrderWithLines = Prisma.InventoryOrderGetPayload<{
  include: {
    lines: {
      include: {
        item: true;
      };
    };
  };
}>;

type LineWithItemAndOrder = Prisma.InventoryOrderLineGetPayload<{
  include: {
    item: true;
    order: true;
  };
}>;

async function requireLiveOrdersView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const role = (session.user as unknown as { role?: Role | null } | null)?.role ?? null;
  if (role !== Role.ADMIN) redirect("/");

  const arg = session as unknown as Parameters<typeof loadUserPermissions>[0];
  const perms = (await loadUserPermissions(arg)) as unknown as PermissionsResult;

  if (!perms.allowAll) {
    const ok =
      perms.permissions.has(Permission.ADMIN_VIEW_ITEMS) ||
      perms.permissions.has(Permission.ADMIN_VIEW_WORK_ORDERS) ||
      perms.permissions.has(Permission.ADMIN_IMPORT_EXPORT_ITEMS);

    if (!ok) redirect("/");
  }

  return session;
}

function fmtDate(iso: Date | null | undefined) {
  if (!iso) return "";
  return iso.toLocaleString("en-US", {
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

function getClientIp() {
  const h = headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "";
}

type LiveOrderCard = {
  phase: "ORDERED" | "ARRIVED" | "COMPLETED";
  orderId: string;
  lineId: string;
  itemId: string;
  sku: string;
  name: string;
  qty: number;
  forTech: number;
  forStore: number;
  supplier: string;
  orderedAt: Date | null;
};

export default async function LiveOrdersPage() {
  await requireLiveOrdersView();

  const daysBack = 120;

  // eslint-disable-next-line react-hooks/purity
  const minDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  const orders: OrderWithLines[] = await prisma.inventoryOrder.findMany({
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
  });

  const cards: LiveOrderCard[] = orders.flatMap((o) => {
    const phase = normalizePhase(o.phase);
    const orderedAt = o.createdAt ?? null;

    const vendorOrSupplier =
      (o as unknown as { vendor?: string | null; orderFrom?: string | null; supplier?: string | null }).vendor ??
      (o as unknown as { vendor?: string | null; orderFrom?: string | null; supplier?: string | null }).orderFrom ??
      (o as unknown as { vendor?: string | null; orderFrom?: string | null; supplier?: string | null }).supplier ??
      null;

    return o.lines.map((ln) => {
      const item = ln.item;

      const qty = Number((ln as unknown as { qty?: number | null; quantity?: number | null }).qty ?? (ln as unknown as { quantity?: number | null }).quantity ?? 0);
      const forTech = Number(
        (ln as unknown as { qtyForTech?: number | null; forTechQty?: number | null }).qtyForTech ??
          (ln as unknown as { forTechQty?: number | null }).forTechQty ??
          0
      );
      const forStore = Number(
        (ln as unknown as { qtyForStore?: number | null; forStoreQty?: number | null }).qtyForStore ??
          (ln as unknown as { forStoreQty?: number | null }).forStoreQty ??
          0
      );

      const supplier = String(
        (item as unknown as { orderFrom?: string | null }).orderFrom ??
          vendorOrSupplier ??
          (item as unknown as { vendor?: string | null }).vendor ??
          ""
      ).trim() || "—";

      return {
        phase,
        orderId: String(o.id),
        lineId: String(ln.id),
        itemId: String(item.id),
        sku: String((item as unknown as { sku?: string | null }).sku ?? ""),
        name: String((item as unknown as { name?: string | null }).name ?? ""),
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
      const existing = await tx.inventoryOrder.findUnique({
        where: { id: orderId },
        select: { id: true, phase: true, note: true },
      });

      if (!existing) return;

      const current = normalizePhase(existing.phase);
      if (current !== "ORDERED") return;

      const ip = getClientIp();
      const stamp = `[LIVE-ORDERS] Mark Arrived @ ${new Date().toISOString()} ip=${ip}`;
      const note = existing.note ? `${existing.note}\n${stamp}` : stamp;

      await tx.inventoryOrder.update({
        where: { id: orderId },
        data: {
          phase: "ARRIVED",
          note,
        },
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
      const ln: LineWithItemAndOrder | null = await tx.inventoryOrderLine.findUnique({
        where: { id: lineId },
        include: { item: true, order: true },
      });

      if (!ln) return;

      const orderId = String(ln.order?.id ?? ln.orderId);
      const itemId = String(ln.item.id);

      const moveQty = Number(
        (ln as unknown as { qty?: number | null; quantity?: number | null }).qty ??
          (ln as unknown as { quantity?: number | null }).quantity ??
          0
      );

      if (!orderId || !itemId || !Number.isFinite(moveQty) || moveQty <= 0) return;

      const phase = normalizePhase(ln.order?.phase);
      if (phase === "ORDERED") return;

      const item = await tx.item.findUnique({
        where: { id: itemId },
        select: { id: true, orderedQty: true, onHandQty: true },
      });

      if (!item) return;

      const orderedQty = Number(item.orderedQty ?? 0);
      const onHandQty = Number(item.onHandQty ?? 0);

      if (!Number.isFinite(orderedQty) || !Number.isFinite(onHandQty)) return;
      if (orderedQty < moveQty) return; // guard: don’t go negative

      const ip = getClientIp();
      const stamp = `[LIVE-ORDERS] Add to Inventory line=${lineId} qty=${moveQty} @ ${new Date().toISOString()} ip=${ip}`;

      await tx.item.update({
        where: { id: itemId },
        data: {
          onHandQty: onHandQty + moveQty,
          orderedQty: orderedQty - moveQty,
        },
      });

      const existingOrder = await tx.inventoryOrder.findUnique({
        where: { id: orderId },
        select: { id: true, note: true },
      });

      if (existingOrder) {
        const note = existingOrder.note ? `${existingOrder.note}\n${stamp}` : stamp;
        await tx.inventoryOrder.update({
          where: { id: orderId },
          data: { note },
        });
      }

      // Best-effort completion heuristic (stable, no schema changes):
      // if no line has qty>0 AND its item orderedQty>0, mark COMPLETED.
      const orderWithLines = await tx.inventoryOrder.findUnique({
        where: { id: orderId },
        include: { lines: { include: { item: true } } },
      });

      if (orderWithLines) {
        const anyRemaining = orderWithLines.lines.some((l) => {
          const q = Number((l as unknown as { qty?: number | null; quantity?: number | null }).qty ?? (l as unknown as { quantity?: number | null }).quantity ?? 0);
          const itOrdered = Number(l.item.orderedQty ?? 0);
          return q > 0 && itOrdered > 0;
        });

        if (!anyRemaining) {
          await tx.inventoryOrder.update({
            where: { id: orderId },
            data: { phase: "COMPLETED" },
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
    marginTop: 12,
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

  const cardOrdered: CSSProperties = { ...cardBase, borderLeft: "6px solid #f59e0b", background: "#fffbeb" };
  const cardArrived: CSSProperties = { ...cardBase, borderLeft: "6px solid #3b82f6", background: "#eff6ff" };
  const cardCompleted: CSSProperties = { ...cardBase, borderLeft: "6px solid #10b981", background: "#ecfdf5" };

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

  function Card({ c, variant }: { c: LiveOrderCard; variant: LiveOrderCard["phase"] }) {
    const style = variant === "ORDERED" ? cardOrdered : variant === "ARRIVED" ? cardArrived : cardCompleted;

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
        <div style={{ fontSize: 12, color: "#6b7280" }}>Window: last {daysBack} days • Actions revalidate</div>
      </div>

      <AutoRefreshClient defaultEnabled={true} defaultIntervalSec={30} />

      <div style={colsWrap}>
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