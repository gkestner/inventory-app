import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { ADMIN_VIEW_EQUIPMENT_TRACKING } from "@/app/lib/permission-constants";
import { EQUIPMENT_SECTIONS, EQUIPMENT_TRACKING_FIELD_KEYS } from "@/app/lib/equipment-tracking";

export const dynamic = "force-dynamic";

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function requireExportAccess() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const perms = await loadUserPermissions(session);
  const canExport = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_EQUIPMENT_TRACKING]);
  if (!canExport) return null;

  return session;
}

export async function GET() {
  const session = await requireExportAccess();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sectionTitleByKey = new Map<string, string>(EQUIPMENT_SECTIONS.map((s) => [s.key, s.title]));

  const rows = await prisma.equipmentTrackingLog.findMany({
    orderBy: [{ location: { name: "asc" } }, { sectionKey: "asc" }],
    select: {
      locationId: true,
      sectionKey: true,
      location: { select: { name: true } },
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
      createdAt: true,
      updatedAt: true,
    },
  });

  const header = [
    "locationId",
    "locationName",
    "sectionKey",
    "sectionTitle",
    ...EQUIPMENT_TRACKING_FIELD_KEYS,
    "createdAt",
    "updatedAt",
  ];

  const lines: string[] = [];
  lines.push(header.map(csvEscape).join(","));

  for (const r of rows) {
    const values = [
      r.locationId,
      r.location.name,
      r.sectionKey,
      sectionTitleByKey.get(r.sectionKey) ?? "",
      ...EQUIPMENT_TRACKING_FIELD_KEYS.map((k) => r[k] ?? ""),
      r.createdAt.toISOString(),
      r.updatedAt.toISOString(),
    ];

    lines.push(values.map(csvEscape).join(","));
  }

  const csv = lines.join("\r\n");
  const filename = `equipment-tracking-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
