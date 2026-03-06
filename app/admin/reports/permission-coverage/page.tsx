import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
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

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

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

async function requireReportAccess() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.ADMIN_VIEW_USERS, Permission.ADMIN_EDIT_USERS])) {
    redirect("/");
  }
}

export default async function PermissionCoverageReportPage() {
  await requireReportAccess();

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

  const rows = users.map((u) => {
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

    const featureStatus = FEATURE_PERMS.map((f) => ({ label: f.label, has: effective.has(f.perm) }));

    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      directCount: direct.size,
      titleCount: title.size,
      roleDirectCount: roleDirect.size,
      roleTitleCount: roleTitle.size,
      effectiveCount: effective.size,
      titles: u.permissionTitles.map((t) => t.title.name).sort(),
      dynamicRoles: u.roles.map((r) => r.role.name).sort(),
      featureStatus,
    };
  });

  const border = "1px solid var(--border)";

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", display: "grid", gap: 12 }}>
        <section style={{ border, borderRadius: 14, background: "var(--surface)", padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Permission Coverage</h1>
            <Link href="/admin/reports" style={{ textDecoration: "none", fontWeight: 800 }}>
              Back to Reports
            </Link>
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
            Effective permissions by source: direct grants, titles, dynamic role grants, and role-linked titles.
          </p>
        </section>

        <section style={{ border, borderRadius: 14, background: "var(--surface)", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["User", "Role", "Direct", "Title", "Role", "Role+Title", "Effective", "Titles", "Dynamic Roles", "Feature Coverage"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: border }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: 10, borderBottom: border }}>
                    <div style={{ fontWeight: 800 }}>{r.name}</div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>{r.email}</div>
                  </td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.role}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.directCount}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.titleCount}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.roleDirectCount}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.roleTitleCount}</td>
                  <td style={{ padding: 10, borderBottom: border, fontWeight: 900 }}>{r.effectiveCount}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.titles.join(", ") || "-"}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{r.dynamicRoles.join(", ") || "-"}</td>
                  <td style={{ padding: 10, borderBottom: border }}>
                    {r.featureStatus
                      .filter((f) => f.has)
                      .map((f) => f.label)
                      .join(", ") || "-"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: 12, color: "var(--muted)" }}>
                    No active users found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
