// app/maintenance/checkout/page.tsx
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { Permission } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { parseHiddenFromDropdowns } from "@/app/lib/user-preferences";

// ✅ Reuse the same searchable picker used on inventory-orders
import ItemPicker from "@/app/admin/inventory-orders/ItemPicker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SearchParams = {
  ok?: string;
  okReturn?: string;
  err?: string;
  itemId?: string;
  storeId?: string;
  quantity?: string;
  createdByUserId?: string;
  needToOrderMore?: string;
  note?: string;
};

type UserOption = {
  id: string;
  name: string;
  role: Permission | string;
  active: boolean;
  locationId: string | null;
  allowedLocations: Array<{ locationId: string }>;
  uiPreferences: unknown;
};

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

function isRedirectLikeError(err: unknown): boolean {
  if (!isRecord(err)) return false;
  const digest = err.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function toSafeActionErrorMessage(err: unknown, fallback: string): string {
  const raw =
    typeof err === "object" && err !== null && "message" in err && typeof (err as { message: unknown }).message === "string"
      ? (err as { message: string }).message
      : fallback;
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || fallback;
}

async function loadCheckoutUsers(): Promise<UserOption[]> {
  try {
    const rows = await prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
        active: true,
        locationId: true,
        allowedLocations: { select: { locationId: true } },
        uiPreferences: true,
      },
    });
    return rows.filter((u) => !parseHiddenFromDropdowns(u.uiPreferences).includes("checkout"));
  } catch {
    const rows = await prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
        active: true,
        locationId: true,
        uiPreferences: true,
      },
    });
    return rows
      .map((u) => ({ ...u, allowedLocations: [] as Array<{ locationId: string }> }))
      .filter((u) => !parseHiddenFromDropdowns(u.uiPreferences).includes("checkout"));
  }
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

