import { getServerSession } from "next-auth";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import {
  ADMIN_VIEW_REPORT_FLEET_TCO,
  ADMIN_VIEW_REPORT_NOTIFICATION_EFFECTIVENESS,
  ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS,
  ADMIN_VIEW_REPORT_PERMISSION_COVERAGE,
  ADMIN_VIEW_REPORT_PM_COMPLIANCE,
  ADMIN_VIEW_REPORT_SLA_BREACHES,
  ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD,
  ADMIN_VIEW_REPORT_TEMPERATURE_INCIDENTS,
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
  { label: "Report: SLA Breaches", perm: ADMIN_VIEW_REPORT_SLA_BREACHES },
  { label: "Report: Technician Workload", perm: ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD },
  { label: "Report: Temperature Incidents", perm: ADMIN_VIEW_REPORT_TEMPERATURE_INCIDENTS },
  { label: "Report: PM Compliance", perm: ADMIN_VIEW_REPORT_PM_COMPLIANCE },
  { label: "Report: Parts Consumption", perm: ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS },
  { label: "Report: Fleet TCO", perm: ADMIN_VIEW_REPORT_FLEET_TCO },
  { label: "Report: Permission Coverage", perm: ADMIN_VIEW_REPORT_PERMISSION_COVERAGE },
  { label: "Report: Notification Effectiveness", perm: ADMIN_VIEW_REPORT_NOTIFICATION_EFFECTIVENESS },
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
  if (!perms.allowAll && !hasAnyPermission(perms, [ADMIN_VIEW_REPORT_PERMISSION_COVERAGE])) {
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
