import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { canAccessAdmin } from "@/app/lib/admin-access";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { ADMIN_VIEW_PREVENTATIVE_MAINTENANCE } from "@/app/lib/permission-constants";
import {
  normalizePmYear,
  savePreventativeMaintenanceEntryWithAudit,
  type PreventativeMaintenanceValues,
} from "@/app/lib/preventative-maintenance";

type SearchParams = {
  year?: string | string[];
};

type NumberedLocation = {
  id: string;
  name: string;
  locationNumber: string | null;
};

export const dynamic = "force-dynamic";

function toTrimmed(v: FormDataEntryValue | null) {
  return String(v ?? "").trim();
}

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

async function requireAdminAccess(session: unknown) {
  if (!session) redirect("/login");

  const [allowed, perms] = await Promise.all([canAccessAdmin(session), loadUserPermissions(session)]);
  const featureAllowed = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_PREVENTATIVE_MAINTENANCE]);

  if (!allowed || !featureAllowed) redirect("/");
}

function getComplianceValues(formData: FormData, locationId: string): Partial<PreventativeMaintenanceValues> {
  return {
    greaseTrapGallons: toTrimmed(formData.get(`greaseTrapGallons:${locationId}`)),
    greaseTrapTankSize: toTrimmed(formData.get(`greaseTrapTankSize:${locationId}`)),
    greaseTrapDatePumped: toTrimmed(formData.get(`greaseTrapDatePumped:${locationId}`)),
    greaseTrapCompany: toTrimmed(formData.get(`greaseTrapCompany:${locationId}`)),
    greaseTrapCost: toTrimmed(formData.get(`greaseTrapCost:${locationId}`)),
    backflowDateChecked: toTrimmed(formData.get(`backflowDateChecked:${locationId}`)),
    backflowCompany: toTrimmed(formData.get(`backflowCompany:${locationId}`)),
    backflowAmount: toTrimmed(formData.get(`backflowAmount:${locationId}`)),
    boilerInspectionDatePrimary: toTrimmed(formData.get(`boilerInspectionDatePrimary:${locationId}`)),
    boilerInspectionCost: toTrimmed(formData.get(`boilerInspectionCost:${locationId}`)),
    boilerInspectionCompany: toTrimmed(formData.get(`boilerInspectionCompany:${locationId}`)),
  };
}

