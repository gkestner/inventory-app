import { getServerSession } from "next-auth";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import {
  ADMIN_VIEW_COMPANY_VEHICLES,
  ADMIN_VIEW_EQUIPMENT_TRACKING,
  ADMIN_VIEW_MAINTENANCE_REQUESTS,
  ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
  ADMIN_VIEW_TEMPERATURE_DASHBOARD,
  VIEW_COMPANY_VEHICLE_LOG,
  VIEW_EQUIPMENT_TRACKING,
  VIEW_MAINTENANCE_REQUESTS,
  VIEW_PREVENTATIVE_MAINTENANCE,
  VIEW_TEMPERATURE_DASHBOARD,
} from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

const FEATURE_PERMS: Array<{ label: string; perm: Permission }> = [
  { label: "View PM", perm: VIEW_PREVENTATIVE_MAINTENANCE },
  { label: "View Equipment", perm: VIEW_EQUIPMENT_TRACKING },
  { label: "View Vehicle Log", perm: VIEW_COMPANY_VEHICLE_LOG },
  { label: "View Requests", perm: VIEW_MAINTENANCE_REQUESTS },
  { label: "View Temperature", perm: VIEW_TEMPERATURE_DASHBOARD },
  { label: "Admin PM", perm: ADMIN_VIEW_PREVENTATIVE_MAINTENANCE },
  { label: "Admin Equipment", perm: ADMIN_VIEW_EQUIPMENT_TRACKING },
  { label: "Admin Fleet", perm: ADMIN_VIEW_COMPANY_VEHICLES },
  { label: "Admin Requests", perm: ADMIN_VIEW_MAINTENANCE_REQUESTS },
  { label: "Admin Temperature", perm: ADMIN_VIEW_TEMPERATURE_DASHBOARD },
];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.ADMIN_VIEW_USERS, Permission.ADMIN_EDIT_USERS])) {
    return new Response("Forbidden", { status: 403 });
  }

  const users = await prisma.user.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      permissions: { select: { permission: true } },
      permissionTitles: {
        select: {
          title: {
            select: {
              name: true,
              permissions: { select: { permission: true } },
            },
          },
        },
      },
      roles: {
        select: {
          role: {
            select: {
              name: true,
              permissions: { select: { permission: true } },
              titles: {
                select: {
                  title: {
                    select: {
                      permissions: { select: { permission: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const header = [
    "userId",
    "name",
    "email",
    "role",
    "directCount",
    "titleCount",
    "roleDirectCount",
    "roleTitleCount",
    "effectiveCount",
    "titles",
    "dynamicRoles",
    ...FEATURE_PERMS.map((f) => f.label),
  ];

  const lines: string[] = [header.join(",")];

  for (const u of users) {
    const direct = new Set<Permission>(u.permissions.map((p) => p.permission));
    const title = new Set<Permission>();
    const roleDirect = new Set<Permission>();
    const roleTitle = new Set<Permission>();

    for (const ut of u.permissionTitles) {
      for (const tp of ut.title.permissions) title.add(tp.permission);
    }

    for (const ur of u.roles) {
      for (const rp of ur.role.permissions) roleDirect.add(rp.permission);
      for (const rt of ur.role.titles) {
        for (const tp of rt.title.permissions) roleTitle.add(tp.permission);
      }
    }

    const effective = new Set<Permission>([...direct, ...title, ...roleDirect, ...roleTitle]);

    lines.push(
      [
        u.id,
        u.name,
        u.email,
        u.role,
        direct.size,
        title.size,
        roleDirect.size,
        roleTitle.size,
        effective.size,
        u.permissionTitles.map((t) => t.title.name).sort().join(" | "),
        u.roles.map((r) => r.role.name).sort().join(" | "),
        ...FEATURE_PERMS.map((f) => (effective.has(f.perm) ? "Y" : "N")),
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  const csv = lines.join("\n");
  const filename = `permission-coverage_${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${filename}\"`,
      "Cache-Control": "no-store",
    },
  });
}
