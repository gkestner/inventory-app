import Link from "next/link";
import { getServerSession } from "next-auth";
import { Permission } from "@prisma/client";
import { redirect } from "next/navigation";

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

function buildItemHref(query: string, row: SlotRow): string {
  const p = new URLSearchParams();
  if (query) p.set("q", query);
  p.set("item", row.id);
  p.set("loc", row.slot.location);
  p.set("shelf", row.slot.shelf);
  p.set("bin", row.slot.bin);
  return `/maintenance/room-diagrams?${p.toString()}`;
}

function buildQuickCountHref(slot: ParsedSkuSlot): string {
  const p = new URLSearchParams();
  p.set("loc", slot.location);
  p.set("shelf", slot.shelf);
  p.set("bin", slot.bin);
  return `/maintenance/room-diagrams/quick-count?${p.toString()}`;
}

function toBinPositionFeet(binCode: string, shelfBins: string[]): number {
  const unique = Array.from(new Set(shelfBins)).sort((a, b) => Number(a) - Number(b));
  const idx = unique.findIndex((b) => b === binCode);
  if (idx === -1) return 0;
  if (unique.length === 1) return 5.25;
  const pct = idx / (unique.length - 1);
  return Number((pct * 10.5).toFixed(2));
}

function positionToPercent(positionFeet: number): number {
  return Math.max(0, Math.min(100, (positionFeet / 10.5) * 100));
}

