import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { canAccessAdmin } from "@/app/lib/admin-access";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { ADMIN_VIEW_EQUIPMENT_TRACKING } from "@/app/lib/permission-constants";
import {
  EQUIPMENT_SECTIONS,
  type EquipmentSectionKey,
  parseEquipmentTrackingValues,
  saveEquipmentTrackingWithAudit,
} from "@/app/lib/equipment-tracking";
import { loadMaintenancePrimaryAssignments } from "@/app/lib/preventative-maintenance";

export const dynamic = "force-dynamic";

type EquipmentRow = {
  id: string;
  locationId: string;
  sectionKey: string;
  ngOrLp: string | null;
  iceCream: string | null;
  greaseTrapSize: string | null;
  modelNumber: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  color: string | null;
  freonType: string | null;
  notes: string | null;
  pepsiMachineOrBin: string | null;
  tanklessOrTank: string | null;
  condenserUnitNumber: string | null;
  evaporatorUnitNumber: string | null;
  tonnage: string | null;
  size: string | null;
  freezerType: string | null;
  letterSize: string | null;
  signType: string | null;
  amountOfHeads: string | null;
  cameraCount: string | null;
  lpOrNg: string | null;
};

type Db = {
  equipmentTrackingLog: {
    findMany: (args: unknown) => Promise<EquipmentRow[]>;
  };
};

const db = prisma as unknown as Db;

const VALID_SECTION_KEYS = new Set<string>(EQUIPMENT_SECTIONS.map((s) => s.key));

async function requireAdminAccess(session: unknown) {
  if (!session) redirect("/login");
  const [allowed, perms] = await Promise.all([canAccessAdmin(session), loadUserPermissions(session)]);
  const featureAllowed = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_EQUIPMENT_TRACKING]);
  if (!allowed || !featureAllowed) redirect("/");
}

export default async function AdminEquipmentTrackingPage() {
  const session = await getServerSession(authOptions);
  await requireAdminAccess(session);

  async function saveEquipmentSectionAsAdminAction(formData: FormData) {
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
    const sectionKeyRaw = String(formData.get("sectionKey") ?? "").trim();
    if (!locationId) throw new Error("Location is required.");
    if (!VALID_SECTION_KEYS.has(sectionKeyRaw)) throw new Error("Invalid section.");

    await saveEquipmentTrackingWithAudit({
      locationId,
      sectionKey: sectionKeyRaw as EquipmentSectionKey,
      values: parseEquipmentTrackingValues(formData),
      actorUserId: actor.id,
      source: "ADMIN",
    });

    revalidatePath("/admin/equipment-tracking");
    revalidatePath("/maintenance/equipment-tracking");
  }

  const [locations, assignments, rows] = await Promise.all([
    prisma.location.findMany({
      where: { active: true, NOT: [{ name: "Office" }, { name: "office" }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    loadMaintenancePrimaryAssignments(),
    db.equipmentTrackingLog.findMany({
      where: { sectionKey: { in: EQUIPMENT_SECTIONS.map((s) => s.key) } },
      select: {
        id: true,
        locationId: true,
        sectionKey: true,
        ngOrLp: true,
        iceCream: true,
        greaseTrapSize: true,
        modelNumber: true,
        serialNumber: true,
        manufacturer: true,
        color: true,
        freonType: true,
        notes: true,
        pepsiMachineOrBin: true,
        tanklessOrTank: true,
        condenserUnitNumber: true,
        evaporatorUnitNumber: true,
        tonnage: true,
        size: true,
        freezerType: true,
        letterSize: true,
        signType: true,
        amountOfHeads: true,
        cameraCount: true,
        lpOrNg: true,
      },
    }),
  ]);

  const rowMap = new Map(rows.map((r) => [`${r.locationId}::${r.sectionKey}`, r]));

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

  const btn: CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "8px 10px",
    background: "var(--surface-2)",
    color: "var(--foreground)",
    fontWeight: 900,
    textDecoration: "none",
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
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Admin: Equipment Tracking</h1>
        <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
          Full equipment inventory log by location. Sections and fields are mapped to your master spreadsheet layout.
        </p>
        <div style={{ marginTop: 10 }}>
          <Link href="/admin" style={btn}>
            Back to Admin Hub
          </Link>
        </div>
      </section>

      {groups.map((group) => (
        <section key={group.label} style={card}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>{group.label}</h2>

          <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
            {EQUIPMENT_SECTIONS.map((section) => (
              <div key={`${group.label}-${section.key}`}>
                <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 900 }}>{section.title}</h3>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", minWidth: 180 }}>
                          Store
                        </th>
                        {section.fields.map((field) => (
                          <th
                            key={`${group.label}-${section.key}-head-${field.key}`}
                            style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", minWidth: 160 }}
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
                        const row = rowMap.get(`${location.id}::${section.key}`);
                        const cols = `repeat(${section.fields.length}, minmax(160px, 1fr)) 120px`;
                        return (
                          <tr key={`${group.label}-${section.key}-${location.id}`}>
                            <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)", fontWeight: 800 }}>
                              {location.name}
                            </td>
                            <td colSpan={section.fields.length + 1} style={{ padding: 0, borderBottom: "1px solid var(--border)" }}>
                              <form
                                action={saveEquipmentSectionAsAdminAction}
                                style={{ display: "grid", gridTemplateColumns: cols, gap: 8, padding: 8, alignItems: "center" }}
                              >
                                <input type="hidden" name="locationId" value={location.id} />
                                <input type="hidden" name="sectionKey" value={section.key} />

                                {section.fields.map((field) => (
                                  <input
                                    key={`${group.label}-${section.key}-${location.id}-${field.key}`}
                                    name={field.key}
                                    defaultValue={String(row?.[field.key] ?? "")}
                                    style={input}
                                  />
                                ))}

                                <button type="submit" style={{ ...btn, cursor: "pointer", width: "100%" }}>
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
