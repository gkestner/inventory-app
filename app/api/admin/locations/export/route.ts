// app/api/admin/locations/export/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

function csvEscape(v: string): string {
  // RFC-ish: wrap in quotes if it contains comma/quote/newline; double quotes inside
  const needs = /[",\n\r]/.test(v);
  const s = v.replace(/"/g, '""');
  return needs ? `"${s}"` : s;
}

function isoOrEmpty(d: Date | null | undefined): string {
  return d ? d.toISOString() : "";
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const perms = await loadUserPermissions(session);
  const canViewLocations = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_LOCATIONS]);
  if (!canViewLocations) return null;

  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.location.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      locationNumber: true,
      corporationNumber: true,
      active: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const header = ["id", "name", "locationNumber", "corporationNumber", "active", "createdAt", "updatedAt"];

  const lines: string[] = [];
  lines.push(header.join(","));

  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.id),
        csvEscape(r.name),
        csvEscape(r.locationNumber ?? ""),
        csvEscape(r.corporationNumber ?? ""),
        r.active ? "true" : "false",
        csvEscape(isoOrEmpty(r.createdAt)),
        csvEscape(isoOrEmpty(r.updatedAt)),
      ].join(",")
    );
  }

  const csv = lines.join("\n");

  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const filename = `locations-${y}${m}${d}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
