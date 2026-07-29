// app/admin/roles/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Permission } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: { role?: unknown } | null;
} | null;

async function requireAdmin() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");
  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.ADMIN_EDIT_USERS])) redirect("/");
}

function nonEmpty(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

type SearchParams = { error?: string; ok?: string };

export default async function AdminRolesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const sp = await searchParams;
  const error = (sp.error ?? "").trim();
  const ok = (sp.ok ?? "") === "1";

  // If tables aren’t migrated yet, prisma.appRole will throw at runtime.
  // We show a friendly panel instead of crashing.
  let roles: Array<{ id: string; name: string; description: string | null; isSystem: boolean; updatedAt: Date; users: number }> =
    [];
  try {
    const rows = await prisma.appRole.findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        isSystem: true,
        updatedAt: true,
        _count: { select: { users: true } }, // UserRole relation count
      },
    });

    roles = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      updatedAt: r.updatedAt,
      users: r._count.users,
    }));
  } catch {
    return (
      <main style={{ padding: 16 }}>
        <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto", color: "var(--foreground)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Roles</h1>
              <div style={{ opacity: 0.8, marginTop: 6 }}>
                Create and manage dynamic roles. Next: edit role permissions &amp; title grants.
              </div>
            </div>
            <Link
              href="/admin/users"
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(128,128,128,0.25)",
                background: "var(--background)",
                color: "var(--foreground)",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              Back to Users
            </Link>
          </div>

          <div
            style={{
              marginTop: 12,
              padding: 14,
              borderRadius: 14,
              border: "1px solid rgba(255,180,0,0.55)",
              background: "var(--background)",
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 6 }}>⚠️ Dynamic roles not migrated yet</div>
            <div style={{ opacity: 0.9 }}>
              Your database does not have the <code>AppRole</code>/<code>UserRole</code> tables yet.
              Run migrations and redeploy.
            </div>
          </div>
        </div>
      </main>
    );
  }

  async function createRoleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const name = nonEmpty(formData.get("name"));
    const description = nonEmpty(formData.get("description")) || null;

    if (!name) redirect("/admin/roles?error=" + encodeURIComponent("Name is required"));

    try {
      await prisma.appRole.create({
        data: { name, description, isSystem: false },
        select: { id: true },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Create failed";
      redirect("/admin/roles?error=" + encodeURIComponent(msg));
    }

    revalidatePath("/admin/roles");
    revalidatePath("/admin/users"); // ✅ users page needs to see new roles
    redirect("/admin/roles?ok=1");
  }

  async function deleteRoleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = nonEmpty(formData.get("id"));
    if (!id) redirect("/admin/roles?error=" + encodeURIComponent("Missing id"));

    try {
      const r = await prisma.appRole.findUnique({ where: { id }, select: { isSystem: true } });
      if (!r) redirect("/admin/roles?error=" + encodeURIComponent("Role not found"));
      if (r.isSystem) redirect("/admin/roles?error=" + encodeURIComponent("System roles cannot be deleted"));

      await prisma.appRole.delete({ where: { id } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      redirect("/admin/roles?error=" + encodeURIComponent(msg));
    }

    revalidatePath("/admin/roles");
    revalidatePath("/admin/users");
    redirect("/admin/roles?ok=1");
  }

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";

  const card: CSSProperties = { border, borderRadius: 14, background: surface, padding: 12 };
  const input: CSSProperties = {
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
  const btnPrimary: CSSProperties = { ...btn, background: "rgba(33,150,243,0.18)", border: "1px solid rgba(33,150,243,0.55)" };
  const btnDanger: CSSProperties = { ...btn, background: "rgba(244,67,54,0.14)", border: "1px solid rgba(244,67,54,0.55)" };

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto", color: fg }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Roles</h1>
            <div style={{ opacity: 0.8, marginTop: 6 }}>
              Create and manage dynamic roles. Next: edit role permissions &amp; title grants.
            </div>
          </div>

          <Link
            href="/admin/users"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border,
              background: surface,
              color: fg,
              textDecoration: "none",
              fontWeight: 900,
            }}
          >
            Back to Users
          </Link>
        </div>

        {error ? (
          <div style={{ ...card, marginTop: 12, border: "1px solid rgba(244,67,54,0.55)", background: "rgba(244,67,54,0.06)" }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Error</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{error}</div>
          </div>
        ) : null}

        {ok ? (
          <div style={{ ...card, marginTop: 12, border: "1px solid rgba(33,150,243,0.55)", background: "rgba(33,150,243,0.06)" }}>
            <div style={{ fontWeight: 900 }}>✅ Saved</div>
          </div>
        ) : null}

        <div style={{ marginTop: 12, ...card }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Create role</div>
          <form action={createRoleAction} style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6, fontWeight: 900 }}>
              Name
              <input name="name" style={input} placeholder="e.g., Inventory Clerk" required />
            </label>
            <label style={{ display: "grid", gap: 6, fontWeight: 900 }}>
              Description
              <textarea name="description" style={{ ...input, minHeight: 70 }} placeholder="Optional" />
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button type="submit" style={btnPrimary}>
                Create role
              </button>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Role permissions &amp; titles are edited on the role detail page (next step).</div>
            </div>
          </form>
        </div>

        <div style={{ marginTop: 12, ...card }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900 }}>All roles</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              <b>{roles.length}</b> total
            </div>
          </div>

          {roles.length === 0 ? (
            <div style={{ marginTop: 10, opacity: 0.8 }}>No roles yet.</div>
          ) : (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 220px 220px", gap: 10, fontWeight: 900, opacity: 0.85 }}>
                <div>Role</div>
                <div>Users</div>
                <div>Updated</div>
                <div>Actions</div>
              </div>

              {roles.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 120px 220px 220px",
                    gap: 10,
                    alignItems: "center",
                    borderTop: border,
                    paddingTop: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 900 }}>{r.name}</div>
                    <div style={{ opacity: 0.75 }}>{r.description ?? "—"}</div>
                    {r.isSystem ? <div style={{ fontSize: 12, opacity: 0.75 }}>(System)</div> : null}
                  </div>

                  <div>{r.users}</div>
                  <div>{r.updatedAt.toLocaleString()}</div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Link href={`/admin/roles/${encodeURIComponent(r.id)}`} style={{ ...btn, textDecoration: "none", display: "inline-block" }}>
                      Edit
                    </Link>

                    <form action={deleteRoleAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" style={{ ...btnDanger, opacity: r.isSystem ? 0.5 : 1 }} disabled={r.isSystem}>
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
            Tip: Keep “system” roles (seeded) locked; create business roles here.
          </div>
        </div>
      </div>
    </main>
  );
}
