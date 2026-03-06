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
  EQUIPMENT_SECTIONS,
  type EquipmentSectionKey,
  getMaintenanceEquipmentLocationsForUser,
  parseEquipmentTrackingValues,
  saveEquipmentTrackingWithAudit,
} from "@/app/lib/equipment-tracking";

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

export default async function MaintenanceEquipmentTrackingPage() {
  const session = await getServerSession(authOptions);
  await requireMaintenanceAreaAccess(session);

  const email = String((session?.user as { email?: string | null } | null)?.email ?? "")
    .trim()
    .toLowerCase();
  if (!email) redirect("/login");

  const me = await prisma.user.findUnique({
    where: { email },
    select: { id: true, active: true },
  });
  if (!me || !me.active) redirect("/login");

  async function saveEquipmentSectionAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    await requireMaintenanceAreaAccess(session);

    const email = String((session?.user as { email?: string | null } | null)?.email ?? "")
      .trim()
      .toLowerCase();
    if (!email) redirect("/login");

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!user || !user.active) redirect("/login");

    const locationId = String(formData.get("locationId") ?? "").trim();
    const sectionKeyRaw = String(formData.get("sectionKey") ?? "").trim();
    if (!locationId) throw new Error("Location is required.");
    if (!VALID_SECTION_KEYS.has(sectionKeyRaw)) throw new Error("Invalid section.");

    const allowedLocations = await getMaintenanceEquipmentLocationsForUser(user.id);
    const allowed = allowedLocations.some((l) => l.id === locationId);
    if (!allowed) throw new Error("You are not assigned to this location.");

    await saveEquipmentTrackingWithAudit({
      locationId,
      sectionKey: sectionKeyRaw as EquipmentSectionKey,
      values: parseEquipmentTrackingValues(formData),
      actorUserId: user.id,
      source: "MAINTENANCE",
    });

    revalidatePath("/maintenance/equipment-tracking");
    revalidatePath("/admin/equipment-tracking");
  }

  const locations = await getMaintenanceEquipmentLocationsForUser(me.id);
  const locationIds = locations.map((l) => l.id);
  const sectionKeys = EQUIPMENT_SECTIONS.map((s) => s.key);

  const rows =
    locationIds.length > 0
      ? await db.equipmentTrackingLog.findMany({
          where: { locationId: { in: locationIds }, sectionKey: { in: sectionKeys } },
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
        })
      : [];

  const rowMap = new Map(rows.map((r) => [`${r.locationId}::${r.sectionKey}`, r]));

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
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Equipment Tracking</h1>
        <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
          Track major equipment details by location. Layout and fields follow your current equipment sheet style.
        </p>
        <div style={{ marginTop: 10 }}>
          <Link href="/maintenance" style={btn}>
            Back to Maintenance Hub
          </Link>
        </div>
      </section>

      {locations.length === 0 ? (
        <section style={card}>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            No primary location assignments found for your maintenance user.
          </p>
        </section>
      ) : (
        EQUIPMENT_SECTIONS.map((section) => (
          <section key={section.key} style={card}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>{section.title}</h2>
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", minWidth: 180 }}>
                      Store
                    </th>
                    {section.fields.map((field) => (
                      <th
                        key={`${section.key}-head-${field.key}`}
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
                  {locations.map((location) => {
                    const row = rowMap.get(`${location.id}::${section.key}`);
                    const cols = `repeat(${section.fields.length}, minmax(160px, 1fr)) 120px`;
                    return (
                      <tr key={`${section.key}-${location.id}`}>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)", fontWeight: 800 }}>{location.name}</td>
                        <td colSpan={section.fields.length + 1} style={{ padding: 0, borderBottom: "1px solid var(--border)" }}>
                          <form
                            action={saveEquipmentSectionAction}
                            style={{ display: "grid", gridTemplateColumns: cols, gap: 8, padding: 8, alignItems: "center" }}
                          >
                            <input type="hidden" name="locationId" value={location.id} />
                            <input type="hidden" name="sectionKey" value={section.key} />

                            {section.fields.map((field) => (
                              <input
                                key={`${section.key}-${location.id}-${field.key}`}
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
          </section>
        ))
      )}
    </main>
  );
}
