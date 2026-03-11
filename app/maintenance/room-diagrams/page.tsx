import Link from "next/link";
import { getServerSession } from "next-auth";
import { InvoiceVendor, Permission, Prisma } from "@prisma/client";
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
  partNumber: string | null;
  vendor: InvoiceVendor;
  name: string;
  description: string | null;
  category: string | null;
  manufacturer: string | null;
  orderFrom: string | null;
  webUrl: string | null;
  cost: Prisma.Decimal | null;
  price: Prisma.Decimal | null;
  taxable: boolean;
  onHandQty: number;
  usedQty: number;
  orderedQty: number;
  minQty: number;
  reorderIgnored: boolean;
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

function normalizeSearchText(v: string): string {
  return (v || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—−]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeQuery(q: string): string[] {
  const normalized = normalizeSearchText(q);
  if (!normalized) return [];

  return normalized
    .split(/[ \-]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function rowSearchText(row: SlotRow): string {
  const vendorLabel =
    row.vendor === "AMERICAN_PLUS"
      ? "american plus"
      : row.vendor === "SUCCESS_PLUS"
        ? "success plus"
        : String(row.vendor ?? "").toLowerCase();

  const taxableStr = row.taxable ? "taxable yes" : "taxable no";
  const activeStr = row.active ? "active yes" : "active no";
  const reorderIgnoredStr = row.reorderIgnored ? "reorder ignored yes" : "reorder ignored no";

  return normalizeSearchText(
    [
      row.id,
      row.sku,
      row.partNumber ?? "",
      vendorLabel,
      row.name ?? "",
      row.category ?? "",
      row.description ?? "",
      row.manufacturer ?? "",
      row.orderFrom ?? "",
      row.webUrl ?? "",
      String(row.cost ?? ""),
      String(row.price ?? ""),
      taxableStr,
      activeStr,
      reorderIgnoredStr,
      `${row.slot.location} ${row.slot.shelf} ${row.slot.bin}`,
      String(row.onHandQty ?? ""),
      String(row.usedQty ?? ""),
      String(row.minQty ?? ""),
      String(row.orderedQty ?? ""),
    ].join(" "),
  );
}

function rowMatchesQuery(row: SlotRow, q: string): boolean {
  const tokens = tokenizeQuery(q);
  if (tokens.length === 0) return true;
  const hay = rowSearchText(row);
  return tokens.every((tok) => hay.includes(tok));
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
      partNumber: true,
      vendor: true,
      name: true,
      description: true,
      category: true,
      manufacturer: true,
      orderFrom: true,
      webUrl: true,
      cost: true,
      price: true,
      taxable: true,
      onHandQty: true,
      usedQty: true,
      orderedQty: true,
      minQty: true,
      reorderIgnored: true,
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
    ? slotRows.filter((row) => rowMatchesQuery(row, q))
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

  const shelfCodes = Array.from({ length: 24 }, (_, idx) => String(idx + 1).padStart(2, "0"));

  const binsOnFocusedShelf = Array.from(
    new Set(slotRows.filter((r) => r.slot.location === focusLocation && r.slot.shelf === focusShelf).map((r) => r.slot.bin))
  ).sort((a, b) => Number(a) - Number(b));

  const selectedBinPositionFeet = toBinPositionFeet(focusBin, binsOnFocusedShelf);
  const selectedBinPositionPercent = positionToPercent(selectedBinPositionFeet);
  const parsedFocusBin = Number(focusBin);
  const selectedWholeBin = Number.isFinite(parsedFocusBin) ? Math.trunc(parsedFocusBin) : null;

  const shelfLayout =
    focusLocation === "01"
      ? {
          columns: [
            ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"],
            ["13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24"],
          ],
          aisleLefts: ["49.2%"],
          columnLefts: ["3.2%", "52.2%"],
          columnWidth: "44%",
          rowTopStart: 44,
          rowStep: 49,
          mapMinWidth: 980,
          mapHeight: 680,
        }
      : {
          columns: [
            ["01", "02", "03", "04", "05", "06", "07", "08"],
            ["09", "10", "11", "12", "13", "14", "15", "16"],
            ["17", "18", "19", "20", "21", "22", "23", "24"],
          ],
          aisleLefts: ["32.5%", "65.5%"],
          columnLefts: ["4%", "37%", "70%"],
          columnWidth: "26%",
          rowTopStart: 44,
          rowStep: 70,
          mapMinWidth: 1040,
          mapHeight: 620,
        };

  return (
    <main>
      <div style={{ width: "100%", margin: "0 auto", display: "grid", gap: 12, paddingInline: 10 }}>
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
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                id="room-diagram-search"
                name="q"
                defaultValue={q}
                placeholder="Search ID, SKU, part #, name, category, vendor, mfg, order from..."
                style={{
                  width: "min(520px, 100%)",
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--foreground)",
                }}
              />
              <button
                type="submit"
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--foreground)",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Search
              </button>
              <Link
                href="/maintenance/room-diagrams"
                style={{
                  textDecoration: "none",
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--foreground)",
                  fontWeight: 800,
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
                          border: isActive ? "2px solid color-mix(in srgb, var(--brand) 70%, #3b82f6)" : "1px solid var(--border)",
                          borderRadius: 10,
                          padding: "8px 10px",
                          background: isActive
                            ? "color-mix(in srgb, var(--brand) 20%, var(--surface-2))"
                            : "var(--surface-2)",
                          color: "var(--foreground)",
                          display: "grid",
                          gap: 2,
                          boxShadow: isActive ? "0 0 0 1px color-mix(in srgb, var(--brand) 30%, transparent)" : "none",
                        }}
                      >
                        <strong>{row.name}</strong>
                        <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace" }}>{row.sku}</span>
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>
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

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.5fr",
            gap: 12,
            alignItems: "start",
          }}
        >
          <article style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", padding: 12 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>1) Maintenance Location Diagram</h2>
            <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
              Fixed room layout map with desk/walls. Highlighted box is the selected maintenance location.
            </p>
            <div
              style={{
                marginTop: 10,
                border: "2px solid #111827",
                borderRadius: 12,
                background: "#d9d9d9",
                padding: 8,
                position: "relative",
                minHeight: 520,
                color: "#0f172a",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: "1%",
                  top: "33%",
                  width: "9%",
                  height: "62%",
                  border: "2px solid #111827",
                  background: "#efefef",
                  display: "grid",
                  gridTemplateRows: "40px 1fr",
                  overflow: "hidden",
                }}
              >
                <div style={{ borderBottom: "2px solid #111827", display: "grid", placeItems: "center", fontWeight: 900 }}>
                  Desk
                </div>
              </div>

              {[
                { code: "01", left: "10%", top: "1%", width: "44%", height: "11%" },
                { code: "02", left: "57%", top: "1%", width: "43%", height: "11%" },
                { code: "03", left: "95%", top: "20%", width: "5%", height: "64%", vertical: true },
                { code: "04", left: "55%", top: "31%", width: "28%", height: "28%" },
                { code: "05", left: "63%", top: "85%", width: "37%", height: "9%" },
                { code: "06", left: "84%", top: "77%", width: "16%", height: "9%" },
                { code: "07", left: "73%", top: "77%", width: "11%", height: "9%" },
                { code: "10", left: "63%", top: "77%", width: "10%", height: "9%" },
                { code: "08", left: "52%", top: "79%", width: "11%", height: "15%" },
                { code: "09", left: "36%", top: "82%", width: "13%", height: "12%" },
              ].map((zone) => {
                const active = focusLocation === zone.code;
                const itemCount = slotRows.filter((r) => r.slot.location === zone.code).length;
                const compactZone = ["06", "07", "08", "09", "10"].includes(zone.code);
                return (
                  <div
                    key={zone.code}
                    style={{
                      position: "absolute",
                      left: zone.left,
                      top: zone.top,
                      width: zone.width,
                      height: zone.height,
                      border: active ? "3px solid #0f172a" : "2px solid #111827",
                      background: active ? "#fde68a" : "#efefef",
                      display: "grid",
                      placeItems: "center",
                      padding: 4,
                      color: "#0f172a",
                      fontWeight: 900,
                    }}
                  >
                    <div
                      style={
                        zone.vertical
                          ? {
                              writingMode: "vertical-rl",
                              textOrientation: "upright",
                              letterSpacing: 1,
                              fontSize: 16,
                              lineHeight: 1,
                            }
                          : {
                              fontSize: compactZone ? 10 : 16,
                              lineHeight: compactZone ? 1 : 1.1,
                              textAlign: "center",
                              whiteSpace: compactZone ? "pre-line" : "nowrap",
                            }
                      }
                    >
                      {compactZone ? `Location\n#${prettyCode(zone.code)}` : locationLabel(zone.code)}
                    </div>
                    <div
                      style={
                        zone.vertical || compactZone
                          ? { display: "none" }
                          : {
                              position: "absolute",
                              right: 6,
                              bottom: 4,
                              fontSize: 11,
                              fontWeight: 700,
                              opacity: 0.9,
                            }
                      }
                    >
                      {itemCount} items
                    </div>
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
                color: "#0f172a",
              }}
            >
              <div
                style={{
                  position: "relative",
                  height: shelfLayout.mapHeight,
                  border: "2px solid #111827",
                  background: "#ececec",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    height: 24,
                    borderBottom: "2px solid #111827",
                    background: "#bed3e7",
                    display: "grid",
                    placeItems: "center",
                    fontWeight: 900,
                    fontSize: 14,
                  }}
                >
                  {locationLabel(focusLocation)} Shelf Map
                </div>

                {shelfLayout.aisleLefts.map((left) => (
                  <div key={left} style={{ position: "absolute", left, top: 24, bottom: 0, width: 18, background: "#111827" }} />
                ))}

                {shelfLayout.columns.map((columnShelves, columnIndex) =>
                  columnShelves.map((code, rowIndex) => {
                    const active = focusShelf === code;
                    const count = countItemsForShelf(slotRows, focusLocation, code);
                    const left = shelfLayout.columnLefts[columnIndex] ?? "4%";
                    const top = `${shelfLayout.rowTopStart + rowIndex * shelfLayout.rowStep}px`;

                    return (
                      <div
                        key={`${columnIndex}-${code}`}
                        style={{
                          position: "absolute",
                          left,
                          top,
                          width: shelfLayout.columnWidth,
                          height: 58,
                          border: active ? "3px solid #0f172a" : "2px solid #1f2937",
                          background: active ? "#fde68a" : "#f3f4f6",
                          display: "grid",
                          gridTemplateRows: "14px 1fr",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 900,
                            lineHeight: 1,
                            background: "#9ee8f7",
                            borderBottom: "1px solid #1f2937",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "0 4px",
                          }}
                        >
                          <span>Shelf {prettyCode(code)}</span>
                          <span>{count}</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gridTemplateRows: "repeat(2, 1fr)", gap: 0 }}>
                          {Array.from({ length: 16 }).map((_, i) => (
                            <div
                              key={`${code}-${i}`}
                              style={{
                                borderRight: "1px solid #374151",
                                borderBottom: i < 8 ? "1px solid #374151" : "0",
                                background: active ? "#fff7cc" : "#d6d6d6",
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
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
                height: 104,
                border: "2px solid #111827",
                borderRadius: 8,
                background: "#e5e7eb",
                padding: "10px 12px",
              }}
            >
              <div style={{ position: "absolute", left: 12, right: 12, top: 18, display: "grid", gridTemplateColumns: "8px repeat(10, minmax(0, 1fr)) 8px", gap: 0, alignItems: "end" }}>
                <div style={{ height: 72, background: "#111827" }} />
                {Array.from({ length: 10 }).map((_, i) => {
                  const binNumber = i + 1;
                  const isSelected = selectedWholeBin === binNumber;
                  return (
                    <div
                      key={binNumber}
                      style={{
                        height: 36,
                        borderTop: "2px solid #374151",
                        borderBottom: "2px solid #374151",
                        borderLeft: i === 0 ? "2px solid #374151" : "1px solid #374151",
                        borderRight: i === 9 ? "2px solid #374151" : "1px solid #374151",
                        background: isSelected ? "#fde68a" : "#f3f4f6",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 12,
                        fontWeight: 900,
                        color: "#0f172a",
                      }}
                    >
                      {binNumber}
                    </div>
                  );
                })}
                <div style={{ height: 72, background: "#111827" }} />
              </div>

              <div
                style={{
                  position: "absolute",
                  left: `${selectedBinPositionPercent}%`,
                  top: 2,
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
