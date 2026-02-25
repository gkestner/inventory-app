// app/admin/roles/page.tsx
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { loadUserPermissions, hasAnyPermission } from "@/app/lib/permissions";
import { Permission } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SearchParams = {
  ok?: string;
  error?: string;
};

function norm(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function safeErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : "Unknown error";
  // Unique constraint errors often include "Unique constraint failed"
  if (msg.toLowerCase().includes("unique constraint")) return "Role name already exists.";
  if (msg.toLowerCase().includes("unique") && msg.toLowerCase().includes("name")) return "Role name already exists.";
  return msg;
}

async function requireRolesAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  const ok = hasAnyPermission(perms, [Permission.ADMIN_EDIT_USERS]);

  if (!ok) redirect("/");

  return { session, perms };
}

async function createRoleAction(formData: FormData) {
  "use server";

  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  const ok = hasAnyPermission(perms, [Permission.ADMIN_EDIT_USERS]);
  if (!ok) redirect("/");

  const nameRaw = String(formData.get("name") ?? "");
  const descriptionRaw = String(formData.get("description") ?? "");

  const name = norm(nameRaw);
  const description = norm(descriptionRaw);

  if (!name) redirect("/admin/roles?error=" + encodeURIComponent("Role name is required."));
  if (name.length > 80) redirect("/admin/roles?error=" + encodeURIComponent("Role name is too long (max 80)."));
  if (description.length > 300)
    redirect("/admin/roles?error=" + encodeURIComponent("Description is too long (max 300)."));

  try {
    await prisma.appRole.create({
      data: {
        name,
        description: description ? description : null,
        isSystem: false,
      },
      select: { id: true },
    });

    revalidatePath("/admin/roles");
    redirect("/admin/roles?ok=" + encodeURIComponent("Role created."));
  } catch (e) {
    redirect("/admin/roles?error=" + encodeURIComponent(safeErrorMessage(e)));
  }
}

async function deleteRoleAction(formData: FormData) {
  "use server";

  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  const ok = hasAnyPermission(perms, [Permission.ADMIN_EDIT_USERS]);
  if (!ok) redirect("/");

  const roleId = String(formData.get("roleId") ?? "").trim();
  if (!roleId) redirect("/admin/roles?error=" + encodeURIComponent("Missing roleId."));

  try {
    const role = await prisma.appRole.findUnique({
      where: { id: roleId },
      select: { id: true, isSystem: true, name: true },
    });

    if (!role) redirect("/admin/roles?error=" + encodeURIComponent("Role not found."));
    if (role.isSystem) {
      redirect("/admin/roles?error=" + encodeURIComponent("System roles cannot be deleted."));
    }

    await prisma.appRole.delete({ where: { id: roleId } });

    revalidatePath("/admin/roles");
    redirect("/admin/roles?ok=" + encodeURIComponent("Role deleted."));
  } catch (e) {
    redirect("/admin/roles?error=" + encodeURIComponent(safeErrorMessage(e)));
  }
}

