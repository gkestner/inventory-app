import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { getCompatDb } from "@/app/lib/workflow-foundations";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

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

type ReceiptRow = {
  id: string;
  receiptDate: Date;
  amountCents: number;
  notes: string | null;
  createdAt: Date;
  location: { name: string };
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
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.VIEW_WORK_ORDERS])) {
    redirect("/maintenance");
  }

  const email = String(session?.user?.email ?? "").trim().toLowerCase();
  const me = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      active: true,
      locationId: true,
      location: { select: { id: true, name: true } },
      allowedLocations: {
        orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { location: { name: "asc" } }],
        select: {
          locationId: true,
          isPrimary: true,
          location: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!me || !me.active) redirect("/login");

  const allowedLocations: Array<{ id: string; name: string; source: "PRIMARY" | "OPTIONAL" }> = [];
  const seen = new Set<string>();

  if (me.location) {
    seen.add(me.location.id);
    allowedLocations.push({ id: me.location.id, name: me.location.name, source: "PRIMARY" });
  }
  for (const ul of me.allowedLocations) {
    if (!ul.location) continue;
    if (seen.has(ul.location.id)) continue;
    seen.add(ul.location.id);
    allowedLocations.push({ id: ul.location.id, name: ul.location.name, source: ul.isPrimary ? "PRIMARY" : "OPTIONAL" });
  }

  const db = getCompatDb() as any;
  const rows: ReceiptRow[] = db.receiptEntry?.findMany
    ? await db.receiptEntry.findMany({
        where: { createdByUserId: me.id },
        orderBy: [{ receiptDate: "desc" }, { createdAt: "desc" }],
        take: 75,
        select: {
          id: true,
          receiptDate: true,
          amountCents: true,
          notes: true,
          createdAt: true,
          location: { select: { name: true } },
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
    if (!perms.allowAll && !hasAnyPermission(perms, [Permission.VIEW_WORK_ORDERS])) {
      redirect("/maintenance");
    }

    const email = String(session?.user?.email ?? "").trim().toLowerCase();
    const me = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        active: true,
        locationId: true,
        allowedLocations: {
          select: { locationId: true },
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
        },
      },
    });

    if (!me || !me.active) redirect("/login");

    const receiptDate = parseYmdDateAsUtcNoon(formData.get("receiptDate"));
    const amountCents = parseAmountToCents(formData.get("amount"));

    const locationIdRaw = formData.get("locationId");
    const locationId = typeof locationIdRaw === "string" ? locationIdRaw.trim() : "";

    const allowed = new Set<string>();
    if (me.locationId) allowed.add(me.locationId);
    for (const a of me.allowedLocations) allowed.add(a.locationId);
    if (!allowed.has(locationId)) throw new Error("Invalid location selection.");

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
          notes: notes || null,
          createdByUserId: me.id,
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

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto", display: "grid", gap: 14 }}>
      <section style={card}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Receipt Data Entry</h1>
        <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
          Log receipts with date, store location, amount, user areas, and optional notes.
        </p>
      </section>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>New Receipt</h2>

        <form action={createReceiptAction} style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
              Date
              <input type="date" name="receiptDate" defaultValue={todayNy} required style={input} />
            </label>

            <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
              Location
              <select name="locationId" defaultValue={allowedLocations[0]?.id ?? ""} required style={input}>
                {allowedLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.source === "PRIMARY" ? " (Primary)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
              Amount
              <input type="number" name="amount" min="0.01" step="0.01" placeholder="0.00" required style={input} />
            </label>
          </div>

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
                  <input type="checkbox" name="areas" value={area} style={checkboxStyle} />
                  {formatAreaLabel(area)}
                </label>
              ))}
            </div>
          </div>

          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
            Notes (optional)
            <textarea name="notes" rows={4} placeholder="Add any notes about this receipt" style={input} />
          </label>

          <div>
            <button type="submit" style={btn}>
              Save Receipt Entry
            </button>
          </div>
        </form>
      </section>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Recent Entries</h2>

        <div style={{ border, borderRadius: 12, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
            <thead>
              <tr>
                {["Date", "Location", "Amount", "Areas", "Notes", "Created"].map((h) => (
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
                  <td colSpan={6} style={{ padding: 10, opacity: 0.75 }}>
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
