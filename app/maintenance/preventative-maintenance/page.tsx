import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { VIEW_PREVENTATIVE_MAINTENANCE } from "@/app/lib/permission-constants";
import {
  PREVENTATIVE_MAINTENANCE_MAIN_SECTIONS,
  PREVENTATIVE_MAINTENANCE_COMPLIANCE_SECTIONS,
  type PreventativeMaintenanceValues,
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
  greaseTrapTankSize: string | null;
  greaseTrapDatePumped: string | null;
  greaseTrapReminderMonths: string | null;
  greaseTrapCompany: string | null;
  greaseTrapCost: string | null;
  backflowDateChecked: string | null;
  backflowReminderMonths: string | null;
  backflowCompany: string | null;
  backflowAmount: string | null;
  boilerInspectionDatePrimary: string | null;
  boilerInspectionReminderMonths: string | null;
  boilerInspectionCompany: string | null;
  boilerInspectionCost: string | null;
  boilerInspectionDateSecondary: string | null;
  updatedAt: Date;
};

type NumberedLocation = {
  id: string;
  name: string;
  locationNumber: string | null;
};

function locationSortValue(locationNumber: string | null | undefined): number {
  const raw = String(locationNumber ?? "").trim();
  if (!raw) return Number.MAX_SAFE_INTEGER;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function sortLocationsByNumberThenName(a: NumberedLocation, b: NumberedLocation): number {
  const an = locationSortValue(a.locationNumber);
  const bn = locationSortValue(b.locationNumber);
  if (an !== bn) return an - bn;
  return a.name.localeCompare(b.name);
}

function formatLocationLabel(location: NumberedLocation): string {
  const number = String(location.locationNumber ?? "").trim();
  return number ? `${number} - ${location.name}` : location.name;
}

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

function getSubmittedValues(formData: FormData): Partial<PreventativeMaintenanceValues> {
  const values: Partial<PreventativeMaintenanceValues> = {};
  for (const section of PREVENTATIVE_MAINTENANCE_MAIN_SECTIONS) {
    for (const field of section.fields) {
      if (!formData.has(field.key)) continue;
      values[field.key] = parseText(formData.get(field.key));
    }
  }
  return values;
}

async function requireMaintenanceAreaAccess(session: unknown) {
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  const ok = perms.allowAll || hasAnyPermission(perms, [VIEW_PREVENTATIVE_MAINTENANCE]);

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

    const values = getSubmittedValues(formData);

    await savePreventativeMaintenanceEntryWithAudit({
      locationId,
      year,
      actorUserId: user.id,
      source: "MAINTENANCE",
      values,
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

  const assignedIds = Array.from(uniqueLocations.keys());
  const locations =
    assignedIds.length > 0
      ? (
          await prisma.location.findMany({
            where: { id: { in: assignedIds }, active: true },
            select: { id: true, name: true, locationNumber: true },
          })
        ).sort(sortLocationsByNumberThenName)
      : [];
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
            greaseTrapTankSize: true,
            greaseTrapDatePumped: true,
            greaseTrapReminderMonths: true,
            greaseTrapCompany: true,
            greaseTrapCost: true,
            backflowDateChecked: true,
            backflowReminderMonths: true,
            backflowCompany: true,
            backflowAmount: true,
            boilerInspectionDatePrimary: true,
            boilerInspectionReminderMonths: true,
            boilerInspectionCompany: true,
            boilerInspectionCost: true,
            boilerInspectionDateSecondary: true,
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
          <Link
            href={`/maintenance/preventative-maintenance/compliance?year=${year}`}
            style={{ ...saveBtn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}
          >
            Backflow / Grease Trap / Boiler
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
        PREVENTATIVE_MAINTENANCE_MAIN_SECTIONS.map((section) => (
          <section key={section.id} style={card}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>{section.title}</h2>
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", minWidth: 180 }}>
                      Location
                    </th>
                    {section.fields.map((field) => (
                      <th
                        key={`${section.id}-head-${field.key}`}
                        style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", minWidth: 170 }}
                      >
                        {field.label}
                      </th>
                    ))}
                    <th style={{ textAlign: "right", padding: "10px 8px", borderBottom: "1px solid var(--border)", minWidth: 120 }}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {locations.map((location) => {
                    const row = entryByLocation.get(location.id);
                    const cols = `repeat(${section.fields.length}, minmax(170px, 1fr)) 120px`;
                    return (
                      <tr key={`${section.id}-${location.id}`}>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)", fontWeight: 800 }}>{formatLocationLabel(location)}</td>
                        <td colSpan={section.fields.length + 1} style={{ padding: 0, borderBottom: "1px solid var(--border)" }}>
                          <form
                            action={savePmRowAction}
                            style={{ display: "grid", gridTemplateColumns: cols, gap: 8, padding: 8, alignItems: "center" }}
                          >
                            <input type="hidden" name="locationId" value={location.id} />
                            <input type="hidden" name="year" value={year} />

                            {section.fields.map((field) => (
                              <input
                                key={`${section.id}-input-${location.id}-${field.key}`}
                                name={field.key}
                                defaultValue={String(row?.[field.key] ?? "")}
                                style={input}
                              />
                            ))}

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
        ))
      )}

      {PREVENTATIVE_MAINTENANCE_COMPLIANCE_SECTIONS.length > 0 ? (
        <section style={card}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Compliance & Testing</h2>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
            Backflow testing, grease trap pumping, and boiler inspections are now on their own screen.
          </p>
          <div style={{ marginTop: 10 }}>
            <Link
              href={`/maintenance/preventative-maintenance/compliance?year=${year}`}
              style={{ ...saveBtn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}
            >
              Open Compliance Screen
            </Link>
          </div>
        </section>
      ) : null}
    </main>
  );
}