export default async function AdminPreventativeMaintenanceCompliancePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const session = await getServerSession(authOptions);
  await requireAdminAccess(session);

  const resolvedSearchParams = (await searchParams) ?? {};
  const year = normalizePmYear(resolvedSearchParams.year);

  const actorEmail = String((session?.user as { email?: string | null } | null)?.email ?? "")
    .trim()
    .toLowerCase();
  if (!actorEmail) redirect("/login");

  const actor = await prisma.user.findUnique({
    where: { email: actorEmail },
    select: { id: true, active: true },
  });
  if (!actor || !actor.active) redirect("/login");

  const rawLocations = await prisma.location.findMany({
    where: { active: true },
    select: { id: true, name: true, locationNumber: true },
  });
  const locations = rawLocations.sort(sortLocationsByNumberThenName);

  const entries = await prisma.preventativeMaintenanceEntry.findMany({
    where: { year },
    select: {
      locationId: true,
      greaseTrapGallons: true,
      greaseTrapTankSize: true,
      greaseTrapDatePumped: true,
      greaseTrapCompany: true,
      greaseTrapCost: true,
      backflowDateChecked: true,
      backflowCompany: true,
      backflowAmount: true,
      boilerInspectionDatePrimary: true,
      boilerInspectionCost: true,
      boilerInspectionCompany: true,
    },
  });

  const entryByLocation = new Map(entries.map((e) => [e.locationId, e]));

  async function saveCompliance(formData: FormData) {
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

    const nextYear = normalizePmYear(String(formData.get("year") ?? ""));

    const allLocations = await prisma.location.findMany({
      where: { active: true },
      select: { id: true },
    });

    for (const location of allLocations) {
      await savePreventativeMaintenanceEntryWithAudit({
        locationId: location.id,
        year: nextYear,
        actorUserId: actor.id,
        source: "ADMIN",
        values: getComplianceValues(formData, location.id),
      });
    }

    redirect(`/admin/preventative-maintenance/compliance?year=${nextYear}`);
  }

  const card: CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 14,
    background: "var(--surface)",
    boxShadow: "var(--shadow)",
    padding: 14,
  };

  const btn: CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "8px 10px",
    background: "var(--surface-2)",
    color: "var(--foreground)",
    fontWeight: 900,
    textDecoration: "none",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    cursor: "pointer",
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    minWidth: 110,
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "7px 8px",
    background: "var(--surface)",
    color: "var(--foreground)",
  };

  const sectionHeaderStyle: CSSProperties = {
    margin: "0 0 8px",
    fontSize: 18,
    fontWeight: 950,
    letterSpacing: "0.02em",
    padding: "7px 11px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "linear-gradient(90deg, color-mix(in srgb, var(--brand) 24%, var(--surface-2)) 0%, var(--surface-2) 100%)",
    display: "inline-block",
  };

  const tableHeaderStyle: CSSProperties = {
    textAlign: "left",
    padding: "8px 6px",
    borderBottom: "1px solid var(--border)",
    fontWeight: 950,
    background: "color-mix(in srgb, var(--brand) 18%, var(--surface-2))",
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
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Compliance & Testing Dashboard</h1>
        <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
          Full-entry dashboard for Backflow, Grease Trap, and Boiler compliance fields.
        </p>
        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 14, fontWeight: 800 }}>
              Year
              <input
                name="year"
                type="number"
                defaultValue={year}
                min={2020}
                max={2100}
                style={{ width: 130, marginLeft: 8, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
              />
            </label>
            <button type="submit" style={btn}>
              Load
            </button>
          </form>
          <Link href={`/admin/preventative-maintenance?year=${year}`} style={btn}>
            Back to PM Checklist
          </Link>
        </div>
      </section>

      <form action={saveCompliance} style={card}>
        <input type="hidden" name="year" value={year} />
        <section>
          <h2 style={sectionHeaderStyle}>Grease Trap</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...tableHeaderStyle, minWidth: 170 }}>Location</th>
                  <th style={{ ...tableHeaderStyle, minWidth: 140 }}>Pumped Date</th>
                  <th style={{ ...tableHeaderStyle, minWidth: 170 }}>Company Who Pumped</th>
                  <th style={{ ...tableHeaderStyle, minWidth: 140 }}>Grease Trap Size</th>
                  <th style={{ ...tableHeaderStyle, minWidth: 120 }}>Cost to Pump</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => {
                  const row = entryByLocation.get(location.id);
                  return (
                    <tr key={`grease-${location.id}`}>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)", fontWeight: 800 }}>{formatLocationLabel(location)}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}><input name={`greaseTrapDatePumped:${location.id}`} defaultValue={row?.greaseTrapDatePumped ?? ""} style={inputStyle} /></td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}><input name={`greaseTrapCompany:${location.id}`} defaultValue={row?.greaseTrapCompany ?? ""} style={inputStyle} /></td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}><input name={`greaseTrapTankSize:${location.id}`} defaultValue={row?.greaseTrapTankSize ?? ""} style={inputStyle} /></td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}><input name={`greaseTrapCost:${location.id}`} defaultValue={row?.greaseTrapCost ?? ""} style={inputStyle} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 style={sectionHeaderStyle}>Backflow Test</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...tableHeaderStyle, minWidth: 170 }}>Location</th>
                  <th style={{ ...tableHeaderStyle, minWidth: 140 }}>Date Inspected</th>
                  <th style={{ ...tableHeaderStyle, minWidth: 120 }}>Cost</th>
                  <th style={{ ...tableHeaderStyle, minWidth: 170 }}>Company</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => {
                  const row = entryByLocation.get(location.id);
                  return (
                    <tr key={`backflow-${location.id}`}>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)", fontWeight: 800 }}>{formatLocationLabel(location)}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}><input name={`backflowDateChecked:${location.id}`} defaultValue={row?.backflowDateChecked ?? ""} style={inputStyle} /></td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}><input name={`backflowAmount:${location.id}`} defaultValue={row?.backflowAmount ?? ""} style={inputStyle} /></td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}><input name={`backflowCompany:${location.id}`} defaultValue={row?.backflowCompany ?? ""} style={inputStyle} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 style={sectionHeaderStyle}>Boiler Inspection</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...tableHeaderStyle, minWidth: 170 }}>Location</th>
                  <th style={{ ...tableHeaderStyle, minWidth: 140 }}>Date Inspected</th>
                  <th style={{ ...tableHeaderStyle, minWidth: 120 }}>Cost</th>
                  <th style={{ ...tableHeaderStyle, minWidth: 170 }}>Company</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => {
                  const row = entryByLocation.get(location.id);
                  return (
                    <tr key={`boiler-${location.id}`}>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)", fontWeight: 800 }}>{formatLocationLabel(location)}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}><input name={`boilerInspectionDatePrimary:${location.id}`} defaultValue={row?.boilerInspectionDatePrimary ?? ""} style={inputStyle} /></td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}><input name={`boilerInspectionCost:${location.id}`} defaultValue={row?.boilerInspectionCost ?? ""} style={inputStyle} /></td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}><input name={`boilerInspectionCompany:${location.id}`} defaultValue={row?.boilerInspectionCompany ?? ""} style={inputStyle} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button type="submit" style={btn}>
            Save Compliance Dashboard
          </button>
        </div>
      </form>
    </main>
  );
}
