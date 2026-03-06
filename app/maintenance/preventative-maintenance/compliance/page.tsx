import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { ADMIN_VIEW_PREVENTATIVE_MAINTENANCE, VIEW_PREVENTATIVE_MAINTENANCE } from "@/app/lib/permission-constants";
import { loadMaintenancePrimaryAssignments, normalizePmYear } from "@/app/lib/preventative-maintenance";

export const dynamic = "force-dynamic";

type SearchParams = {
  year?: string | string[];
};

type PmEntry = {
  locationId: string;
  greaseTrapDatePumped: string | null;
  greaseTrapCompany: string | null;
  backflowDateChecked: string | null;
  backflowCompany: string | null;
  boilerInspectionDatePrimary: string | null;
  boilerInspectionDateSecondary: string | null;
  boilerInspectionCompany: string | null;
};

type PmDb = {
  preventativeMaintenanceEntry: {
    findMany: (args: unknown) => Promise<PmEntry[]>;
  };
};

const pmDb = prisma as unknown as PmDb;

function valueOrDash(v: string | null | undefined) {
  const s = String(v ?? "").trim();
  return s || "-";
}

export default async function MaintenancePreventativeMaintenanceCompliancePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const year = normalizePmYear(resolvedSearchParams.year);

  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  const canViewMaintenancePm = perms.allowAll || hasAnyPermission(perms, [VIEW_PREVENTATIVE_MAINTENANCE]);
  if (!canViewMaintenancePm) redirect("/");

  // If user has PM admin permission, show the full admin compliance dashboard.
  const canManagePmCompliance = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_PREVENTATIVE_MAINTENANCE]);
  if (canManagePmCompliance) {
    redirect(`/admin/preventative-maintenance/compliance?year=${year}`);
  }

  const email = String((session?.user as { email?: string | null } | null)?.email ?? "")
    .trim()
    .toLowerCase();
  if (!email) redirect("/login");

  const me = await prisma.user.findUnique({
    where: { email },
    select: { id: true, active: true },
  });
  if (!me || !me.active) redirect("/login");

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
            greaseTrapDatePumped: true,
            greaseTrapCompany: true,
            backflowDateChecked: true,
            backflowCompany: true,
            boilerInspectionDatePrimary: true,
            boilerInspectionDateSecondary: true,
            boilerInspectionCompany: true,
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
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Compliance & Testing</h1>
        <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
          Read-only view for Backflow, Grease Trap, and Boiler servicing by location.
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
            <button type="submit" style={{ ...btn, cursor: "pointer" }}>
              Load
            </button>
          </form>
          <Link href={`/maintenance/preventative-maintenance?year=${year}`} style={btn}>
            Back to PM Checklist
          </Link>
        </div>
      </section>

      {locations.length === 0 ? (
        <section style={card}>
          <p style={{ margin: 0, color: "var(--muted)" }}>No primary PM assignments found for your user.</p>
        </section>
      ) : (
        <section style={card}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Service Dates & Companies</h2>
          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", minWidth: 180 }}>
                    Location
                  </th>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", minWidth: 170 }}>
                    Grease Trap Date Serviced
                  </th>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", minWidth: 170 }}>
                    Grease Trap Company
                  </th>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", minWidth: 170 }}>
                    Backflow Date Serviced
                  </th>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", minWidth: 170 }}>
                    Backflow Company
                  </th>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", minWidth: 170 }}>
                    Boiler Date Serviced
                  </th>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", minWidth: 170 }}>
                    Boiler Date Serviced (2)
                  </th>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", minWidth: 170 }}>
                    Boiler Company
                  </th>
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => {
                  const row = entryByLocation.get(location.id);
                  return (
                    <tr key={location.id}>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)", fontWeight: 800 }}>{location.name}</td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{valueOrDash(row?.greaseTrapDatePumped)}</td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{valueOrDash(row?.greaseTrapCompany)}</td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{valueOrDash(row?.backflowDateChecked)}</td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{valueOrDash(row?.backflowCompany)}</td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{valueOrDash(row?.boilerInspectionDatePrimary)}</td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{valueOrDash(row?.boilerInspectionDateSecondary)}</td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>{valueOrDash(row?.boilerInspectionCompany)}</td>
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
