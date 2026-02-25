// app/admin/access-titles/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Permission, Role } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

async function requireAdmin() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");
  const role = session.user?.role ?? null;
  if (role !== Role.ADMIN) redirect("/");
  return session;
}

function nonEmpty(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

function isPermissionValue(v: unknown): v is Permission {
  return typeof v === "string" && (Object.values(Permission) as string[]).includes(v);
}

function safePermissionsFromFormData(fd: FormData, key: string): Permission[] {
  const vals = fd.getAll(key).map((x) => String(x).trim());
  const out: Permission[] = [];
  const seen = new Set<string>();
  for (const v of vals) {
    if (!v) continue;
    if (seen.has(v)) continue;
    if (isPermissionValue(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function groupForPermission(p: Permission): string {
  // Prefix-based grouping (acts like a tree)
  if (p.startsWith("ADMIN_")) return "Admin Modules";
  if (p.startsWith("VIEW_")) return "Navigation / View";
  if (p.startsWith("CREATE_")) return "Create";
  if (p.startsWith("UPDATE_")) return "Update";
  if (p.startsWith("SUBMIT_")) return "Submit";
  return "Other";
}

function labelForPermission(p: Permission): string {
  return p
    .split("_")
    .map((w) => {
      if (w === "ADMIN") return "Admin";
      if (w === "HVAC") return "HVAC";
      return w.charAt(0) + w.slice(1).toLowerCase();
    })
    .join(" ");
}

type TitleRow = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  permissions: Array<{ permission: Permission }>;
  createdAt: Date;
  updatedAt: Date;
  _count: { users: number };
};

export default async function AdminAccessTitlesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; created?: string }>;
}) {
  await requireAdmin();

  const sp = await searchParams;
  const ok = (sp.ok ?? "") === "1";
  const error = (sp.error ?? "").trim();
  const created = (sp.created ?? "").trim();

  const titles = (await prisma.permissionTitle.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      active: true,
      createdAt: true,
      updatedAt: true,
      permissions: { select: { permission: true } },
      _count: { select: { users: true } },
    },
  })) as TitleRow[];

  const allPermissions = Object.values(Permission) as Permission[];

  // Build groups for tree UI
  const groups = new Map<string, Permission[]>();
  for (const p of allPermissions) {
    const g = groupForPermission(p);
    const arr = groups.get(g) ?? [];
    arr.push(p);
    groups.set(g, arr);
  }

  const groupOrder = ["Navigation / View", "Create", "Update", "Submit", "Admin Modules", "Other"].filter((g) =>
    groups.has(g)
  );

  async function createTitleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const name = nonEmpty(formData.get("name"));
    const description = nonEmpty(formData.get("description")) || null;

    if (!name) redirect("/admin/access-titles?error=" + encodeURIComponent("Name is required"));

    try {
      const t = await prisma.permissionTitle.create({
        data: { name, description, active: true },
        select: { id: true },
      });

      revalidatePath("/admin/access-titles");
      redirect("/admin/access-titles?ok=1&created=" + encodeURIComponent(t.id));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Create failed";
      redirect("/admin/access-titles?error=" + encodeURIComponent(msg));
    }
  }

  async function updateTitleMetaAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = nonEmpty(formData.get("id"));
    const name = nonEmpty(formData.get("name"));
    const description = nonEmpty(formData.get("description")) || null;
    const active = nonEmpty(formData.get("active")) === "true";

    if (!id) redirect("/admin/access-titles?error=" + encodeURIComponent("Missing id"));
    if (!name) redirect("/admin/access-titles?error=" + encodeURIComponent("Name is required"));

    try {
      await prisma.permissionTitle.update({
        where: { id },
        data: { name, description, active },
      });

      revalidatePath("/admin/access-titles");
      redirect("/admin/access-titles?ok=1");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Update failed";
      redirect("/admin/access-titles?error=" + encodeURIComponent(msg));
    }
  }

  async function savePermissionsAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const titleId = nonEmpty(formData.get("titleId"));
    if (!titleId) redirect("/admin/access-titles?error=" + encodeURIComponent("Missing titleId"));

    const perms = safePermissionsFromFormData(formData, "permissions");

    try {
      await prisma.$transaction(async (tx) => {
        const t = await tx.permissionTitle.findUnique({ where: { id: titleId }, select: { id: true } });
        if (!t) throw new Error("Role not found");

        await tx.permissionTitlePermission.deleteMany({ where: { titleId } });

        if (perms.length > 0) {
          await tx.permissionTitlePermission.createMany({
            data: perms.map((permission) => ({ titleId, permission })),
          });
        }
      });

      revalidatePath("/admin/access-titles");
      redirect("/admin/access-titles?ok=1");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Save permissions failed";
      redirect("/admin/access-titles?error=" + encodeURIComponent(msg));
    }
  }

  async function deleteTitleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = nonEmpty(formData.get("id"));
    if (!id) redirect("/admin/access-titles?error=" + encodeURIComponent("Missing id"));

    try {
      await prisma.permissionTitle.delete({ where: { id } });
      revalidatePath("/admin/access-titles");
      redirect("/admin/access-titles?ok=1");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      redirect("/admin/access-titles?error=" + encodeURIComponent(msg));
    }
  }

  // Styles (uses your CSS vars so dark mode behaves)
  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";

  const pageWrap: CSSProperties = { padding: 16 };
  const container: CSSProperties = { padding: 16, maxWidth: 1200, margin: "0 auto", color: fg };

  const card: CSSProperties = {
    border,
    borderRadius: 14,
    background: surface,
    padding: 12,
  };

  const field: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 12,
    border,
    background: surface,
    color: fg,
    outline: "none",
    fontSize: 14,
  };

  const btn: CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border,
    background: surface,
    color: fg,
    fontWeight: 900,
    cursor: "pointer",
    lineHeight: 1,
    whiteSpace: "nowrap",
  };

  const btnPrimary: CSSProperties = {
    ...btn,
    background: "rgba(33,150,243,0.18)",
    border: "1px solid rgba(33,150,243,0.55)",
  };

  const btnDanger: CSSProperties = {
    ...btn,
    background: "rgba(244,67,54,0.14)",
    border: "1px solid rgba(244,67,54,0.55)",
  };

  return (
    <main style={pageWrap}>
      <div style={container}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Admin: Roles & Permissions</h1>
          <Link href="/admin/users" style={{ ...btn, textDecoration: "none", display: "inline-block" }}>
            ← Users
          </Link>
        </div>

        {error ? (
          <div style={{ ...card, marginTop: 12 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Error</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{error}</div>
          </div>
        ) : null}

        {ok ? (
          <div style={{ ...card, marginTop: 12 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>✅ Saved</div>
            {created ? <div>Created role id: {created}</div> : null}
          </div>
        ) : null}

        {/* Create */}
        <details style={{ ...card, marginTop: 12 }} open={Boolean(created || error)}>
          <summary style={{ cursor: "pointer", fontWeight: 900, listStylePosition: "inside", fontSize: 16 }}>
            Create Role
          </summary>

          <form action={createTitleAction} style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 12, opacity: 0.9, fontWeight: 900 }}>
              Role name
              <input name="name" style={field} placeholder="e.g. Maintenance Lead" required />
            </label>

            <label style={{ display: "grid", gap: 6, fontSize: 12, opacity: 0.9, fontWeight: 900 }}>
              Description (optional)
              <input name="description" style={field} placeholder="What this role is for" />
            </label>

            <div>
              <button type="submit" style={btnPrimary}>
                Create
              </button>
            </div>
          </form>
        </details>

        {/* List */}
        <div style={{ ...card, marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900 }}>Roles</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Total: <b>{titles.length}</b>
            </div>
          </div>

          {titles.length === 0 ? (
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>No roles yet.</div>
          ) : (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {titles.map((t) => {
                const selected = new Set(t.permissions.map((x) => x.permission));
                const selectedCount = selected.size;

                return (
                  <details key={t.id} style={{ borderTop: border, paddingTop: 10 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 900 }}>
                      {t.name}{" "}
                      <span style={{ opacity: 0.75, fontWeight: 700 }}>
                        • {t.active ? "Active" : "Disabled"} • {t._count.users} user{t._count.users === 1 ? "" : "s"} •{" "}
                        {selectedCount} perms
                      </span>
                    </summary>

                    <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                      {/* Meta */}
                      <form action={updateTitleMetaAction} style={{ display: "grid", gap: 10 }}>
                        <input type="hidden" name="id" value={t.id} />

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          <label style={{ display: "grid", gap: 6, fontSize: 12, opacity: 0.9, fontWeight: 900 }}>
                            Name
                            <input name="name" defaultValue={t.name} style={field} required />
                          </label>

                          <label style={{ display: "grid", gap: 6, fontSize: 12, opacity: 0.9, fontWeight: 900 }}>
                            Active
                            <select name="active" defaultValue={t.active ? "true" : "false"} style={field}>
                              <option value="true">Active</option>
                              <option value="false">Disabled</option>
                            </select>
                          </label>
                        </div>

                        <label style={{ display: "grid", gap: 6, fontSize: 12, opacity: 0.9, fontWeight: 900 }}>
                          Description
                          <input name="description" defaultValue={t.description ?? ""} style={field} />
                        </label>

                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <button type="submit" style={btnPrimary}>
                            Save role info
                          </button>
                        </div>
                      </form>

                      {/* Permissions tree */}
                      <form action={savePermissionsAction} style={{ display: "grid", gap: 10 }}>
                        <input type="hidden" name="titleId" value={t.id} />

                        <div style={{ fontWeight: 900 }}>Permissions</div>
                        <div style={{ fontSize: 12, opacity: 0.8 }}>
                          Check the permissions this role grants. Users assigned this role inherit them.
                        </div>

                        <div style={{ display: "grid", gap: 10 }}>
                          {groupOrder.map((group) => {
                            const perms = groups.get(group) ?? [];
                            const selectedInGroup = perms.filter((p) => selected.has(p)).length;

                            return (
                              <details
                                key={`${t.id}-${group}`}
                                style={{
                                  border: "1px solid rgba(128,128,128,0.18)",
                                  borderRadius: 14,
                                  padding: 10,
                                  background: "rgba(255,255,255,0.02)",
                                }}
                                open={group === "Admin Modules"}
                              >
                                <summary style={{ cursor: "pointer", fontWeight: 900, listStylePosition: "inside" }}>
                                  {group}{" "}
                                  <span style={{ opacity: 0.75, fontWeight: 700 }}>
                                    ({selectedInGroup}/{perms.length})
                                  </span>
                                </summary>

                                <div
                                  style={{
                                    marginTop: 10,
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                                    gap: 8,
                                  }}
                                >
                                  {perms.map((perm) => (
                                    <label
                                      key={`${t.id}-${perm}`}
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: "20px 1fr",
                                        gap: 10,
                                        alignItems: "center",
                                        padding: "8px 10px",
                                        border: "1px solid rgba(128,128,128,0.15)",
                                        borderRadius: 12,
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        name="permissions"
                                        value={perm}
                                        defaultChecked={selected.has(perm)}
                                      />
                                      <span style={{ fontWeight: 900 }}>
                                        {labelForPermission(perm)}
                                        <span
                                          style={{
                                            display: "block",
                                            marginTop: 2,
                                            fontSize: 12,
                                            opacity: 0.7,
                                            fontFamily:
                                              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                          }}
                                        >
                                          {perm}
                                        </span>
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </details>
                            );
                          })}
                        </div>

                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <button type="submit" style={btnPrimary}>
                            Save permissions
                          </button>
                          <div style={{ fontSize: 12, opacity: 0.75 }}>
                            Selected currently: <b>{selectedCount}</b>
                          </div>
                        </div>
                      </form>

                      {/* Delete */}
                      <form action={deleteTitleAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <button type="submit" style={btnDanger}>
                          Delete role
                        </button>
                        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                          Deleting removes the role from all users (join rows cascade).
                        </div>
                      </form>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
          This page edits <b>Permission Titles</b> (dynamic roles). Your enum <code>Role</code> stays simple (EMPLOYEE /
          MAINTENANCE / MANAGER / ADMIN).
        </div>
      </div>
    </main>
  );
}