import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { CREATE_WORK_ORDERS_FOR_OTHERS } from "@/app/lib/permission-constants";
import {
  PREVENTATIVE_MAINTENANCE_FIELDS,
  loadMaintenancePrimaryAssignments,
  normalizePmYear,
  savePreventativeMaintenanceEntryWithAudit,
} from "@/app/lib/preventative-maintenance";

export const dynamic = "force-dynamic";

type SearchParams = {
  year?: string | string[];
};

type PmEntry = {
  locationId: string;
  year: number;
  ovenCleaning: string | null;
  exhaustFanMotor: string | null;
  tanklessWaterHeater: string | null;
  iceMaker: string | null;
  greaseTrapGallons: string | null;
  updatedAt: Date;
};

type PmDb = {
  preventativeMaintenanceEntry: {
    findMany: (args: unknown) => Promise<PmEntry[]>;
  };
};

const pmDb = prisma as unknown as PmDb;

function parseText(v: FormDataEntryValue | null): string {
  if (typeof v !== "string") return "";
  return v.trim();
}

async function requireMaintenanceAreaAccess(session: unknown) {
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  const ok =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_CHECKOUT,
      Permission.CREATE_CHECKOUT,
      Permission.VIEW_WORK_ORDERS,
      Permission.CREATE_WORK_ORDERS,
      CREATE_WORK_ORDERS_FOR_OTHERS,
      Permission.UPDATE_OWN_WORK_ORDERS,
      Permission.SUBMIT_OWN_WORK_ORDERS,
      Permission.VIEW_LIVE_ORDERS,
    ]);

  if (!ok) redirect("/");
}

export default async function MaintenancePreventativeMaintenancePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const session = await getServerSession(authOptions);
  await requireMaintenanceAreaAccess(session);

  const resolvedSearchParams = (await searchParams) ?? {};
  const year = normalizePmYear(resolvedSearchParams.year);

  const email = String((session?.user as { email?: string | null } | null)?.email ?? "")
    .trim()
    .toLowerCase();
  if (!email) redirect("/login");

  const me = await prisma.user.findUnique({
    where: { email },
    select: { id: true, active: true, name: true },
  });
  if (!me || !me.active) redirect("/login");

  async function savePmRowAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    await requireMaintenanceAreaAccess(session);

    const email = String((session?.user as { email?: string | null } | null)?.email ?? "")
      .trim()
      .toLowerCase();
    if (!email) redirect("/login");

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, active: true },
    });
    if (!user || !user.active) redirect("/login");

    const locationId = String(formData.get("locationId") ?? "").trim();
    const year = Number(String(formData.get("year") ?? "").trim());

    if (!locationId) throw new Error("Location is required.");
    if (!Number.isFinite(year)) throw new Error("Year is required.");

    const assignments = await loadMaintenancePrimaryAssignments();
    const allowed = assignments.some((a) => a.userId === user.id && a.locationId === locationId);
    if (!allowed) {
      throw new Error("You are not assigned to this location's PM list.");
    }

    const ovenCleaning = parseText(formData.get("ovenCleaning"));
    const exhaustFanMotor = parseText(formData.get("exhaustFanMotor"));
    const tanklessWaterHeater = parseText(formData.get("tanklessWaterHeater"));
    const iceMaker = parseText(formData.get("iceMaker"));
    const greaseTrapGallons = parseText(formData.get("greaseTrapGallons"));

    await savePreventativeMaintenanceEntryWithAudit({
      locationId,
      year,
      actorUserId: user.id,
      source: "MAINTENANCE",
      values: {
        ovenCleaning,
        exhaustFanMotor,
        tanklessWaterHeater,
        iceMaker,
        greaseTrapGallons,
      },
    });

    revalidatePath("/maintenance/preventative-maintenance");
    revalidatePath("/admin/preventative-maintenance");
  }

  const assignments = await loadMaintenancePrimaryAssignments();
  const myAssignments = assignments.filter((a) => a.userId === me.id);

  const uniqueLocations = new Map<string, { id: string; name: string }>();
  for (const a of myAssignments) {
    if (!uniqueLocations.has(a.locationId)) {
      uniqueLocations.set(a.locationId, { id: a.locationId, name: a.locationName });
    }
  }

  const locations = Array.from(uniqueLocations.values()).sort((a, b) => a.name.localeCompare(b.name));
  const locationIds = locations.map((l) => l.id);

  const entries =
    locationIds.length > 0
      ? await pmDb.preventativeMaintenanceEntry.findMany({
          where: { year, locationId: { in: locationIds } },
          select: {
            locationId: true,
            year: true,
            ovenCleaning: true,
            exhaustFanMotor: true,
            tanklessWaterHeater: true,
            iceMaker: true,
            greaseTrapGallons: true,
            updatedAt: true,
          },
        })
      : [];

  const entryByLocation = new Map(entries.map((e) => [e.locationId, e]));

  const card: CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 14,
    background: "var(--surface)",
    boxShadow: "var(--shadow)",
    padding: 14,
  };

  const input: CSSProperties = {
    width: "100%",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "8px 10px",
    background: "var(--surface)",
    color: "var(--foreground)",
  };

  const saveBtn: CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "8px 10px",
    background: "var(--surface-2)",
    color: "var(--foreground)",
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <main style={{ display: "grid", gap: 14 }}>
      <section
        style={{
          ...card,
          background:
            "linear-gradient(150deg, color-mix(in srgb, var(--brand) 14%, var(--surface)) 0%, var(--surface) 70%)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Preventative Maintenance</h1>
        <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
          PM list for your assigned primary stores. Year is editable so you can switch between annual sheets.
        </p>
        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 14, fontWeight: 800 }}>
              Year
              <input name="year" type="number" defaultValue={year} min={2020} max={2100} style={{ ...input, width: 130, marginLeft: 8 }} />
            </label>
            <button type="submit" style={saveBtn}>
              Load
            </button>
          </form>
          <Link href="/maintenance" style={{ ...saveBtn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Back to Maintenance Hub
          </Link>
        </div>
      </section>

      {locations.length === 0 ? (
        <section style={card}>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            No primary PM assignments found for your user under the <b>Maintenance</b> title.
          </p>
        </section>
      ) : (
        <section style={card}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>Location</th>
                  {PREVENTATIVE_MAINTENANCE_FIELDS.map((field) => (
                    <th key={field.key} style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", minWidth: 170 }}>
                      {field.label}
                    </th>
                  ))}
                  <th style={{ textAlign: "right", padding: "10px 8px", borderBottom: "1px solid var(--border)", minWidth: 120 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => {
                  const row = entryByLocation.get(location.id);
                  return (
                    <tr key={location.id}>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)", fontWeight: 800 }}>{location.name}</td>
                      <td colSpan={6} style={{ padding: 0, borderBottom: "1px solid var(--border)" }}>
                        <form action={savePmRowAction} style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(170px, 1fr)) 120px", gap: 8, padding: 8, alignItems: "center" }}>
                          <input type="hidden" name="locationId" value={location.id} />
                          <input type="hidden" name="year" value={year} />

                          <input name="ovenCleaning" defaultValue={row?.ovenCleaning ?? ""} style={input} />
                          <input name="exhaustFanMotor" defaultValue={row?.exhaustFanMotor ?? ""} style={input} />
                          <input name="tanklessWaterHeater" defaultValue={row?.tanklessWaterHeater ?? ""} style={input} />
                          <input name="iceMaker" defaultValue={row?.iceMaker ?? ""} style={input} />
                          <input name="greaseTrapGallons" defaultValue={row?.greaseTrapGallons ?? ""} style={input} />

                          <button type="submit" style={{ ...saveBtn, width: "100%" }}>
                            Save
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
