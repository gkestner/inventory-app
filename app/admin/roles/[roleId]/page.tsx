import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import RolePermissionTreeClient from "./RolePermissionTreeClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: { role?: unknown } | null;
} | null;

type PageProps = {
  params: Promise<{ roleId: string }>;
  searchParams?: Promise<{ ok?: string; error?: string }>;
};

async function requireAdmin() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");
  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.ADMIN_EDIT_USERS])) redirect("/");
}

function isPermission(value: string): value is Permission {
  return (Object.values(Permission) as string[]).includes(value);
}

async function saveRoleGrantsAction(formData: FormData) {
  "use server";
  await requireAdmin();

  const roleId = String(formData.get("roleId") ?? "").trim();
  if (!roleId) redirect("/admin/roles?error=" + encodeURIComponent("Missing role id"));

  const permissions = Array.from(new Set(formData.getAll("permissions").map((value) => String(value)))).filter(isPermission);
  const titleIds = Array.from(new Set(formData.getAll("titleIds").map((value) => String(value).trim()))).filter(Boolean);

  await prisma.$transaction(async (tx) => {
    const role = await tx.appRole.findUnique({ where: { id: roleId }, select: { id: true } });
    if (!role) throw new Error("Role not found");

    await tx.appRolePermission.deleteMany({ where: { roleId } });
    await tx.appRolePermissionTitle.deleteMany({ where: { roleId } });

    if (permissions.length) {
      await tx.appRolePermission.createMany({
        data: permissions.map((permission) => ({ roleId, permission })),
        skipDuplicates: true,
      });
    }

    if (titleIds.length) {
      await tx.appRolePermissionTitle.createMany({
        data: titleIds.map((titleId) => ({ roleId, titleId })),
        skipDuplicates: true,
      });
    }
  });

  revalidatePath(`/admin/roles/${roleId}`);
  revalidatePath("/admin/roles");
  revalidatePath("/admin/users");
  redirect(`/admin/roles/${encodeURIComponent(roleId)}?ok=1`);
}

export default async function AdminRoleDetailPage({ params, searchParams }: PageProps) {
  await requireAdmin();

  const [{ roleId }, sp] = await Promise.all([params, searchParams ?? Promise.resolve({} as { ok?: string; error?: string })]);
  const id = String(roleId ?? "").trim();
  if (!id) redirect("/admin/roles?error=" + encodeURIComponent("Missing role id"));

  const [role, permissionRows, activeTitles, roleTitleRows] = await Promise.all([
    prisma.appRole.findUnique({
      where: { id },
      select: { id: true, name: true, description: true, isSystem: true, updatedAt: true, _count: { select: { users: true } } },
    }),
    prisma.appRolePermission.findMany({ where: { roleId: id }, select: { permission: true } }),
    prisma.permissionTitle.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true },
    }),
    prisma.appRolePermissionTitle.findMany({ where: { roleId: id }, select: { titleId: true } }),
  ]);

  if (!role) redirect("/admin/roles?error=" + encodeURIComponent("Role not found"));

  const border = "1px solid rgba(128,128,128,0.25)";
  const card: CSSProperties = { border, borderRadius: 14, background: "var(--background)", padding: 14 };

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", color: "var(--foreground)", display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>{role.name}</h1>
            <div style={{ opacity: 0.8, marginTop: 6 }}>
              {role.description ?? "No description"} · {role._count.users} user{role._count.users === 1 ? "" : "s"}
              {role.isSystem ? " · System role" : ""}
            </div>
          </div>

          <Link
            href="/admin/roles"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border,
              color: "var(--foreground)",
              textDecoration: "none",
              fontWeight: 900,
            }}
          >
            Back to Roles
          </Link>
        </div>

        {sp.ok === "1" ? <div style={{ ...card, border: "1px solid rgba(34,197,94,0.45)" }}>Saved role grants.</div> : null}
        {sp.error ? <div style={{ ...card, border: "1px solid rgba(239,68,68,0.45)" }}>{sp.error}</div> : null}

        <div style={card}>
          <RolePermissionTreeClient
            roleId={role.id}
            allPermissions={Object.values(Permission)}
            initialSelectedPermissions={permissionRows.map((row) => row.permission)}
            titles={activeTitles}
            initialSelectedTitleIds={roleTitleRows.map((row) => row.titleId)}
            saveAction={saveRoleGrantsAction}
          />
        </div>
      </div>
    </main>
  );
}
