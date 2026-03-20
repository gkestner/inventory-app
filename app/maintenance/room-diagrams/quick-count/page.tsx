import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type SearchParams = Record<string, string | string[] | undefined>;

type ParsedSkuSlot = {
  location: string;
  shelf: string;
  bin: string;
};

type ItemRow = {
  id: string;
  sku: string;
  name: string;
  onHandQty: number;
  minQty: number;
  active: boolean;
};

type SlotRow = ItemRow & {
  slot: ParsedSkuSlot;
};

export const dynamic = "force-dynamic";

function firstParam(params: SearchParams, key: string): string | null {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function parseSkuSlot(sku: string): ParsedSkuSlot | null {
  const raw = String(sku ?? "").trim();
  if (!raw) return null;

  const segments = raw.split("-");
  if (segments.length < 1) return null;

  // New format: LLSSBB - KEY, so digits are in segments[0]
  const firstSegmentDigits = String(segments[0] ?? "").replace(/\D/g, "");
  if (firstSegmentDigits.length >= 6) {
    return {
      location: firstSegmentDigits.slice(0, 2),
      shelf: firstSegmentDigits.slice(2, 4),
      bin: firstSegmentDigits.slice(4, 6),
    };
  }

  // Fallback for legacy format: check middle segment for digits
  if (segments.length >= 2) {
    const middleDigits = String(segments[1] ?? "").replace(/\D/g, "");
    if (middleDigits.length >= 6) {
      return {
        location: middleDigits.slice(0, 2),
        shelf: middleDigits.slice(2, 4),
        bin: middleDigits.slice(4, 6),
      };
    }
  }

  return null;
}

function normalize2(value: string | null | undefined): string {
  const n = Number(String(value ?? "").replace(/\D/g, ""));
  if (!Number.isFinite(n)) return "";
  return String(Math.max(0, Math.trunc(n))).padStart(2, "0");
}

function prettyCode(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}

function locationLabel(code: string): string {
  return `Location #${prettyCode(code)}`;
}

export default async function QuickCountEditorPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  const canViewRoomDiagrams =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_ROOM_DIAGRAMS,
      Permission.EDIT_QUICK_COUNT,
      Permission.VIEW_PREVENTATIVE_MAINTENANCE,
      Permission.ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_EDIT_ITEMS,
    ]);

  if (!canViewRoomDiagrams) redirect("/");

  const canEditCounts =
    perms.allowAll || hasAnyPermission(perms, [Permission.EDIT_QUICK_COUNT, Permission.ADMIN_EDIT_ITEMS]);

  if (!canEditCounts) redirect("/maintenance/room-diagrams");

  const actorEmail = String(session.user?.email ?? "").trim().toLowerCase();

  async function quickCountUpdateAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    if (!session) redirect("/login");

    const perms = await loadUserPermissions(session);
    const canEdit =
      perms.allowAll || hasAnyPermission(perms, [Permission.EDIT_QUICK_COUNT, Permission.ADMIN_EDIT_ITEMS]);
    if (!canEdit) redirect("/");

    const actorEmail = String(session.user?.email ?? "").trim().toLowerCase();
    const actor = actorEmail
      ? await prisma.user.findUnique({ where: { email: actorEmail }, select: { id: true, active: true } })
      : null;
    if (!actor?.id || !actor.active) redirect("/login");

    const itemId = String(formData.get("itemId") ?? "").trim();
    const mode = String(formData.get("mode") ?? "").trim();
    const returnTo =
      String(formData.get("returnTo") ?? "").trim() ||
      "/maintenance/room-diagrams/quick-count";

    if (!itemId || !mode) redirect(returnTo);

    const existing = await prisma.item.findUnique({
      where: { id: itemId },
      select: { id: true, sku: true, name: true, onHandQty: true },
    });
    if (!existing) redirect(returnTo);

    let nextQty = existing.onHandQty;

    if (mode === "set") {
      const setTo = Number(String(formData.get("setQty") ?? "").trim());
      if (!Number.isFinite(setTo)) redirect(returnTo);
      nextQty = Math.max(0, Math.trunc(setTo));
    } else if (mode === "delta") {
      const delta = Number(String(formData.get("delta") ?? "").trim());
      if (!Number.isFinite(delta)) redirect(returnTo);
      nextQty = Math.max(0, existing.onHandQty + Math.trunc(delta));
    } else {
      redirect(returnTo);
    }

    await prisma.item.update({
      where: { id: existing.id },
      data: { onHandQty: nextQty },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        module: "INVENTORY_COUNT",
        action: "QUICK_COUNT_UPDATE",
        entityType: "Item",
        entityId: existing.id,
        message: `Quick count update for ${existing.name}: ${existing.onHandQty} -> ${nextQty}`,
        metadata: {
          sku: existing.sku,
          previousOnHandQty: existing.onHandQty,
          nextOnHandQty: nextQty,
          mode,
        },
      },
    });

    revalidatePath("/maintenance/room-diagrams");
    revalidatePath("/maintenance/room-diagrams/quick-count");
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}updated=1`);
  }

  const actor = actorEmail
    ? await prisma.user.findUnique({ where: { email: actorEmail }, select: { id: true, active: true } })
    : null;
  if (!actor?.id || !actor.active) redirect("/login");

  const items = await prisma.item.findMany({
    where: { active: true },
    orderBy: [{ sku: "asc" }, { name: "asc" }],
    select: {
      id: true,
      sku: true,
      name: true,
      onHandQty: true,
      minQty: true,
      active: true,
    },
  });

  const slotRows: SlotRow[] = items
    .map((item) => {
      const slot = parseSkuSlot(item.sku);
      if (!slot) return null;
      return { ...item, slot };
    })
    .filter((x): x is SlotRow => x !== null);

  const paramsRaw = (await searchParams) ?? {};
  const selectedLocation = normalize2(firstParam(paramsRaw, "loc") ?? "01") || "01";
  const selectedShelf = normalize2(firstParam(paramsRaw, "shelf") ?? "01") || "01";
  const selectedBin = normalize2(firstParam(paramsRaw, "bin") ?? "01") || "01";

  const selectedRows = slotRows
    .filter(
      (row) =>
        row.slot.location === selectedLocation &&
        row.slot.shelf === selectedShelf &&
        row.slot.bin === selectedBin
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const selectedPath = `/maintenance/room-diagrams/quick-count?loc=${selectedLocation}&shelf=${selectedShelf}&bin=${selectedBin}`;
  const updatedOk = firstParam(paramsRaw, "updated") === "1";

  const availableLocations = Array.from(
    new Set(slotRows.map((row) => row.slot.location))
  ).sort((a, b) => Number(a) - Number(b));

  const availableShelves = Array.from(
    new Set(slotRows.filter((row) => row.slot.location === selectedLocation).map((row) => row.slot.shelf))
  ).sort((a, b) => Number(a) - Number(b));

  const availableBins = Array.from(
    new Set(
      slotRows
        .filter((row) => row.slot.location === selectedLocation && row.slot.shelf === selectedShelf)
        .map((row) => row.slot.bin)
    )
  ).sort((a, b) => Number(a) - Number(b));

  return (
    <main>
      <div style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gap: 12 }}>
        <section
          style={{
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: 16,
            background:
              "linear-gradient(155deg, color-mix(in srgb, var(--brand) 10%, var(--surface)) 0%, var(--surface) 65%)",
            boxShadow: "var(--shadow)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Quick Count Editor</h1>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.5 }}>
            Dedicated page for fast count adjustments by maintenance location, shelf, and bin.
          </p>
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link
              href={`/maintenance/room-diagrams?loc=${selectedLocation}&shelf=${selectedShelf}&bin=${selectedBin}`}
              style={{
                textDecoration: "none",
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--foreground)",
                fontWeight: 800,
              }}
            >
              Back to Room Diagrams
            </Link>
          </div>
        </section>

        {updatedOk ? (
          <section
            style={{
              border: "1px solid rgba(34,197,94,0.45)",
              borderRadius: 12,
              padding: 10,
              background: "rgba(34,197,94,0.12)",
            }}
          >
            Inventory count updated.
          </section>
        ) : null}

        <section
          style={{
            border: "1px solid var(--border)",
            borderRadius: 14,
            background: "var(--surface)",
            boxShadow: "var(--shadow)",
            padding: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>
            {locationLabel(selectedLocation)} / Shelf {prettyCode(selectedShelf)} / Bin {prettyCode(selectedBin)}
          </h2>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {/* Location filter */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 5, color: "var(--muted)" }}>LOCATION</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {availableLocations.map((locCode) => (
                  <Link
                    key={locCode}
                    href={`/maintenance/room-diagrams/quick-count?loc=${locCode}&shelf=01&bin=01`}
                    style={{
                      textDecoration: "none",
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: locCode === selectedLocation ? "2px solid #1d4ed8" : "1px solid var(--border)",
                      background: locCode === selectedLocation ? "#2563eb" : "var(--surface-2)",
                      color: locCode === selectedLocation ? "#fff" : "var(--foreground)",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    Loc {prettyCode(locCode)}
                  </Link>
                ))}
              </div>
            </div>

            {/* Shelf filter */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 5, color: "var(--muted)" }}>SHELF</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {availableShelves.map((shelfCode) => (
                  <Link
                    key={shelfCode}
                    href={`/maintenance/room-diagrams/quick-count?loc=${selectedLocation}&shelf=${shelfCode}&bin=01`}
                    style={{
                      textDecoration: "none",
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: shelfCode === selectedShelf ? "2px solid #1d4ed8" : "1px solid var(--border)",
                      background: shelfCode === selectedShelf ? "#2563eb" : "var(--surface-2)",
                      color: shelfCode === selectedShelf ? "#fff" : "var(--foreground)",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    Shelf {prettyCode(shelfCode)}
                  </Link>
                ))}
              </div>
            </div>

            {/* Bin filter */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 5, color: "var(--muted)" }}>BIN</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {availableBins.length === 0 ? (
                  <span style={{ fontSize: 13, opacity: 0.7 }}>No bins on this shelf</span>
                ) : (
                  availableBins.map((binCode) => (
                    <Link
                      key={binCode}
                      href={`/maintenance/room-diagrams/quick-count?loc=${selectedLocation}&shelf=${selectedShelf}&bin=${binCode}`}
                      style={{
                        textDecoration: "none",
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: binCode === selectedBin ? "2px solid #1d4ed8" : "1px solid var(--border)",
                        background: binCode === selectedBin ? "#2563eb" : "var(--surface-2)",
                        color: binCode === selectedBin ? "#fff" : "var(--foreground)",
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      Bin {prettyCode(binCode)}
                    </Link>
                  ))
                )}
              </div>
            </div>
          </div>

          {selectedRows.length === 0 ? (
            <div style={{ marginTop: 10, opacity: 0.8 }}>No items assigned to this bin.</div>
          ) : (
            <div style={{ marginTop: 10, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["SKU", "Item", "On Hand", "Min", "Set Qty", "Quick +/-", "Print"].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: 8,
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedRows.map((row) => (
                    <tr key={row.id}>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: "1px solid var(--border)",
                          fontFamily: "monospace",
                          fontSize: 12,
                        }}
                      >
                        {row.sku}
                      </td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)", fontWeight: 700 }}>
                        {row.name}
                      </td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{row.onHandQty}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{row.minQty}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
                        {canEditCounts ? (
                          <form
                            action={quickCountUpdateAction}
                            style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
                          >
                            <input type="hidden" name="itemId" value={row.id} />
                            <input type="hidden" name="mode" value="set" />
                            <input type="hidden" name="returnTo" value={selectedPath} />
                            <input
                              name="setQty"
                              type="number"
                              defaultValue={row.onHandQty}
                              style={{
                                width: 84,
                                padding: "6px 8px",
                                borderRadius: 8,
                                border: "1px solid var(--border)",
                              }}
                            />
                            <button
                              type="submit"
                              style={{
                                padding: "6px 10px",
                                borderRadius: 8,
                                border: "1px solid var(--border)",
                                background: "var(--surface-2)",
                                fontWeight: 800,
                                cursor: "pointer",
                              }}
                            >
                              Set
                            </button>
                          </form>
                        ) : (
                          <span style={{ opacity: 0.7 }}>Read only</span>
                        )}
                      </td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
                        {canEditCounts ? (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {[-5, -1, 1, 5].map((delta) => (
                              <form key={delta} action={quickCountUpdateAction}>
                                <input type="hidden" name="itemId" value={row.id} />
                                <input type="hidden" name="mode" value="delta" />
                                <input type="hidden" name="delta" value={String(delta)} />
                                <input type="hidden" name="returnTo" value={selectedPath} />
                                <button
                                  type="submit"
                                  style={{
                                    padding: "6px 8px",
                                    borderRadius: 8,
                                    border: "1px solid var(--border)",
                                    background:
                                      delta < 0
                                        ? "rgba(239,68,68,0.12)"
                                        : "rgba(34,197,94,0.12)",
                                    fontWeight: 800,
                                    cursor: "pointer",
                                  }}
                                >
                                  {delta > 0 ? `+${delta}` : String(delta)}
                                </button>
                              </form>
                            ))}
                          </div>
                        ) : (
                          <span style={{ opacity: 0.7 }}>Read only</span>
                        )}
                      </td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
                        <Link
                          href={`/admin/items/labels?ids=${row.id}&autoprint=1`}
                          style={{
                            display: "inline-block",
                            textDecoration: "none",
                            padding: "6px 10px",
                            borderRadius: 8,
                            border: "1px solid var(--border)",
                            background: "var(--surface-2)",
                            color: "var(--foreground)",
                            fontWeight: 800,
                            cursor: "pointer",
                            fontSize: 13,
                          }}
                        >
                          Print
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </section>
      </div>
    </main>
  );
}
