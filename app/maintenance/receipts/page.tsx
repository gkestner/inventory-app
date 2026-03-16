import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { parseHiddenFromDropdowns } from "@/app/lib/user-preferences";
import { getCompatDb } from "@/app/lib/workflow-foundations";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { CREATE_RECEIPTS, VIEW_RECEIPTS } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type RequiredEquipmentArea =
  | "DOUGH_ROLLER"
  | "MAKETABLE"
  | "DOUGH_COOLER"
  | "MIXER"
  | "OVEN"
  | "WALK_IN"
  | "FREEZER"
  | "BUILDING_STRUCTURE"
  | "LIGHTING"
  | "PARKING_LOT"
  | "OFFICE"
  | "HVAC_GAME_ROOM"
  | "HVAC_KITCHEN"
  | "HVAC_DINING_ROOM"
  | "OTHER";

const EQUIPMENT_AREAS: RequiredEquipmentArea[] = [
  "DOUGH_ROLLER",
  "MAKETABLE",
  "DOUGH_COOLER",
  "MIXER",
  "OVEN",
  "WALK_IN",
  "FREEZER",
  "BUILDING_STRUCTURE",
  "LIGHTING",
  "PARKING_LOT",
  "OFFICE",
  "HVAC_GAME_ROOM",
  "HVAC_KITCHEN",
  "HVAC_DINING_ROOM",
  "OTHER",
];

const BILLED_BACK_VENDORS = [
  "United Refrigeration",
  "Baker Distributing",
  "Builders Mart",
  "Johnson Hilliard",
  "Johnstone Supply",
  "Kendall Electric",
  "MAuk & Adams Glass",
  "Hobart",
  "Southern Refrigeration",
  "Sherwin Williams",
  "Trane US",
  "TN Valley Aluminum",
  "Virginia Electric Supply",
  "Williams Electric",
] as const;

type BilledBackVendor = (typeof BILLED_BACK_VENDORS)[number];

function locationNeedsBilledBackVendor(locationNumber: string | null | undefined, locationName: string | null | undefined): boolean {
  const num = String(locationNumber ?? "").trim();
  if (num === "100") return true;

  const name = String(locationName ?? "").toLowerCase();
  return name.includes("billed back");
}

type ReceiptRow = {
  id: string;
  receiptDate: Date;
  amountCents: number;
  billedBackVendor: string | null;
  notes: string | null;
  createdAt: Date;
  location: { name: string };
  createdByUser: { name: string | null; email: string };
  areas: { area: string }[];
};

function requireSession(session: SessionShape) {
  if (!session) redirect("/login");
  if (!session.user?.email) redirect("/login");
}

function parseYmdDateAsUtcNoon(raw: FormDataEntryValue | null): Date {
  const s = typeof raw === "string" ? raw.trim() : "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error("Valid date is required.");

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    throw new Error("Valid date is required.");
  }

  return new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
}

function parseAmountToCents(raw: FormDataEntryValue | null): number {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) throw new Error("Amount is required.");
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Amount must be greater than 0.");
  return Math.round(n * 100);
}

function parseAreas(formData: FormData): RequiredEquipmentArea[] {
  const raw = formData.getAll("areas");
  const allowed = new Set<string>(EQUIPMENT_AREAS);

  const out: RequiredEquipmentArea[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (!allowed.has(s)) continue;
    out.push(s as RequiredEquipmentArea);
  }

  const seen = new Set<RequiredEquipmentArea>();
  const uniq: RequiredEquipmentArea[] = [];
  for (const a of out) {
    if (seen.has(a)) continue;
    seen.add(a);
    uniq.push(a);
  }
  return uniq;
}

function formatAreaLabel(area: string): string {
  const parts = area.split("_").filter(Boolean);
  return parts
    .map((p) => {
      const up = p.toUpperCase();
      if (up === "HVAC") return "HVAC";
      if (up === "DOUGH") return "Dough";
      return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    })
    .join(" ");
}

function moneyFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function fmtDate(d: Date | null): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function fmtDateTime(d: Date | null): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export default async function MaintenanceReceiptPage() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  requireSession(session);

  const perms = await loadUserPermissions(session);
  const canViewReceipts = perms.allowAll || hasAnyPermission(perms, [VIEW_RECEIPTS, CREATE_RECEIPTS]);
  const canCreateReceipts = perms.allowAll || hasAnyPermission(perms, [CREATE_RECEIPTS]);

  if (!canViewReceipts) {
    redirect("/maintenance");
  }

  const email = String(session?.user?.email ?? "").trim().toLowerCase();
  const [me, allActiveLocationsForReceipts] = await Promise.all([
    prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        active: true,
        locationId: true,
        location: { select: { id: true, name: true, active: true, receiptEnabled: true, locationNumber: true } },
        allowedLocations: {
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { location: { name: "asc" } }],
          select: {
            locationId: true,
            isPrimary: true,
            location: { select: { id: true, name: true, active: true, receiptEnabled: true, locationNumber: true } },
          },
        },
      },
    }),
    perms.allowAll
      ? prisma.location.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, locationNumber: true },
        })
      : Promise.resolve([]),
  ]);

  if (!me || !me.active) redirect("/login");

  const allowedLocations: Array<{ id: string; name: string; source: "PRIMARY" | "OPTIONAL"; locationNumber: string | null }> = [];
  const seen = new Set<string>();

  if (perms.allowAll) {
    for (const location of allActiveLocationsForReceipts) {
      if (seen.has(location.id)) continue;
      seen.add(location.id);
      allowedLocations.push({
        id: location.id,
        name: location.name,
        source: "PRIMARY",
        locationNumber: location.locationNumber ?? null,
      });
    }
  } else {
    if (me.location && me.location.active) {
      seen.add(me.location.id);
      allowedLocations.push({
        id: me.location.id,
        name: me.location.name,
        source: "PRIMARY",
        locationNumber: me.location.locationNumber ?? null,
      });
    }
    for (const ul of me.allowedLocations) {
      if (!ul.location) continue;
      if (!ul.location.active) continue;
      if (seen.has(ul.location.id)) continue;
      seen.add(ul.location.id);
      allowedLocations.push({
        id: ul.location.id,
        name: ul.location.name,
        source: ul.isPrimary ? "PRIMARY" : "OPTIONAL",
        locationNumber: ul.location.locationNumber ?? null,
      });
    }
  }

  const allowedLocationIds = allowedLocations.map((l) => l.id);
  const canCreateOnAnyLocation = canCreateReceipts && allowedLocationIds.length > 0;

  const usersForReceipts = (await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        { locationId: { in: allowedLocationIds } },
        { allowedLocations: { some: { locationId: { in: allowedLocationIds } } } },
      ],
    },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      locationId: true,
      allowedLocations: { select: { locationId: true } },
      uiPreferences: true,
    },
  })).filter((u) => !parseHiddenFromDropdowns(u.uiPreferences).includes("receipts"));

  const db = getCompatDb() as any;
  const rows: ReceiptRow[] = db.receiptEntry?.findMany
    ? await db.receiptEntry.findMany({
        where: {
          locationId: { in: allowedLocationIds },
          createdByUser: { active: true },
        },
        orderBy: [{ receiptDate: "desc" }, { createdAt: "desc" }],
        take: 75,
        select: {
          id: true,
          receiptDate: true,
          amountCents: true,
          billedBackVendor: true,
          notes: true,
          createdAt: true,
          location: { select: { name: true } },
          createdByUser: { select: { name: true, email: true } },
          areas: { select: { area: true }, orderBy: { area: "asc" } },
        },
      })
    : [];

  const todayNy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

  async function createReceiptAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    requireSession(session);

    const perms = await loadUserPermissions(session);
    const canCreateReceipts = perms.allowAll || hasAnyPermission(perms, [CREATE_RECEIPTS]);
    if (!canCreateReceipts) {
      throw new Error("You do not have permission to create receipt entries.");
    }

    const email = String(session?.user?.email ?? "").trim().toLowerCase();
    const me = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        active: true,
        locationId: true,
        location: { select: { id: true, active: true, receiptEnabled: true } },
        allowedLocations: {
          select: { locationId: true, location: { select: { active: true, receiptEnabled: true } } },
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
        },
      },
    });

    if (!me || !me.active) redirect("/login");

    const receiptDate = parseYmdDateAsUtcNoon(formData.get("receiptDate"));
    const amountCents = parseAmountToCents(formData.get("amount"));

    const locationIdRaw = formData.get("locationId");
    const locationId = typeof locationIdRaw === "string" ? locationIdRaw.trim() : "";

    const createdByUserIdRaw = formData.get("createdByUserId");
    const createdByUserId = typeof createdByUserIdRaw === "string" ? createdByUserIdRaw.trim() : "";
    if (!createdByUserId) throw new Error("User is required.");

    const allowed = new Set<string>();
    if (perms.allowAll) {
      const activeLocations = await prisma.location.findMany({
        where: { active: true },
        select: { id: true },
      });
      for (const location of activeLocations) allowed.add(location.id);
    } else {
      if (me.locationId && me.location?.active) allowed.add(me.locationId);
      for (const a of me.allowedLocations) {
        if (a.location?.active) allowed.add(a.locationId);
      }
    }
    if (!allowed.has(locationId)) throw new Error("Invalid location selection.");

    const selectedLocation = await prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true, name: true, active: true, receiptEnabled: true, locationNumber: true },
    });
    if (!selectedLocation || !selectedLocation.active) {
      throw new Error("Selected location is not active.");
    }

    const selectedUser = await prisma.user.findUnique({
      where: { id: createdByUserId },
      select: {
        id: true,
        active: true,
        locationId: true,
        allowedLocations: { select: { locationId: true } },
      },
    });
    if (!selectedUser || !selectedUser.active) throw new Error("Selected user is not active.");

    const userAllowed = new Set<string>();
    if (selectedUser.locationId) userAllowed.add(selectedUser.locationId);
    for (const a of selectedUser.allowedLocations) userAllowed.add(a.locationId);
    if (!userAllowed.has(locationId)) {
      throw new Error("Selected user is not assigned to the selected location.");
    }

    const billedBackVendorRaw = String(formData.get("billedBackVendor") ?? "").trim();
    const needsBilledBackVendor = locationNeedsBilledBackVendor(selectedLocation.locationNumber, selectedLocation.name);
    const billedBackVendor = billedBackVendorRaw as BilledBackVendor;
    if (needsBilledBackVendor && !BILLED_BACK_VENDORS.includes(billedBackVendor)) {
      throw new Error("Please select a billed-back vendor for location 100 - Billed Back.");
    }

    const areas = parseAreas(formData);
    if (areas.length === 0) throw new Error("Please select at least one user area.");

    const notesRaw = formData.get("notes");
    const notes = typeof notesRaw === "string" ? notesRaw.trim() : "";

    const db = getCompatDb() as any;
    if (!db.receiptEntry?.create) {
      throw new Error("Receipt tables are not available. Run latest migrations.");
    }

    await db.$transaction(async (tx: any) => {
      const created = await tx.receiptEntry.create({
        data: {
          receiptDate,
          locationId,
          amountCents,
          billedBackVendor: needsBilledBackVendor ? billedBackVendor : null,
          notes: notes || null,
          createdByUserId,
        },
        select: { id: true },
      });

      await tx.receiptEntryArea.createMany({
        data: areas.map((area) => ({ receiptEntryId: created.id, area })),
      });
    });

    revalidatePath("/maintenance/receipts");
    revalidatePath("/maintenance");
    redirect("/maintenance/receipts");
  }

  const border = "1px solid rgba(128,128,128,0.25)";

  const card: CSSProperties = {
    border,
    borderRadius: 14,
    background: "var(--surface)",
    boxShadow: "var(--shadow)",
    padding: 14,
    display: "grid",
    gap: 10,
  };

  const input: CSSProperties = {
    border,
    borderRadius: 10,
    padding: "10px 12px",
    background: "var(--background)",
    color: "var(--foreground)",
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
  };

  const btn: CSSProperties = {
    border,
    borderRadius: 10,
    padding: "10px 14px",
    background: "var(--surface-2)",
    color: "var(--foreground)",
    fontWeight: 800,
    cursor: "pointer",
  };

  const checkboxStyle: CSSProperties = {
    width: 16,
    height: 16,
    accentColor: "var(--brand)",
  };

  const defaultLocation = allowedLocations[0] ?? null;
  const showBilledBackVendorByDefault = defaultLocation
    ? locationNeedsBilledBackVendor(defaultLocation.locationNumber, defaultLocation.name)
    : false;

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto", display: "grid", gap: 14 }}>
      <section style={card}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Receipt Data Entry</h1>
        <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
          Log receipts with date, store location, assigned user, amount, user areas, and optional notes.
        </p>
      </section>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>New Receipt</h2>

        <form action={createReceiptAction} style={{ display: "grid", gap: 12 }}>
          <div className="receipt-form-grid" style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontWeight: 800, minWidth: 0 }}>
              Date
              <input type="date" name="receiptDate" defaultValue={todayNy} required style={input} disabled={!canCreateOnAnyLocation} />
            </label>

            <label style={{ display: "grid", gap: 6, fontWeight: 800, minWidth: 0 }}>
              Location
              <select
                id="receipt-location-select"
                name="locationId"
                defaultValue={allowedLocations[0]?.id ?? ""}
                required
                style={input}
                disabled={!canCreateOnAnyLocation}
              >
                <option value="">Select location</option>
                {allowedLocations.map((l) => (
                  <option
                    key={l.id}
                    value={l.id}
                    data-location-number={l.locationNumber ?? ""}
                    data-location-name={l.name}
                  >
                    {l.name}
                    {l.source === "PRIMARY" ? " (Primary)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6, fontWeight: 800, minWidth: 0 }}>
              User
              <select name="createdByUserId" defaultValue={me.id} required style={input} disabled={!canCreateOnAnyLocation}>
                <option value="">Select user</option>
                {usersForReceipts.map((u) => (
                  <option key={u.id} value={u.id}>
                    {(u.name?.trim() || "(No Name)") + " (" + u.email + ")"}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6, fontWeight: 800, minWidth: 0 }}>
              Amount
              <input type="number" name="amount" min="0.01" step="0.01" placeholder="0.00" required style={input} disabled={!canCreateOnAnyLocation} />
            </label>
          </div>

          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: -4 }}>
            Only locations marked as receipt-enabled in Admin Locations appear here.
          </div>

          <div
            id="receipt-billed-back-vendor-wrap"
            style={{
              display: showBilledBackVendorByDefault ? "grid" : "none",
              gap: 6,
              fontWeight: 800,
            }}
          >
            <label style={{ display: "grid", gap: 6, fontWeight: 800, maxWidth: 480 }}>
              Billed-Back Vendor (Location 100)
              <select id="receipt-billed-back-vendor" name="billedBackVendor" defaultValue="" style={input}>
                <option value="">Select vendor</option>
                {BILLED_BACK_VENDORS.map((vendor) => (
                  <option key={vendor} value={vendor}>
                    {vendor}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <script
            dangerouslySetInnerHTML={{
              __html: `(() => {
  const locationSelect = document.getElementById("receipt-location-select");
  const vendorWrap = document.getElementById("receipt-billed-back-vendor-wrap");
  const vendorSelect = document.getElementById("receipt-billed-back-vendor");
  if (!locationSelect || !vendorWrap || !vendorSelect) return;

  const syncVendorVisibility = () => {
    const selected = locationSelect.options[locationSelect.selectedIndex];
    const locationNumber = (selected?.dataset?.locationNumber || "").trim();
    const locationName = (selected?.dataset?.locationName || "").toLowerCase();
    const show = locationNumber === "100" || locationName.includes("billed back");
    vendorWrap.style.display = show ? "grid" : "none";
    vendorSelect.required = show;
    if (!show) vendorSelect.value = "";
  };

  syncVendorVisibility();
  locationSelect.addEventListener("change", syncVendorVisibility);
})();`,
            }}
          />

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 900 }}>User Areas</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                gap: 8,
              }}
            >
              {EQUIPMENT_AREAS.map((area) => (
                <label
                  key={area}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    border,
                    borderRadius: 10,
                    padding: "8px 10px",
                    background: "var(--background)",
                    fontWeight: 700,
                  }}
                >
                  <input type="checkbox" name="areas" value={area} style={checkboxStyle} disabled={!canCreateOnAnyLocation} />
                  {formatAreaLabel(area)}
                </label>
              ))}
            </div>
          </div>

          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
            Notes (optional)
            <textarea name="notes" rows={4} placeholder="Add any notes about this receipt" style={input} disabled={!canCreateOnAnyLocation} />
          </label>

          <div>
            <button type="submit" style={btn} disabled={!canCreateOnAnyLocation}>
              Save Receipt Entry
            </button>
            {!canCreateReceipts ? (
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                You have view-only access. Ask an admin to grant <b>Create Receipts</b> in the permission tree.
              </div>
            ) : !canCreateOnAnyLocation ? (
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                No receipt-enabled locations are currently assigned to you. Ask admin to enable locations for receipts.
              </div>
            ) : null}
          </div>
        </form>

      </section>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Recent Entries</h2>

        <div style={{ border, borderRadius: 12, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
            <thead>
              <tr>
                {["Date", "Location", "User", "Billed-Back Vendor", "Amount", "Areas", "Notes", "Created"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: 8,
                      borderBottom: border,
                      fontSize: 12,
                      opacity: 0.9,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: 8, borderBottom: border, whiteSpace: "nowrap" }}>{fmtDate(r.receiptDate)}</td>
                  <td style={{ padding: 8, borderBottom: border }}>{r.location?.name ?? "-"}</td>
                  <td style={{ padding: 8, borderBottom: border, minWidth: 220 }}>
                    {(r.createdByUser?.name?.trim() || "(No Name)") + " (" + (r.createdByUser?.email || "-") + ")"}
                  </td>
                  <td style={{ padding: 8, borderBottom: border, minWidth: 220 }}>{r.billedBackVendor || "-"}</td>
                  <td style={{ padding: 8, borderBottom: border, whiteSpace: "nowrap", fontWeight: 800 }}>
                    {moneyFromCents(r.amountCents)}
                  </td>
                  <td style={{ padding: 8, borderBottom: border, minWidth: 220 }}>
                    {r.areas.length > 0 ? r.areas.map((a) => formatAreaLabel(a.area)).join(", ") : "-"}
                  </td>
                  <td style={{ padding: 8, borderBottom: border, minWidth: 240 }}>{r.notes?.trim() || "-"}</td>
                  <td style={{ padding: 8, borderBottom: border, whiteSpace: "nowrap" }}>{fmtDateTime(r.createdAt)}</td>
                </tr>
              ))}

              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 10, opacity: 0.75 }}>
                    No receipt entries yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