export default async function AdminRolesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requireRolesAdmin();
  const sp = (await searchParams) ?? {};
  const okMsg = typeof sp.ok === "string" ? sp.ok : "";
  const errMsg = typeof sp.error === "string" ? sp.error : "";

  const roles = await prisma.appRole.findMany({
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    include: {
      _count: { select: { users: true } },
    },
  });

  const page: CSSProperties = {
    padding: 16,
    color: "var(--text)",
    background: "var(--background)",
  };

  const card: CSSProperties = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 14,
  };

  const h1: CSSProperties = { margin: "0 0 12px 0", fontSize: 20, fontWeight: 800 };

  const row: CSSProperties = { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" };

  const input: CSSProperties = {
    padding: "9px 10px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--background)",
    color: "var(--text)",
    width: 320,
    maxWidth: "100%",
  };

  const textarea: CSSProperties = {
    padding: "9px 10px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--background)",
    color: "var(--text)",
    width: 520,
    maxWidth: "100%",
    minHeight: 64,
    resize: "vertical",
  };

  const btn: CSSProperties = {
    padding: "9px 12px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
    fontWeight: 700,
    cursor: "pointer",
  };

  const dangerBtn: CSSProperties = {
    ...btn,
    border: "1px solid rgba(255,0,0,.35)",
  };

  const table: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    marginTop: 10,
  };

  const th: CSSProperties = {
    textAlign: "left",
    fontSize: 12,
    color: "var(--mutedText)",
    borderBottom: "1px solid var(--border)",
    padding: "10px 8px",
    whiteSpace: "nowrap",
  };

  const td: CSSProperties = {
    borderBottom: "1px solid var(--border)",
    padding: "10px 8px",
    verticalAlign: "top",
    fontSize: 13,
  };

  const pill: CSSProperties = {
    display: "inline-block",
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid var(--border)",
    background: "var(--background)",
    color: "var(--mutedText)",
    marginLeft: 8,
  };

  const flashOk: CSSProperties = {
    margin: "0 0 12px 0",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0, 180, 90, .35)",
    background: "rgba(0, 180, 90, .08)",
    color: "var(--text)",
  };

  const flashErr: CSSProperties = {
    margin: "0 0 12px 0",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255, 0, 0, .35)",
    background: "rgba(255, 0, 0, .08)",
    color: "var(--text)",
  };

  return (
    <div style={page}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <h1 style={h1}>Roles</h1>
          <div style={{ fontSize: 13, color: "var(--mutedText)" }}>
            Create and manage dynamic roles. Next: edit role permissions &amp; title grants.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/admin/users" style={{ ...btn, textDecoration: "none", display: "inline-block" }}>
            Back to Users
          </Link>
        </div>
      </div>

      {okMsg ? <div style={flashOk}>{okMsg}</div> : null}
      {errMsg ? <div style={flashErr}>{errMsg}</div> : null}

      <div style={{ ...card, marginTop: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>Create role</div>

        <form action={createRoleAction} style={{ display: "grid", gap: 10 }}>
          <div style={row}>
            <label style={{ fontSize: 13, fontWeight: 700, width: 120 }}>Name</label>
            <input name="name" placeholder="e.g., Inventory Clerk" style={input} />
          </div>

          <div style={row}>
            <label style={{ fontSize: 13, fontWeight: 700, width: 120 }}>Description</label>
            <textarea name="description" placeholder="Optional" style={textarea} />
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" style={btn}>
              Create role
            </button>
            <div style={{ fontSize: 12, color: "var(--mutedText)" }}>
              Role permissions &amp; titles are edited on the role detail page (next step).
            </div>
          </div>
        </form>
      </div>

      <div style={{ ...card, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <div style={{ fontWeight: 800 }}>All roles</div>
          <div style={{ fontSize: 12, color: "var(--mutedText)" }}>{roles.length} total</div>
        </div>

        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Role</th>
              <th style={th}>Users</th>
              <th style={th}>Updated</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => {
              const updated = new Date(r.updatedAt).toLocaleString("en-US", {
                year: "numeric",
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <tr key={r.id}>
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Link
                        href={`/admin/roles/${r.id}`}
                        style={{ color: "var(--text)", fontWeight: 800, textDecoration: "none" }}
                      >
                        {r.name}
                      </Link>
                      {r.isSystem ? <span style={pill}>System</span> : null}
                    </div>
                    {r.description ? (
                      <div style={{ marginTop: 4, fontSize: 12, color: "var(--mutedText)" }}>{r.description}</div>
                    ) : (
                      <div style={{ marginTop: 4, fontSize: 12, color: "var(--mutedText)" }}>—</div>
                    )}
                  </td>

                  <td style={td}>{r._count.users}</td>
                  <td style={td}>{updated}</td>

                  <td style={td}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <Link
                        href={`/admin/roles/${r.id}`}
                        style={{ ...btn, textDecoration: "none", display: "inline-block" }}
                      >
                        Edit
                      </Link>

                      <form action={deleteRoleAction}>
                        <input type="hidden" name="roleId" value={r.id} />
                        <button
                          type="submit"
                          style={dangerBtn}
                          disabled={r.isSystem}
                          title={r.isSystem ? "System roles cannot be deleted" : "Delete role"}
                        >
                          Delete
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}

            {roles.length === 0 ? (
              <tr>
                <td style={td} colSpan={4}>
                  <div style={{ color: "var(--mutedText)" }}>No roles yet.</div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <div style={{ marginTop: 10, fontSize: 12, color: "var(--mutedText)" }}>
          Tip: Keep “system” roles (seeded) locked; create business roles here.
        </div>
      </div>
    </div>
  );
}