export default async function MaintenanceCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  try {
    const { session, perms } = await requireCheckoutView();

  const sp = await searchParams;
  const ok = sp.ok === "1";
  const okReturn = sp.okReturn === "1";
  const err = typeof sp.err === "string" && sp.err.trim() ? sp.err.trim() : null;
  const sessionUserId = getSessionUserId(session);
  const checkoutDraft = {
    itemId: typeof sp.itemId === "string" ? sp.itemId.trim() : "",
    storeId: typeof sp.storeId === "string" ? sp.storeId.trim() : "",
    quantity: typeof sp.quantity === "string" && sp.quantity.trim() ? sp.quantity.trim() : "1",
    createdByUserId: typeof sp.createdByUserId === "string" && sp.createdByUserId.trim() ? sp.createdByUserId.trim() : (sessionUserId ?? ""),
    needToOrderMore: sp.needToOrderMore === "1",
    note: typeof sp.note === "string" ? sp.note : "",
  };

  // Resolve allowed store locations for non-admin users.
  // Admin (allowAll) can see all active locations.
  let orderedAllowedLocations: Array<{ id: string; name: string }> | null = null;

  if (!perms.allowAll) {
    const email =
      typeof (session.user as unknown as { email?: unknown })?.email === "string"
        ? ((session.user as unknown as { email?: string }).email ?? "").toLowerCase().trim()
        : "";

    if (!email) redirect("/login");

    let me:
      | {
          id: string;
          active: boolean;
          location: { id: string; name: string; active: boolean; receiptEnabled: boolean } | null;
          allowedLocations: Array<{
            isPrimary?: boolean;
            location: { id: string; name: string; active: boolean; receiptEnabled: boolean } | null;
          }>;
        }
      | null = null;

    try {
      me = await prisma.user.findUnique({
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
    } catch {
      me = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          active: true,
          location: { select: { id: true, name: true, active: true, receiptEnabled: true } },
          allowedLocations: {
            select: { location: { select: { id: true, name: true, active: true, receiptEnabled: true } } },
          },
        },
      });
    }

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
      if (ul.isPrimary === true) primary.push({ id: ul.location.id, name: ul.location.name });
      else optional.push({ id: ul.location.id, name: ul.location.name });
    }

    orderedAllowedLocations = [...primary, ...optional];
  }

  let loadErr: string | null = null;
  let items: Array<{
    id: string;
    sku: string;
    partNumber: string | null;
    name: string;
    onHandQty: number;
    orderedQty: number;
    minQty: number;
    category: string | null;
    manufacturer: string | null;
    orderFrom: string | null;
  }> = [];
  let locationsAllActive: Array<{ id: string; name: string }> = [];
  let users: UserOption[] = [];
  let recentTickets: Array<{
    id: string;
    status: string;
    itemId: string;
    storeId: string;
    storeName: string;
    quantity: number;
    createdAt: Date;
    skuSnapshot: string;
    nameSnapshot: string;
  }> = [];

  try {
    [items, locationsAllActive, users, recentTickets] = await Promise.all([
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
      loadCheckoutUsers(),
      prisma.partsCheckoutTicket.findMany({
        where: { status: { in: ["OPEN", "INVOICED"] } },
        orderBy: { createdAt: "desc" },
        take: 120,
        select: {
          id: true,
          status: true,
          itemId: true,
          storeId: true,
          storeName: true,
          quantity: true,
          createdAt: true,
          skuSnapshot: true,
          nameSnapshot: true,
        },
      }),
    ]);
  } catch (e: unknown) {
    loadErr = toSafeActionErrorMessage(e, "Checkout data failed to load");
    console.error("[maintenance/checkout] data load failed", e);
  }

  const locations = orderedAllowedLocations ?? locationsAllActive;
  const allowedStoreIds = new Set(locations.map((l) => l.id));
  const recentReturnableTickets = perms.allowAll
    ? recentTickets
    : recentTickets.filter((t: { storeId: string }) => allowedStoreIds.has(t.storeId));

  const fieldStyle: CSSProperties = {
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",

    minHeight: 58,
    padding: "14px 16px",
    borderRadius: 14,
    border: "1px solid rgba(128,128,128,0.45)",
    background: "color-mix(in srgb, var(--background) 90%, white 10%)",
    color: "var(--foreground)",
    outline: "none",
    fontSize: 18,
    fontWeight: 600,
    lineHeight: 1.35,
  };

  const pickerInputStyle: CSSProperties = {
    minHeight: 58,
    padding: "14px 16px",
    borderRadius: 14,
    border: "1px solid rgba(128,128,128,0.45)",
    background: "color-mix(in srgb, var(--background) 90%, white 10%)",
    color: "var(--foreground)",
    fontSize: 18,
    fontWeight: 600,
    lineHeight: 1.35,
  };

  const labelStyle: CSSProperties = { display: "grid", gap: 8, minWidth: 0 };

  const helperTextStyle: CSSProperties = {
    fontSize: 14,
    lineHeight: 1.5,
    opacity: 0.88,
  };

  const sectionCardStyle: CSSProperties = {
    border: "1px solid rgba(128,128,128,0.28)",
    borderRadius: 18,
    padding: 24,
    display: "grid",
    gap: 18,
    background: "color-mix(in srgb, var(--background) 94%, white 6%)",
    color: "var(--foreground)",
    boxShadow: "0 10px 24px rgba(0,0,0,0.12)",
  };

  const primaryButtonStyle: CSSProperties = {
    padding: "14px 18px",
    minHeight: 58,
    fontWeight: 800,
    fontSize: 18,
    width: 260,
    borderRadius: 14,
    color: "var(--foreground)",
    cursor: "pointer",
  };

  const secondaryButtonStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 58,
    width: 180,
    padding: "14px 18px",
    borderRadius: 14,
    border: "1px solid rgba(128,128,128,0.4)",
    background: "color-mix(in srgb, var(--background) 92%, white 8%)",
    color: "var(--foreground)",
    textDecoration: "none",
    fontWeight: 800,
    fontSize: 17,
  };

  const twoCol: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 16,
    alignItems: "start",
  };

    return (
    <div style={{ padding: 28, maxWidth: 1080, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <Link
          href="/maintenance/checkout/history"
          style={{
            minHeight: 52,
            padding: "12px 16px",
            borderRadius: 14,
            border: "1px solid rgba(128,128,128,0.4)",
            background: "color-mix(in srgb, var(--background) 92%, white 8%)",
            color: "var(--foreground)",
            textDecoration: "none",
            fontWeight: 800,
            fontSize: 17,
            lineHeight: 1,
          }}
        >
          Checkout History
        </Link>
        <h1 style={{ fontSize: 34, fontWeight: 900, margin: 0, lineHeight: 1.1 }}>Maintenance Checkout</h1>
      </div>
      <div style={{ ...helperTextStyle, fontSize: 18, marginBottom: 14 }}>
        Creates a ticket and inventory alerts (never blocks; on-hand may go negative).
      </div>

      <div
        style={{
          marginBottom: 18,
          padding: 18,
          borderRadius: 18,
          border: "1px solid rgba(33, 150, 243, 0.35)",
          background: "rgba(33, 150, 243, 0.08)",
          color: "var(--foreground)",
          display: "grid",
          gap: 6,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 900 }}>Scanner ready</div>
        <div style={helperTextStyle}>If the cursor is not inside another box, the Bluetooth scanner will send the scan to Part (Item) automatically.</div>
        <div style={helperTextStyle}>Large fields and buttons are enabled on this page to make scanning and checkout easier to see.</div>
      </div>

      {ok ? (
        <div
          id="checkout-success-message"
          style={{
            marginBottom: 12,
            padding: 14,
            borderRadius: 14,
            border: "1px solid rgba(128,128,128,0.25)",
            background: "var(--background)",
            color: "var(--foreground)",
            fontSize: 18,
            fontWeight: 700,
          }}
        >
          ✅ Checkout submitted. Inventory was updated and an open maintenance ticket was created.
        </div>
      ) : null}

      {okReturn ? (
        <div
          id="checkout-return-success-message"
          style={{
            marginBottom: 12,
            padding: 14,
            borderRadius: 14,
            border: "1px solid rgba(40,167,69,0.45)",
            background: "rgba(40,167,69,0.08)",
            color: "var(--foreground)",
            fontSize: 18,
            fontWeight: 700,
          }}
        >
          ✅ Return submitted. Inventory was restored.
        </div>
      ) : null}

      {err ? (
        <div
          style={{
            marginBottom: 12,
            padding: 14,
            borderRadius: 14,
            border: "1px solid rgba(220,53,69,0.45)",
            background: "rgba(220,53,69,0.08)",
            color: "var(--foreground)",
            fontSize: 18,
            fontWeight: 700,
          }}
        >
          <div>Checkout failed: {err}</div>
          <div style={{ marginTop: 6, fontSize: 15, fontWeight: 600, lineHeight: 1.35 }}>
            Review the checkout below, make any edits, and submit again. Use Clear Form to start over.
          </div>
        </div>
      ) : null}

      {ok || okReturn ? (
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
  window.setTimeout(() => {
    document.getElementById("checkout-success-message")?.remove();
    document.getElementById("checkout-return-success-message")?.remove();
  }, 5000);
})();`,
          }}
        />
      ) : null}

      {loadErr ? (
        <div
          style={{
            marginBottom: 12,
            padding: 14,
            borderRadius: 14,
            border: "1px solid rgba(220,53,69,0.45)",
            background: "rgba(220,53,69,0.08)",
            color: "var(--foreground)",
            fontSize: 18,
            fontWeight: 700,
          }}
        >
          Checkout page warning: {loadErr}
        </div>
      ) : null}

      {!perms.allowAll && locations.length === 0 ? (
        <div
          style={{
            marginBottom: 12,
            padding: 14,
            borderRadius: 14,
            border: "1px solid rgba(128,128,128,0.25)",
            background: "var(--background)",
            color: "var(--foreground)",
            fontSize: 18,
            lineHeight: 1.45,
          }}
        >
          ⚠️ No stores are assigned to your account yet. Ask an admin to assign your primary/optional locations.
        </div>
      ) : null}

      <form
        method="post"
        action="/api/maintenance/checkout"
        style={sectionCardStyle}
      >
        <label style={labelStyle}>
          <span style={{ fontWeight: 800, fontSize: 22 }}>Part (Item)</span>

          {/* ✅ Searchable picker (SKU, part#, name, etc.) */}
          <div style={{ marginTop: 2 }}>
            <ItemPicker
              name="itemId"
              items={items}
              defaultId={checkoutDraft.itemId}
              placeholder="Search ID, SKU, part #, name, category, manufacturer…"
              enableGlobalScannerCapture
              inputStyle={pickerInputStyle}
            />
          </div>

          <div style={helperTextStyle}>
            Tip: search by <b>ID</b>, <b>SKU</b>, <b>Part #</b>, <b>Name</b>, <b>Category</b>, or <b>Manufacturer</b>.
          </div>
        </label>

        <div style={twoCol}>
          <label style={labelStyle}>
            <span style={{ fontWeight: 800, fontSize: 22 }}>Store (Location)</span>
            <select name="storeId" required defaultValue={checkoutDraft.storeId} style={fieldStyle} disabled={!perms.allowAll && locations.length === 0}>
              <option value="">Select a store…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            <span style={{ fontWeight: 800, fontSize: 22 }}>Quantity taken</span>
            <input name="quantity" type="number" min={1} step={1} required defaultValue={checkoutDraft.quantity} style={fieldStyle} />
          </label>
        </div>

        <label style={labelStyle}>
          <span style={{ fontWeight: 800, fontSize: 22 }}>Created by</span>
          <select id="checkout-created-by" name="createdByUserId" required defaultValue={checkoutDraft.createdByUserId} style={fieldStyle}>
            <option value="">Select user…</option>
            {users.map((u) => (
              <option
                key={u.id}
                value={u.id}
                data-store-ids={Array.from(new Set([u.locationId, ...u.allowedLocations.map((x) => x.locationId)].filter(Boolean))).join(",")}
              >
                {u.name} ({u.role})
              </option>
            ))}
          </select>
          <div style={helperTextStyle}>
            Shows only users assigned to the selected store. Manage assignments in Admin Users.
          </div>
        </label>

        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
  const storeSelect = document.querySelector('select[name="storeId"]');
  const userSelect = document.getElementById("checkout-created-by");
  if (!storeSelect || !userSelect) return;

  const syncUsers = () => {
    const storeId = String(storeSelect.value || "").trim();
    const options = Array.from(userSelect.options);

    let visibleCount = 0;
    for (const opt of options) {
      if (!opt.value) {
        opt.hidden = false;
        continue;
      }

      const raw = String(opt.dataset.storeIds || "");
      const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
      const allowed = storeId ? ids.includes(storeId) : true;
      opt.hidden = !allowed;
      if (allowed) visibleCount++;
    }

    const selected = userSelect.options[userSelect.selectedIndex];
    const selectedHidden = !!selected && selected.hidden;
    if (selectedHidden) {
      userSelect.value = "";
      if (storeId && visibleCount > 0) {
        const firstVisible = options.find((o) => !!o.value && !o.hidden);
        if (firstVisible) userSelect.value = firstVisible.value;
      }
    }
  };

  syncUsers();
  storeSelect.addEventListener("change", syncUsers);
})();`,
          }}
        />

        <label style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 20, fontWeight: 700, lineHeight: 1.4 }}>
          <input type="checkbox" name="needToOrderMore" defaultChecked={checkoutDraft.needToOrderMore} style={{ width: 22, height: 22 }} />
          <span>Need to order more</span>
        </label>

        <label style={labelStyle}>
          <span style={{ fontWeight: 800, fontSize: 22 }}>Note (optional)</span>
          <input name="note" placeholder="Optional note…" defaultValue={checkoutDraft.note} style={fieldStyle} />
        </label>

        <button
          type="submit"
          style={{
            ...primaryButtonStyle,
            background: "var(--checkout-submit-bg, rgba(33, 150, 243, 0.18))",
            border: "1px solid var(--checkout-submit-border, rgba(33, 150, 243, 0.55))",
          }}
          disabled={!perms.allowAll && locations.length === 0}
        >
          Submit Checkout
        </button>

        <Link
          href="/maintenance/checkout"
          style={secondaryButtonStyle}
        >
          Clear Form
        </Link>

        <div style={helperTextStyle}>
          Alerts created when: onHand goes negative, available falls below min, or “Need to order more” is checked.
        </div>
      </form>

      <details style={{ marginTop: 14 }}>
        <summary
          style={{
            cursor: "pointer",
            userSelect: "none",
            fontWeight: 900,
            fontSize: 24,
            border: "1px solid rgba(128,128,128,0.3)",
            borderRadius: 16,
            padding: "16px 18px",
            background: "color-mix(in srgb, var(--background) 94%, white 6%)",
            color: "var(--foreground)",
          }}
        >
          Reverse Checkout (Return to Inventory)
        </summary>

        <form
          method="post"
          action="/api/maintenance/checkout/return"
          style={{ ...sectionCardStyle, marginTop: 12 }}
        >
          <div style={helperTextStyle}>
            Use this when parts are returned. This will increase on-hand and reduce used quantity.
          </div>

        <label style={labelStyle}>
          <span style={{ fontWeight: 800, fontSize: 22 }}>Part (Item)</span>
          <div style={{ marginTop: 2 }}>
            <ItemPicker name="returnItemId" items={items} placeholder="Search ID, SKU, part #, name, category, manufacturer…" inputStyle={pickerInputStyle} />
          </div>
        </label>

        <div style={twoCol}>
          <label style={labelStyle}>
            <span style={{ fontWeight: 800, fontSize: 22 }}>Store (Location)</span>
            <select name="returnStoreId" required style={fieldStyle} disabled={!perms.allowAll && locations.length === 0}>
              <option value="">Select a store…</option>
              {locations.map((l) => (
                <option key={`return-store-${l.id}`} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            <span style={{ fontWeight: 800, fontSize: 22 }}>Quantity returned</span>
            <input name="returnQuantity" type="number" min={1} step={1} required defaultValue={1} style={fieldStyle} />
          </label>
        </div>

        <label style={labelStyle}>
          <span style={{ fontWeight: 800, fontSize: 22 }}>Returned by</span>
          <select id="checkout-return-created-by" name="returnCreatedByUserId" required defaultValue={sessionUserId ?? ""} style={fieldStyle}>
            <option value="">Select user…</option>
            {users.map((u) => (
              <option
                key={`return-user-${u.id}`}
                value={u.id}
                data-store-ids={Array.from(new Set([u.locationId, ...u.allowedLocations.map((x) => x.locationId)].filter(Boolean))).join(",")}
              >
                {u.name} ({u.role})
              </option>
            ))}
          </select>
          <div style={helperTextStyle}>
            Shows only users assigned to the selected store. Manage assignments in Admin Users.
          </div>
        </label>

        <label style={labelStyle}>
          <span style={{ fontWeight: 800, fontSize: 22 }}>Original checkout ticket (optional)</span>
          <select id="checkout-return-original-ticket" name="returnOriginalCheckoutIdSelect" defaultValue="" style={fieldStyle}>
            <option value="">Select recent ticket…</option>
            {recentReturnableTickets.map((t: { id: string; itemId: string; storeId: string; skuSnapshot: string; nameSnapshot: string; storeName: string; quantity: number; status: string }) => (
              <option key={`return-ticket-${t.id}`} value={t.id} data-item-id={t.itemId} data-store-id={t.storeId}>
                {t.id.slice(0, 10)}… | {t.skuSnapshot} | {t.nameSnapshot} | {t.storeName} | Qty {t.quantity} | {t.status}
              </option>
            ))}
          </select>
          <div style={helperTextStyle}>
            Recent open/invoiced tickets for your allowed stores. This list auto-filters by selected item and store.
          </div>
        </label>

        <label style={labelStyle}>
          <span style={{ fontWeight: 800, fontSize: 22 }}>Original checkout ticket ID (optional)</span>
          <input name="returnOriginalCheckoutId" placeholder="Paste checkout ticket ID to link this return…" style={fieldStyle} />
          <div style={helperTextStyle}>
            You can use this instead of the dropdown above. If both are filled, they must match.
          </div>
        </label>

        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
  const storeSelect = document.querySelector('select[name="returnStoreId"]');
  const itemIdInput = document.querySelector('input[name="returnItemId"]');
  const userSelect = document.getElementById("checkout-return-created-by");
  const ticketSelect = document.getElementById("checkout-return-original-ticket");
  if (!storeSelect || !userSelect) return;

  const syncUsers = () => {
    const storeId = String(storeSelect.value || "").trim();
    const options = Array.from(userSelect.options);

    let visibleCount = 0;
    for (const opt of options) {
      if (!opt.value) {
        opt.hidden = false;
        continue;
      }

      const raw = String(opt.dataset.storeIds || "");
      const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
      const allowed = storeId ? ids.includes(storeId) : true;
      opt.hidden = !allowed;
      if (allowed) visibleCount++;
    }

    const selected = userSelect.options[userSelect.selectedIndex];
    const selectedHidden = !!selected && selected.hidden;
    if (selectedHidden) {
      userSelect.value = "";
      if (storeId && visibleCount > 0) {
        const firstVisible = options.find((o) => !!o.value && !o.hidden);
        if (firstVisible) userSelect.value = firstVisible.value;
      }
    }
  };

  const syncTickets = () => {
    if (!ticketSelect) return;

    const storeId = String(storeSelect.value || "").trim();
    const itemId = String(itemIdInput && "value" in itemIdInput ? itemIdInput.value : "").trim();
    const options = Array.from(ticketSelect.options);

    let visibleCount = 0;
    for (const opt of options) {
      if (!opt.value) {
        opt.hidden = false;
        continue;
      }

      const optStoreId = String(opt.dataset.storeId || "").trim();
      const optItemId = String(opt.dataset.itemId || "").trim();
      const storeAllowed = storeId ? optStoreId === storeId : true;
      const itemAllowed = itemId ? optItemId === itemId : true;
      const allowed = storeAllowed && itemAllowed;
      opt.hidden = !allowed;
      if (allowed) visibleCount++;
    }

    const selected = ticketSelect.options[ticketSelect.selectedIndex];
    const selectedHidden = !!selected && selected.hidden;
    if (selectedHidden) {
      ticketSelect.value = "";
      if (visibleCount > 0) {
        const firstVisible = options.find((o) => !!o.value && !o.hidden);
        if (firstVisible) ticketSelect.value = firstVisible.value;
      }
    }
  };

  const syncAll = () => {
    syncUsers();
    syncTickets();
  };

  syncAll();
  storeSelect.addEventListener("change", syncAll);

  if (itemIdInput) {
    itemIdInput.addEventListener("change", syncTickets);
    itemIdInput.addEventListener("input", syncTickets);
  }

  // ItemPicker writes to a hidden input; this keeps ticket filtering responsive after click selections.
  window.setInterval(syncTickets, 400);
})();`,
          }}
        />

        <label style={labelStyle}>
          <span style={{ fontWeight: 800, fontSize: 22 }}>Return note (optional)</span>
          <input name="returnNote" placeholder="Optional reason for return…" style={fieldStyle} />
        </label>

          <button
            type="submit"
            style={{
              ...primaryButtonStyle,
              width: 320,
              background: "rgba(40, 167, 69, 0.16)",
              border: "1px solid rgba(40, 167, 69, 0.55)",
            }}
            disabled={!perms.allowAll && locations.length === 0}
          >
            Submit Return (Reverse Checkout)
          </button>

          <Link
            href="/maintenance/checkout"
            style={secondaryButtonStyle}
          >
            Clear Form
          </Link>
        </form>
      </details>
    </div>
    );
  } catch (e: unknown) {
    if (isRedirectLikeError(e)) throw e;
    console.error("[maintenance/checkout] unhandled render error", e);

    return (
      <div style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
        <h1 style={{ fontSize: 30, fontWeight: 900, marginBottom: 12 }}>Maintenance Checkout</h1>
        <div
          style={{
            marginBottom: 12,
            padding: 14,
            borderRadius: 14,
            border: "1px solid rgba(220,53,69,0.45)",
            background: "rgba(220,53,69,0.08)",
            color: "var(--foreground)",
            fontSize: 18,
            lineHeight: 1.45,
          }}
        >
          Checkout page failed to load safely. Please refresh, and if this continues contact admin support.
        </div>
      </div>
    );
  }
}
