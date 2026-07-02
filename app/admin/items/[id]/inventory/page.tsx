// app/admin/items/[id]/inventory/page.tsx
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { canAccessAdmin } from "@/app/lib/admin-access";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import PrintHotkeys from "@/app/admin/items/PrintHotkeys";
import {
  getInventoryDemandRecommendations,
  recalculateItemMinQuantitiesFromFullHistory,
} from "@/app/lib/inventory-demand";
export const dynamic = "force-dynamic";

type SearchParams = {
  ok?: string;
  error?: string;
};

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!(await canAccessAdmin(session))) redirect("/");
  return session;
}

function toInt(v: FormDataEntryValue | null): number | null {
  if (v === null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function normStr(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function enc(v: string) {
  return encodeURIComponent(v);
}

function isNextRedirectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function parseIso(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return s;
}

export default async function ItemInventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;

  const item = await prisma.item.findUnique({
    where: { id },
    select: {
      id: true,
      sku: true,
      partNumber: true,
      name: true,
      onHandQty: true,
      orderedQty: true,
      usedQty: true,
      minQty: true,
      updatedAt: true,
    },
  });

  const recommendation = (await getInventoryDemandRecommendations({ itemIds: [id], includeInactive: true }))[0] ?? null;

  if (!item) {
    return (
      <main style={{ padding: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800 }}>Item Inventory</h1>
        <p style={{ marginTop: 12 }}>Item not found.</p>
      </main>
    );
  }

  async function updateInventoryAction(formData: FormData) {
    "use server";

    try {
      const session = await getServerSession(authOptions);
      if (!session) throw new Error("Unauthorized");
      if (!(await canAccessAdmin(session))) throw new Error("Forbidden");

      const itemId = String(formData.get("itemId") ?? "").trim();
      if (!itemId) throw new Error("Missing itemId");

      // ✅ Guard against form tampering: route param id must match hidden input
      if (itemId !== id) throw new Error("Invalid itemId");

      // ✅ Optional optimistic concurrency: compare updatedAt if present
      const ifUpdatedAt = parseIso(formData.get("ifUpdatedAt"));

      const onHandQty = toInt(formData.get("onHandQty"));
      const orderedQty = toInt(formData.get("orderedQty"));
      const minQty = toInt(formData.get("minQty"));
      const note = normStr(formData.get("note"));

      // We allow negative onHandQty per your rules.
      if (onHandQty === null) throw new Error("onHandQty is required");
      if (orderedQty === null || orderedQty < 0) throw new Error("orderedQty must be >= 0");
      if (minQty === null || minQty < 0) throw new Error("minQty must be >= 0");

      const userId = (session.user as unknown as { id?: string }).id;
      const userName = (session.user as unknown as { name?: string }).name ?? "Admin";

      await prisma.$transaction(async (tx) => {
        // ✅ Concurrency safety: serialize inventory edits + version increments per item
        await tx.$queryRaw`SELECT id FROM "Item" WHERE id = ${itemId} FOR UPDATE`;

        const current = await tx.item.findUnique({
          where: { id: itemId },
          select: {
            id: true,
            sku: true,
            partNumber: true,
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

            updatedAt: true,
          },
        });

        if (!current) throw new Error("Item not found");

        // ✅ Optional optimistic concurrency check after lock + read
        if (ifUpdatedAt) {
          const curIso = current.updatedAt.toISOString();
          if (curIso !== ifUpdatedAt) {
            throw new Error("Update conflict. This item was modified by someone else.");
          }
        }

        const latest = await tx.itemVersion.findFirst({
          where: { itemId: current.id },
          orderBy: [{ version: "desc" }],
          select: { version: true },
        });
        const nextVersion = (latest?.version ?? 0) + 1;

        // ✅ Snapshot pre-change state (parity with PATCH + rollback)
        await tx.itemVersion.create({
          data: {
            itemId: current.id,
            sku: current.sku,
            partNumber: current.partNumber,
            name: current.name,
            description: current.description,
            category: current.category,
            // ✅ unit removed
            manufacturer: current.manufacturer,
            orderFrom: current.orderFrom,
            webUrl: current.webUrl,
            cost: current.cost,
            price: current.price,
            taxable: current.taxable,
            active: current.active,

            onHandQty: current.onHandQty,
            orderedQty: current.orderedQty,
            usedQty: current.usedQty,
            minQty: current.minQty,

            version: nextVersion,
          },
        });

        await tx.item.update({
          where: { id: current.id },
          data: {
            onHandQty,
            orderedQty,
            minQty,
          },
        });

        const qtyDelta = onHandQty - current.onHandQty;
        const availableAfter = onHandQty + orderedQty;

        // ✅ Choose alert type deterministically (no behavior change to inventory, just correct categorization)
        const alertType =
          onHandQty < 0 ? "NEGATIVE_ON_HAND" : onHandQty < minQty ? "BELOW_MIN" : "TECH_REQUEST_ORDER";

        await tx.inventoryAlert.create({
          data: {
            type: alertType,
            itemId: current.id,
            storeId: null,
            storeName: "ADMIN",
            checkoutId: null,
            createdByUserId: userId ?? null,
            createdByName: userName,
            qtyDelta,
            onHandAfter: onHandQty,
            orderedAfter: orderedQty,
            availableAfter,
            minQtyAtTime: minQty,
            note: `Manual inventory adjustment.${note ? ` Note: ${note}` : ""}`.trim(),
          },
        });
      });

      revalidatePath(`/admin/items/${itemId}/inventory`);
      revalidatePath(`/admin/items`);
      revalidatePath(`/admin/inventory-alerts`);

      redirect(`/admin/items/${itemId}/inventory?ok=${enc("Inventory updated.")}`);
    } catch (e: unknown) {
      if (isNextRedirectError(e)) throw e;
      const msg =
        e instanceof Prisma.PrismaClientKnownRequestError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Update failed";

      const itemId = String(formData.get("itemId") ?? "").trim();
      if (itemId) {
        redirect(`/admin/items/${itemId}/inventory?error=${enc(msg)}`);
      }
      redirect(`/admin/items?error=${enc(msg)}`);
    }
  }

  async function applySuggestedMinToItemAction() {
    "use server";

    try {
      const session = await getServerSession(authOptions);
      if (!session) throw new Error("Unauthorized");
      if (!(await canAccessAdmin(session))) throw new Error("Forbidden");

      const result = await recalculateItemMinQuantitiesFromFullHistory({ itemIds: [id], includeInactive: true });

      revalidatePath(`/admin/items/${id}/inventory`);
      revalidatePath(`/admin/items`);

      const message =
        result.updatedCount > 0
          ? `Full-history suggested minimum copied to min qty for ${result.updatedCount} item.`
          : "This item already matches the full-history suggested minimum.";

      redirect(`/admin/items/${id}/inventory?ok=${enc(message)}`);
    } catch (e: unknown) {
      if (isNextRedirectError(e)) throw e;
      const message = e instanceof Error ? e.message : "Failed to apply suggested minimum.";
      redirect(`/admin/items/${id}/inventory?error=${enc(message)}`);
    }
  }

  async function applySuggestedMinToAllItemsAction() {
    "use server";

    try {
      const session = await getServerSession(authOptions);
      if (!session) throw new Error("Unauthorized");
      if (!(await canAccessAdmin(session))) throw new Error("Forbidden");

      const result = await recalculateItemMinQuantitiesFromFullHistory({ includeInactive: true });

      revalidatePath(`/admin/items/${id}/inventory`);
      revalidatePath(`/admin/items`);

      const message =
        result.updatedCount > 0
          ? `Full-history suggested minimum copied to min qty for ${result.updatedCount} item${result.updatedCount === 1 ? "" : "s"}.`
          : "All items already match the full-history suggested minimum.";

      redirect(`/admin/items/${id}/inventory?ok=${enc(message)}`);
    } catch (e: unknown) {
      if (isNextRedirectError(e)) throw e;
      const message = e instanceof Error ? e.message : "Failed to apply suggested minimums.";
      redirect(`/admin/items/${id}/inventory?error=${enc(message)}`);
    }
  }

  const updatedAt = new Date(item.updatedAt).toLocaleString();

  return (
    <main style={{ padding: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <Link
            href={`/admin/items?id=${encodeURIComponent(item.id)}`}
            style={{
              display: "inline-block",
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid var(--border, rgba(0,0,0,0.2))",
              textDecoration: "none",
              color: "inherit",
              fontWeight: 800,
            }}
          >
            Back to Item
          </Link>

          <form action={applySuggestedMinToAllItemsAction}>
            <button
              type="submit"
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid rgba(76, 175, 80, 0.45)",
                background: "rgba(76, 175, 80, 0.16)",
                color: "inherit",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Copy Full-History Suggested Min Qty to All Items
            </button>
          </form>
        </div>
      </div>
      <h1 style={{ fontSize: 20, fontWeight: 900 }}>Item Inventory</h1>
      <div style={{ marginTop: 6, opacity: 0.8 }}>
        <b>{item.sku}</b> — {item.name}
        {item.partNumber ? <span> (PN: {item.partNumber})</span> : null}
      </div>
      <div style={{ marginTop: 4, opacity: 0.7, fontSize: 13 }}>
        Item ID: <code>{item.id}</code> • Last updated: {updatedAt}
        <PrintHotkeys ids={[item.id]} />
      </div>

      {sp.ok ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 10,
            border: "1px solid var(--border, rgba(0,0,0,0.2))",
            background: "var(--card, transparent)",
          }}
        >
          <b>OK</b> {sp.ok}
        </div>
      ) : null}

      {sp.error ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 10,
            border: "1px solid var(--border, rgba(0,0,0,0.2))",
            background: "var(--card, transparent)",
          }}
        >
          <b>Error</b> {sp.error}
        </div>
      ) : null}

      <div
        style={{
          marginTop: 16,
          padding: 12,
          borderRadius: 12,
          border: "1px solid var(--border, rgba(0,0,0,0.2))",
          background: "var(--card, transparent)",
          maxWidth: 640,
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Current</div>
        <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 8 }}>
          <div style={{ opacity: 0.8 }}>On hand</div>
          <div>
            <b>{item.onHandQty}</b>
          </div>

          <div style={{ opacity: 0.8 }}>Ordered</div>
          <div>
            <b>{item.orderedQty}</b>
          </div>

          <div style={{ opacity: 0.8 }}>Used (cumulative)</div>
          <div>
            <b>{item.usedQty}</b>
          </div>

          <div style={{ opacity: 0.8 }}>Minimum</div>
          <div>
            <b>{item.minQty}</b>
          </div>

          <div style={{ opacity: 0.8 }}>Available (on hand + ordered)</div>
          <div>
            <b>{item.onHandQty + item.orderedQty}</b>
          </div>
        </div>
      </div>

      {recommendation ? (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 12,
            border: "1px solid var(--border, rgba(0,0,0,0.2))",
            background: "var(--card, transparent)",
            maxWidth: 760,
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Usage Analytics</div>
          <div style={{ fontSize: 13, opacity: 0.82, marginBottom: 10 }}>
            Suggested minimum quantity is the recommended stock for the next 30 days based on full net usage history for this item.
          </div>
          <div style={{ marginBottom: 12 }}>
            <form action={applySuggestedMinToItemAction}>
              <button
                type="submit"
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(76, 175, 80, 0.45)",
                  background: "rgba(76, 175, 80, 0.16)",
                  color: "inherit",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Copy Full-History Suggested Min Qty to This Item
              </button>
            </form>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 8 }}>
            <div style={{ opacity: 0.8 }}>Suggested minimum quantity (history)</div>
            <div>
              <b>{recommendation.suggestedMinQty30Day}</b>
            </div>

            <div style={{ opacity: 0.8 }}>Suggested reorder quantity</div>
            <div>
              <b>{recommendation.suggestedReorderQty30Day}</b>
            </div>

            <div style={{ opacity: 0.8 }}>30 day usage</div>
            <div>
              <b>{recommendation.usage30Day}</b>
            </div>

            <div style={{ opacity: 0.8 }}>60 day usage</div>
            <div>
              <b>{recommendation.usage60Day}</b>
            </div>

            <div style={{ opacity: 0.8 }}>90 day usage</div>
            <div>
              <b>{recommendation.usage90Day}</b>
            </div>

            <div style={{ opacity: 0.8 }}>Average daily usage (30d)</div>
            <div>
              <b>{recommendation.avgDailyUsage30Day.toFixed(2)}</b>
            </div>

            <div style={{ opacity: 0.8 }}>30 day checkouts</div>
            <div>
              <b>{recommendation.checkoutQty30Day}</b>
            </div>

            <div style={{ opacity: 0.8 }}>30 day returns</div>
            <div>
              <b>{recommendation.returnQty30Day}</b>
            </div>

            <div style={{ opacity: 0.8 }}>Estimated lead time</div>
            <div>
              <b>{recommendation.estimatedLeadTimeDays === null ? "—" : `${recommendation.estimatedLeadTimeDays} days`}</b>
            </div>

            <div style={{ opacity: 0.8 }}>Days of cover at current stock</div>
            <div>
              <b>{recommendation.daysOfCover === null ? "—" : recommendation.daysOfCover}</b>
            </div>

            <div style={{ opacity: 0.8 }}>Last checkout</div>
            <div>
              <b>{recommendation.lastCheckoutAt ? new Date(recommendation.lastCheckoutAt).toLocaleString() : "—"}</b>
            </div>
          </div>
        </div>
      ) : null}

      <form action={updateInventoryAction} style={{ marginTop: 16, display: "grid", gap: 12, maxWidth: 640 }}>
        <input type="hidden" name="itemId" value={item.id} />
        {/* ✅ Optional optimistic concurrency token */}
        <input type="hidden" name="ifUpdatedAt" value={item.updatedAt.toISOString()} />

        <div style={{ fontWeight: 900 }}>Update quantities</div>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 800 }}>On hand quantity (can be negative)</span>
          <input
            name="onHandQty"
            type="number"
            step={1}
            defaultValue={item.onHandQty}
            required
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid var(--border, rgba(0,0,0,0.2))",
              background: "var(--input, transparent)",
              color: "inherit",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 800 }}>Ordered quantity (≥ 0)</span>
          <input
            name="orderedQty"
            type="number"
            min={0}
            step={1}
            defaultValue={item.orderedQty}
            required
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid var(--border, rgba(0,0,0,0.2))",
              background: "var(--input, transparent)",
              color: "inherit",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 800 }}>Minimum quantity (≥ 0)</span>
          <input
            name="minQty"
            type="number"
            min={0}
            step={1}
            defaultValue={item.minQty}
            required
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid var(--border, rgba(0,0,0,0.2))",
              background: "var(--input, transparent)",
              color: "inherit",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 800 }}>Note (optional)</span>
          <textarea
            name="note"
            rows={3}
            placeholder="Why are you adjusting these quantities?"
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid var(--border, rgba(0,0,0,0.2))",
              background: "var(--input, transparent)",
              color: "inherit",
            }}
          />
        </label>

        <button
          type="submit"
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid var(--border, rgba(0,0,0,0.2))",
            background: "var(--button, transparent)",
            color: "inherit",
            fontWeight: 900,
            cursor: "pointer",
            width: 220,
          }}
        >
          Save Quantities
        </button>
      </form>
    </main>
  );
}