function countItemsForShelf(rows: SlotRow[], location: string, shelf: string): number {
  return rows.filter((r) => r.slot.location === location && r.slot.shelf === shelf).length;
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
      Permission.ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_EDIT_ITEMS,
    ]);

  if (!canViewRoomDiagrams) redirect("/");

  const canEditCounts =
    perms.allowAll ||
    hasAnyPermission(perms, [Permission.CREATE_CHECKOUT, Permission.ADMIN_EDIT_ITEMS]);

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
  const q = String(firstParam(paramsRaw, "q") ?? "").trim();
  const selectedItemId = String(firstParam(paramsRaw, "item") ?? "").trim();

  const filteredRows = q
    ? slotRows.filter((row) => {
        const hay = `${row.name} ${row.sku}`.toLowerCase();
        return hay.includes(q.toLowerCase());
      })
    : [];

  const selectedItem =
    slotRows.find((row) => row.id === selectedItemId) ??
    (filteredRows.length === 1 ? filteredRows[0] : null);

  const fallbackLocation = normalize2(firstParam(paramsRaw, "loc") ?? "01") || "01";
  const fallbackShelf = normalize2(firstParam(paramsRaw, "shelf") ?? "01") || "01";
  const fallbackBin = normalize2(firstParam(paramsRaw, "bin") ?? "01") || "01";

  const focusLocation = selectedItem?.slot.location ?? fallbackLocation;
  const focusShelf = selectedItem?.slot.shelf ?? fallbackShelf;
  const focusBin = selectedItem?.slot.bin ?? fallbackBin;

  const locationCodes = Array.from({ length: 10 }, (_, idx) => String(idx + 1).padStart(2, "0"));
  const shelfCodes = Array.from({ length: 24 }, (_, idx) => String(idx + 1).padStart(2, "0"));

  const binsOnFocusedShelf = Array.from(
    new Set(slotRows.filter((r) => r.slot.location === focusLocation && r.slot.shelf === focusShelf).map((r) => r.slot.bin))
  ).sort((a, b) => Number(a) - Number(b));

  const selectedBinPositionFeet = toBinPositionFeet(focusBin, binsOnFocusedShelf);
  const selectedBinPositionPercent = positionToPercent(selectedBinPositionFeet);

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
            Search a part and view where it sits in the room: maintenance location, shelf, and bin position.
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
            {canEditCounts ? (
              <Link
                href={buildQuickCountHref({ location: focusLocation, shelf: focusShelf, bin: focusBin })}
                style={{
                  textDecoration: "none",
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid color-mix(in srgb, var(--brand) 50%, var(--border))",
                  background: "color-mix(in srgb, var(--brand) 16%, var(--surface))",
                  color: "var(--foreground)",
                  fontWeight: 900,
                }}
              >
                Open Quick Count Editor
              </Link>
            ) : null}
          </div>
        </section>

        <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", padding: 12 }}>
          <form style={{ display: "grid", gap: 8 }}>
            <label htmlFor="room-diagram-search" style={{ fontWeight: 800 }}>
              Search Part (SKU or Name)
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                id="room-diagram-search"
                name="q"
                defaultValue={q}
                placeholder="Search by item name or SKU"
                style={{
                  flex: "1 1 320px",
                  padding: "9px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--foreground)",
                }}
              />
              <button
                type="submit"
                style={{
                  padding: "9px 14px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--foreground)",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Search
              </button>
              <Link
                href="/maintenance/room-diagrams"
                style={{
                  textDecoration: "none",
                  padding: "9px 14px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--foreground)",
                  fontWeight: 700,
                }}
              >
                Clear
              </Link>
            </div>
          </form>

          {q ? (
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 800 }}>
                {filteredRows.length} matching part{filteredRows.length === 1 ? "" : "s"}
              </div>
              {filteredRows.length === 0 ? (
                <div style={{ opacity: 0.75 }}>No matching items were found.</div>
              ) : (
                <div style={{ display: "grid", gap: 6, maxHeight: 220, overflowY: "auto", paddingRight: 4 }}>
                  {filteredRows.slice(0, 100).map((row) => {
                    const isActive = selectedItem?.id === row.id;
                    return (
                      <Link
                        key={row.id}
                        href={buildItemHref(q, row)}
                        style={{
                          textDecoration: "none",
                          border: isActive ? "2px solid #2563eb" : "1px solid var(--border)",
                          borderRadius: 10,
                          padding: "8px 10px",
                          background: isActive ? "#dbeafe" : "var(--surface-2)",
                          color: "var(--foreground)",
                          display: "grid",
                          gap: 2,
                        }}
                      >
                        <strong>{row.name}</strong>
                        <span style={{ fontSize: 12, opacity: 0.85, fontFamily: "monospace" }}>{row.sku}</span>
                        <span style={{ fontSize: 12, opacity: 0.85 }}>
                          {locationLabel(row.slot.location)} / Shelf {prettyCode(row.slot.shelf)} / Bin {prettyCode(row.slot.bin)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 10, opacity: 0.8 }}>
              Search for a part to highlight its exact location on all diagrams.
            </div>
          )}
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 12 }}>
          <article style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", padding: 12 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>1) Maintenance Location Diagram</h2>
            <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
              Highlighted area shows the selected part's maintenance location.
            </p>
            <div
              style={{
                marginTop: 10,
                border: "2px solid #111827",
                borderRadius: 12,
                background: "#d9d9d9",
                padding: 10,
                display: "grid",
                gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                gap: 8,
                color: "#0f172a",
              }}
            >
              {locationCodes.map((code) => {
                const active = focusLocation === code;
                const itemCount = slotRows.filter((r) => r.slot.location === code).length;
                return (
                  <div
                    key={code}
                    style={{
                      border: active ? "3px solid #0f172a" : "2px solid #1f2937",
                      borderRadius: 8,
                      background: active ? "#fde68a" : "#efefef",
                      padding: 8,
                      minHeight: 56,
                      display: "grid",
                      alignContent: "center",
                      gap: 2,
                      color: "#0f172a",
                    }}
                  >
                    <strong>{locationLabel(code)}</strong>
                    <span style={{ fontSize: 12, opacity: 0.9 }}>{itemCount} items</span>
                  </div>
                );
              })}
            </div>
          </article>

          <article style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", padding: 12 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>2) Shelf Diagram</h2>
            <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
              Shelves are available in every location. The selected shelf is highlighted.
            </p>
            <div
              style={{
                marginTop: 10,
                border: "2px solid #111827",
                borderRadius: 12,
                background: "#d9d9d9",
                padding: 10,
                display: "grid",
                gridTemplateColumns: "1fr",
                gap: 6,
                maxHeight: 320,
                overflowY: "auto",
                color: "#0f172a",
              }}
            >
              {shelfCodes.map((code) => {
                const active = focusShelf === code;
                const count = countItemsForShelf(slotRows, focusLocation, code);
                return (
                  <div
                    key={code}
                    style={{
                      border: active ? "3px solid #0f172a" : "2px solid #374151",
                      borderRadius: 8,
                      padding: "6px 8px 8px",
                      background: active ? "#fde68a" : "#f3f4f6",
                      display: "grid",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <strong style={{ fontSize: 13, color: "#0f172a" }}>Shelf {prettyCode(code)}</strong>
                      <span style={{ fontSize: 11, opacity: 0.85, color: "#0f172a" }}>{count} items</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gap: 2 }}>
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div
                          key={`${code}-${i}`}
                          style={{
                            height: 14,
                            border: "1px solid #374151",
                            background: active ? "#fff7cc" : "#e5e7eb",
                          }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        </section>

        <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", padding: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>3) Bin Position Diagram (0 to 10.5)</h2>
          <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
            0 = left shelf wall, 10.5 = right shelf wall. Selected bin is mapped onto this ruler.
          </p>

          <div style={{ marginTop: 12, border: "2px solid #111827", borderRadius: 12, background: "#d9d9d9", padding: 12, color: "#0f172a" }}>
            <div
              style={{
                position: "relative",
                height: 72,
                border: "2px solid #111827",
                borderRadius: 8,
                background: "#e5e7eb",
              }}
            >
              {Array.from({ length: 22 }).map((_, idx) => {
                const value = idx * 0.5;
                const pct = (value / 10.5) * 100;
                return (
                  <div
                    key={value}
                    style={{
                      position: "absolute",
                      left: `${pct}%`,
                      top: 0,
                      bottom: 0,
                      width: idx % 2 === 0 ? 2 : 0,
                      background: idx % 2 === 0 ? "rgba(17,24,39,0.25)" : "transparent",
                    }}
                  />
                );
              })}

              <div
                style={{
                  position: "absolute",
                  left: `${selectedBinPositionPercent}%`,
                  top: 6,
                  transform: "translateX(-50%)",
                  display: "grid",
                  gap: 2,
                  justifyItems: "center",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 900, background: "#fde68a", border: "2px solid #0f172a", borderRadius: 999, padding: "2px 8px", color: "#0f172a" }}>
                  Bin {prettyCode(focusBin)}
                </div>
                <div style={{ width: 0, height: 0, borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderTop: "12px solid #0f172a" }} />
              </div>

              <div style={{ position: "absolute", left: 10, bottom: 6, fontSize: 12, fontWeight: 900, color: "#0f172a" }}>0</div>
              <div style={{ position: "absolute", right: 10, bottom: 6, fontSize: 12, fontWeight: 900, color: "#0f172a" }}>10.5</div>
            </div>

            <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
              <div style={{ fontWeight: 800 }}>
                Current selection: {locationLabel(focusLocation)} / Shelf {prettyCode(focusShelf)} / Bin {prettyCode(focusBin)}
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                Bin position: {selectedBinPositionFeet.toFixed(2)} of 10.5 feet across the shelf.
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                Bins detected on this shelf: {binsOnFocusedShelf.length ? binsOnFocusedShelf.map((b) => prettyCode(b)).join(", ") : "none"}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
