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
  if (segments.length < 2) return null;

  const middleDigits = String(segments[1] ?? "").replace(/\D/g, "");
  if (middleDigits.length < 6) return null;

  return {
    location: middleDigits.slice(0, 2),
    shelf: middleDigits.slice(2, 4),
    bin: middleDigits.slice(4, 6),
  };
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

function summarizeBin(rows: SlotRow[]): { itemCount: number; qtyTotal: number; lowCount: number } {
  return rows.reduce(
    (acc, row) => {
      acc.itemCount += 1;
      acc.qtyTotal += row.onHandQty;
      if (row.onHandQty <= row.minQty) acc.lowCount += 1;
      return acc;
    },
    { itemCount: 0, qtyTotal: 0, lowCount: 0 }
  );
}

export default async function MaintenanceRoomDiagramsPage({
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
      Permission.VIEW_CHECKOUT,
      Permission.CREATE_CHECKOUT,
      Permission.VIEW_PREVENTATIVE_MAINTENANCE,
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_EDIT_ITEMS,
    ]);

  if (!canViewRoomDiagrams) redirect("/");

  const canEditCounts =
    perms.allowAll ||
    hasAnyPermission(perms, [Permission.CREATE_CHECKOUT, Permission.ADMIN_EDIT_ITEMS]);

  const actorEmail = String(session.user?.email ?? "").trim().toLowerCase();
  const actor = actorEmail
    ? await prisma.user.findUnique({ where: { email: actorEmail }, select: { id: true, active: true } })
    : null;

  async function quickCountUpdateAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    if (!session) redirect("/login");

    const perms = await loadUserPermissions(session);
    const canEdit =
      perms.allowAll || hasAnyPermission(perms, [Permission.CREATE_CHECKOUT, Permission.ADMIN_EDIT_ITEMS]);
    if (!canEdit) redirect("/");

    const actorEmail = String(session.user?.email ?? "").trim().toLowerCase();
    const actor = actorEmail
      ? await prisma.user.findUnique({ where: { email: actorEmail }, select: { id: true, active: true } })
      : null;
    if (!actor?.id || !actor.active) redirect("/login");

    const itemId = String(formData.get("itemId") ?? "").trim();
    const mode = String(formData.get("mode") ?? "").trim();
    const returnTo = String(formData.get("returnTo") ?? "").trim() || "/maintenance/room-diagrams";

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
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}updated=1`);
  }

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

  const allLocationCodes = Array.from(new Set(slotRows.map((r) => r.slot.location))).sort((a, b) => Number(a) - Number(b));

  const byLocationShelfBin = new Map<string, SlotRow[]>();
  for (const row of slotRows) {
    const key = `${row.slot.location}|${row.slot.shelf}|${row.slot.bin}`;
    const arr = byLocationShelfBin.get(key) ?? [];
    arr.push(row);
    byLocationShelfBin.set(key, arr);
  }

  const paramsRaw = (await searchParams) ?? {};
  const selectedLocation = normalize2(firstParam(paramsRaw, "loc") ?? "01") || "01";
  const selectedShelf = normalize2(firstParam(paramsRaw, "shelf") ?? "01") || "01";
  const selectedBin = normalize2(firstParam(paramsRaw, "bin") ?? "01") || "01";

  const selectedKey = `${selectedLocation}|${selectedShelf}|${selectedBin}`;
  const selectedRows = (byLocationShelfBin.get(selectedKey) ?? []).sort((a, b) => a.name.localeCompare(b.name));

  const selectedPath = `/maintenance/room-diagrams?loc=${selectedLocation}&shelf=${selectedShelf}&bin=${selectedBin}`;
  const updatedOk = firstParam(paramsRaw, "updated") === "1";

  function binsForLocation(locationCode: string): Array<{
    shelf: string;
    bin: string;
    summary: { itemCount: number; qtyTotal: number; lowCount: number };
  }> {
    const keys = Array.from(byLocationShelfBin.keys())
      .map((k) => {
        const [loc, shelf, bin] = k.split("|");
        return { loc, shelf, bin, key: k };
      })
      .filter((x) => x.loc === locationCode)
      .sort((a, b) => {
        if (a.shelf !== b.shelf) return Number(a.shelf) - Number(b.shelf);
        return Number(a.bin) - Number(b.bin);
      });

    return keys.map((x) => ({
      shelf: x.shelf,
      bin: x.bin,
      summary: summarizeBin(byLocationShelfBin.get(x.key) ?? []),
    }));
  }

  const location1Bins = binsForLocation("01");
  const location2Bins = binsForLocation("02");

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
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Maintenance Room Diagrams</h1>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.5 }}>
            Visual map + shelf/bin diagrams powered by item SKU assignments (Location/Shelf/Bin). Use Quick Count below to update quantities fast.
          </p>
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link
              href="/maintenance"
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
              Back to Maintenance Hub
            </Link>
          </div>
        </section>

        {updatedOk ? (
          <section style={{ border: "1px solid rgba(34,197,94,0.45)", borderRadius: 12, padding: 10, background: "rgba(34,197,94,0.12)" }}>
            Inventory count updated.
          </section>
        ) : null}

        <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", padding: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Room Location Map</h2>
          <div
            style={{
              marginTop: 10,
              border: "1px solid var(--border)",
              borderRadius: 12,
              background: "#ececec",
              minHeight: 220,
              padding: 12,
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 10,
            }}
          >
            {Array.from({ length: 10 }).map((_, idx) => {
              const code = String(idx + 1).padStart(2, "0");
              const count = slotRows.filter((r) => r.slot.location === code).length;
              const active = selectedLocation === code;
              return (
                <Link
                  key={code}
                  href={`/maintenance/room-diagrams?loc=${code}&shelf=01&bin=01`}
                  style={{
                    textDecoration: "none",
                    border: active ? "2px solid #2563eb" : "1px solid #222",
                    borderRadius: 10,
                    background: active ? "#dbeafe" : "#f8f8f8",
                    color: "#111",
                    padding: 10,
                    minHeight: 56,
                    display: "grid",
                    alignContent: "center",
                    gap: 4,
                  }}
                >
                  <strong>{locationLabel(code)}</strong>
                  <span style={{ fontSize: 12, opacity: 0.8 }}>{count} assigned items</span>
                </Link>
              );
            })}
          </div>
          {allLocationCodes.length === 0 ? (
            <p style={{ marginTop: 8, opacity: 0.8 }}>No SKU Location/Shelf/Bin assignments found yet.</p>
          ) : null}
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[{ code: "01", title: "Location #1 Shelf Diagram", bins: location1Bins }, { code: "02", title: "Location #2 Shelf Diagram", bins: location2Bins }].map((panel) => (
            <article key={panel.code} style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", padding: 12 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>{panel.title}</h2>
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {Array.from(new Set(panel.bins.map((b) => b.shelf))).length === 0 ? (
                  <div style={{ opacity: 0.75 }}>No shelf/bin assignments for this location.</div>
                ) : (
                  Array.from(new Set(panel.bins.map((b) => b.shelf)))
                    .sort((a, b) => Number(a) - Number(b))
                    .map((shelf) => {
                      const shelfBins = panel.bins.filter((b) => b.shelf === shelf);
                      return (
                        <div key={shelf} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 8, background: "var(--surface-2)" }}>
                          <div style={{ fontWeight: 800, marginBottom: 6 }}>Shelf {prettyCode(shelf)}</div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 6 }}>
                            {shelfBins.map((bin) => {
                              const isSelected = selectedLocation === panel.code && selectedShelf === bin.shelf && selectedBin === bin.bin;
                              return (
                                <Link
                                  key={`${panel.code}-${bin.shelf}-${bin.bin}`}
                                  href={`/maintenance/room-diagrams?loc=${panel.code}&shelf=${bin.shelf}&bin=${bin.bin}`}
                                  style={{
                                    textDecoration: "none",
                                    border: isSelected ? "2px solid #2563eb" : "1px solid var(--border)",
                                    borderRadius: 8,
                                    padding: 8,
                                    background: isSelected ? "#dbeafe" : "var(--surface)",
                                    color: "var(--foreground)",
                                    display: "grid",
                                    gap: 3,
                                  }}
                                >
                                  <strong>Bin {prettyCode(bin.bin)}</strong>
                                  <span style={{ fontSize: 12, opacity: 0.85 }}>{bin.summary.itemCount} items</span>
                                  <span style={{ fontSize: 12, opacity: 0.85 }}>Qty total: {bin.summary.qtyTotal}</span>
                                  {bin.summary.lowCount > 0 ? (
                                    <span style={{ fontSize: 12, color: "#b45309", fontWeight: 700 }}>
                                      {bin.summary.lowCount} at/below min
                                    </span>
                                  ) : null}
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </article>
          ))}
        </section>

        <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", padding: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>
            Quick Count Editor: {locationLabel(selectedLocation)} / Shelf {prettyCode(selectedShelf)} / Bin {prettyCode(selectedBin)}
          </h2>
          <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
            Fast adjustments for inventory counting. Use set value or quick +/- buttons.
          </p>

          {selectedRows.length === 0 ? (
            <div style={{ marginTop: 10, opacity: 0.8 }}>No items assigned to this bin.</div>
          ) : (
            <div style={{ marginTop: 10, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {[
                      "SKU",
                      "Item",
                      "On Hand",
                      "Min",
                      "Set Qty",
                      "Quick +/-",
                    ].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedRows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)", fontFamily: "monospace", fontSize: 12 }}>{row.sku}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)", fontWeight: 700 }}>{row.name}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{row.onHandQty}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{row.minQty}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
                        {canEditCounts ? (
                          <form action={quickCountUpdateAction} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <input type="hidden" name="itemId" value={row.id} />
                            <input type="hidden" name="mode" value="set" />
                            <input type="hidden" name="returnTo" value={selectedPath} />
                            <input
                              name="setQty"
                              type="number"
                              defaultValue={row.onHandQty}
                              style={{ width: 84, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)" }}
                            />
                            <button type="submit" style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", fontWeight: 800, cursor: "pointer" }}>
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
                                    background: delta < 0 ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)",
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!canEditCounts ? (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
              You can view diagrams, but quick count editing requires checkout or admin item-edit permission.
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
