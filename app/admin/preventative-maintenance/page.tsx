import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { canAccessAdmin } from "@/app/lib/admin-access";
import {
  PREVENTATIVE_MAINTENANCE_SECTIONS,
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
  greaseTrapCompany: string | null;
  greaseTrapCost: string | null;
  backflowDateChecked: string | null;
  backflowCompany: string | null;
  backflowAmount: string | null;
  boilerInspectionDatePrimary: string | null;
  boilerInspectionCompany: string | null;
  boilerInspectionDateSecondary: string | null;
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

function getSubmittedValues(formData: FormData): Partial<PreventativeMaintenanceValues> {
  const values: Partial<PreventativeMaintenanceValues> = {};
  for (const section of PREVENTATIVE_MAINTENANCE_SECTIONS) {
    for (const field of section.fields) {
      if (!formData.has(field.key)) continue;
      values[field.key] = parseText(formData.get(field.key));
    }
  }
  return values;
}

async function requireAdminAccess(session: unknown) {
  if (!session) redirect("/login");
  const allowed = await canAccessAdmin(session);
  if (!allowed) redirect("/");
}

export default async function AdminPreventativeMaintenancePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const session = await getServerSession(authOptions);
  await requireAdminAccess(session);

  const resolvedSearchParams = (await searchParams) ?? {};
  const year = normalizePmYear(resolvedSearchParams.year);

  async function savePmRowAsAdminAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    await requireAdminAccess(session);

    const actorEmail = String((session?.user as { email?: string | null } | null)?.email ?? "")
      .trim()
      .toLowerCase();
    if (!actorEmail) redirect("/login");

    const actor = await prisma.user.findUnique({
      where: { email: actorEmail },
      select: { id: true, active: true },
    });
    if (!actor || !actor.active) redirect("/login");

    const locationId = String(formData.get("locationId") ?? "").trim();
    const year = Number(String(formData.get("year") ?? "").trim());
    if (!locationId) throw new Error("Location is required.");
    if (!Number.isFinite(year)) throw new Error("Year is required.");

    const values = getSubmittedValues(formData);

    await savePreventativeMaintenanceEntryWithAudit({
      locationId,
      year,
      actorUserId: actor.id,
      source: "ADMIN",
      values,
    });

    revalidatePath("/admin/preventative-maintenance");
    revalidatePath("/maintenance/preventative-maintenance");
  }

  const [locations, entries, assignments] = await Promise.all([
    prisma.location.findMany({
      where: { active: true, NOT: [{ name: "Office" }, { name: "office" }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    pmDb.preventativeMaintenanceEntry.findMany({
      where: { year },
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
        greaseTrapCompany: true,
        greaseTrapCost: true,
        backflowDateChecked: true,
        backflowCompany: true,
        backflowAmount: true,
        boilerInspectionDatePrimary: true,
        boilerInspectionCompany: true,
        boilerInspectionDateSecondary: true,
      },
    }),
    loadMaintenancePrimaryAssignments(),
  ]);

  const entryByLocation = new Map(entries.map((e) => [e.locationId, e]));

  const usersByLocation = new Map<string, Array<{ userId: string; userName: string }>>();
  for (const a of assignments) {
    const list = usersByLocation.get(a.locationId) ?? [];
    list.push({ userId: a.userId, userName: a.userName });
    usersByLocation.set(a.locationId, list);
  }

  const groupMap = new Map<string, { label: string; locations: Array<{ id: string; name: string }> }>();
  for (const location of locations) {
    const assignedUsers = usersByLocation.get(location.id) ?? [];
    if (assignedUsers.length === 0) {
      const key = "__unassigned__";
      const existing = groupMap.get(key) ?? { label: "Unassigned", locations: [] };
      existing.locations.push(location);
      groupMap.set(key, existing);
      continue;
    }

    for (const user of assignedUsers) {
      const key = user.userId;
      const existing = groupMap.get(key) ?? { label: user.userName, locations: [] };
      existing.locations.push(location);
      groupMap.set(key, existing);
    }
  }

  const groups = Array.from(groupMap.values()).sort((a, b) => {
    if (a.label === "Unassigned") return 1;
    if (b.label === "Unassigned") return -1;
    return a.label.localeCompare(b.label);
  });

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
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Admin: Preventative Maintenance</h1>
        <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
          Same annual PM matrix for every location, grouped by technician assignment from primary locations under title
          <b> Maintenance</b>.
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
          <Link href="/admin" style={{ ...saveBtn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Back to Admin Hub
          </Link>
          <Link
            href={`/admin/reports/preventative-maintenance?year=${year}`}
            style={{ ...saveBtn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}
          >
            PM Audit / Reports
          </Link>
        </div>
      </section>

      {groups.map((group) => (
        <section key={group.label} style={card}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>{group.label}</h2>
          <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
            {PREVENTATIVE_MAINTENANCE_SECTIONS.map((section) => (
              <div key={`${group.label}-${section.id}`}>
                <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 900 }}>{section.title}</h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                    <thead>
                      <tr>
                        <th
                          style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", minWidth: 180 }}
                        >
                          Location
                        </th>
                        {section.fields.map((field) => (
                          <th
                            key={`${group.label}-${section.id}-head-${field.key}`}
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
                      {group.locations.map((location) => {
                        const row = entryByLocation.get(location.id);
                        const cols = `repeat(${section.fields.length}, minmax(170px, 1fr)) 120px`;
                        return (
                          <tr key={`${group.label}-${section.id}-${location.id}`}>
                            <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)", fontWeight: 800 }}>
                              {location.name}
                            </td>
                            <td colSpan={section.fields.length + 1} style={{ padding: 0, borderBottom: "1px solid var(--border)" }}>
                              <form
                                action={savePmRowAsAdminAction}
                                style={{ display: "grid", gridTemplateColumns: cols, gap: 8, padding: 8, alignItems: "center" }}
                              >
                                <input type="hidden" name="locationId" value={location.id} />
                                <input type="hidden" name="year" value={year} />

                                {section.fields.map((field) => (
                                  <input
                                    key={`${group.label}-${section.id}-${location.id}-${field.key}`}
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
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
