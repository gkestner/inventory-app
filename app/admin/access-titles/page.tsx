// app/admin/access-titles/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Permission, Role } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import PermissionsTreeClient from "./PermissionsTreeClient";

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
}

function nonEmpty(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

function NotReadyPanel({ title, details }: { title: string; details: string[] }) {
  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto", color: fg }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Admin: Access Titles</h1>
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
            ← Users
          </Link>
        </div>

        <div style={{ marginTop: 12, padding: 14, borderRadius: 14, border, background: surface }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>{title}</div>
          <ul style={{ margin: 0, paddingLeft: 18, opacity: 0.9, lineHeight: 1.5 }}>
            {details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
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

type PageProps = {
  searchParams?: {
    titleId?: string;
  };
};

export default async function AdminAccessTitlesPage({ searchParams }: PageProps) {
  await requireAdmin();

  try {
    await prisma.permissionTitle.count();
  } catch {
    return (
      <NotReadyPanel
        title="Database tables not ready"
        details={[
          "Your app can compile, but the database is missing the Permission Title tables/columns.",
          "Fix: run `npx prisma migrate deploy` against Neon, then redeploy.",
        ]}
      />
    );
  }

  // ===== Actions =====
  async function createTitleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const name = nonEmpty(formData.get("name"));
    const description = nonEmpty(formData.get("description")) || null;
    if (!name) redirect("/admin/access-titles");

    const created = await prisma.permissionTitle.create({
      data: { name, description, active: true },
      select: { id: true },
    });

    revalidatePath("/admin/access-titles");
    redirect(`/admin/access-titles?titleId=${encodeURIComponent(created.id)}`);
  }

  async function updateTitleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = nonEmpty(formData.get("id"));
    const name = nonEmpty(formData.get("name"));
    const description = nonEmpty(formData.get("description")) || null;
    if (!id || !name) redirect("/admin/access-titles");

    await prisma.permissionTitle.update({ where: { id }, data: { name, description } });
    revalidatePath("/admin/access-titles");
    redirect(`/admin/access-titles?titleId=${encodeURIComponent(id)}`);
  }

  async function updatePermissionsAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const titleId = nonEmpty(formData.get("id"));
    if (!titleId) redirect("/admin/access-titles");

    const selected = safePermissionsFromFormData(formData, "permissions");

    await prisma.$transaction(async (tx) => {
      await tx.permissionTitlePermission.deleteMany({ where: { titleId } });
      if (selected.length > 0) {
        await tx.permissionTitlePermission.createMany({
          data: selected.map((permission) => ({ titleId, permission })),
          skipDuplicates: true,
        });
      }
    });

    revalidatePath("/admin/access-titles");
    redirect(`/admin/access-titles?titleId=${encodeURIComponent(titleId)}`);
  }

  async function deleteTitleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = nonEmpty(formData.get("id"));
    if (!id) redirect("/admin/access-titles");

    await prisma.permissionTitle.delete({ where: { id } });
    revalidatePath("/admin/access-titles");
    redirect("/admin/access-titles");
  }

  const titles = await prisma.permissionTitle.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, description: true, active: true },
  });

  // Empty state
  if (titles.length === 0) {
    const border = "1px solid rgba(128,128,128,0.25)";
    const surface = "var(--background)";
    const fg = "var(--foreground)";
    const card: CSSProperties = { border, borderRadius: 14, background: surface, padding: 12 };
    const label: CSSProperties = { display: "grid", gap: 6, fontSize: 12, opacity: 0.9, fontWeight: 900 };
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
      background: "rgba(33,150,243,0.18)",
      color: fg,
      fontWeight: 900,
      cursor: "pointer",
      lineHeight: 1,
      whiteSpace: "nowrap",
    };

    return (
      <main style={{ padding: 16 }}>
        <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto", color: fg }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Admin: Access Titles</h1>
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
              ← Users
            </Link>
          </div>

          <div style={{ marginTop: 12, ...card }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Create your first title</div>
            <form action={createTitleAction} style={{ display: "grid", gap: 10 }}>
              <label style={label}>
                Title name
                <input name="name" style={input} placeholder="e.g. Maintenance" required />
              </label>
              <label style={label}>
                Description (optional)
                <input name="description" style={input} placeholder="What this title is for" />
              </label>
              <div>
                <button type="submit" style={btn}>
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    );
  }

  const requestedTitleId = (searchParams?.titleId ?? "").trim();
  const selectedTitle = requestedTitleId ? titles.find((t) => t.id === requestedTitleId) ?? null : null;
  if (!selectedTitle) redirect(`/admin/access-titles?titleId=${encodeURIComponent(titles[0].id)}`);

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";

  const card: CSSProperties = { border, borderRadius: 14, background: surface, padding: 12 };
  const label: CSSProperties = { display: "grid", gap: 6, fontSize: 12, opacity: 0.9, fontWeight: 900 };
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
  const pill: CSSProperties = {
    padding: "6px 10px",
    borderRadius: 999,
    border,
    background: "rgba(255,255,255,0.03)",
    fontWeight: 900,
    fontSize: 12,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    whiteSpace: "nowrap",
  };

  const selectedWithPerms = await prisma.permissionTitle.findUnique({
    where: { id: selectedTitle.id },
    select: {
      id: true,
      name: true,
      description: true,
      permissions: { select: { permission: true } },
    },
  });

  const userCount = await prisma.userPermissionTitle.count({
    where: { titleId: selectedTitle.id },
  });

  const selectedPermissions = (selectedWithPerms?.permissions ?? []).map((p) => String(p.permission));
  const allPermissions = Object.values(Permission).map((p) => String(p));

  const titleSwitchAction = async (formData: FormData) => {
    "use server";
    await requireAdmin();
    const id = nonEmpty(formData.get("titleId"));
    if (!id) redirect("/admin/access-titles");
    redirect(`/admin/access-titles?titleId=${encodeURIComponent(id)}`);
  };

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1500, margin: "0 auto", color: fg }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>
            Permissions: {selectedWithPerms?.name ?? selectedTitle.name}
          </h1>

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
            ← Users
          </Link>

          <span style={{ ...pill, marginLeft: "auto" }}>
            Assigned users: <b>{userCount}</b>
          </span>
        </div>

        {/* Switch + Create (NO nested forms) */}
        <div style={{ marginTop: 12, ...card }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <form action={titleSwitchAction} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
              <label style={{ ...label, minWidth: 320 }}>
                Access Title
                <select name="titleId" defaultValue={selectedTitle.id} style={input}>
                  {titles.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>

              <button type="submit" style={btnPrimary}>
                Switch
              </button>
            </form>

            <div style={{ marginLeft: "auto" }}>
              <details>
                <summary style={{ cursor: "pointer", fontWeight: 900 }}>Create new title</summary>

                <form action={createTitleAction} style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  <label style={label}>
                    Title name
                    <input name="name" style={input} placeholder="e.g. Inventory Clerk" required />
                  </label>
                  <label style={label}>
                    Description (optional)
                    <input name="description" style={input} placeholder="What this title is for" />
                  </label>
                  <div>
                    <button type="submit" style={btnPrimary}>
                      Create
                    </button>
                  </div>
                </form>
              </details>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "360px 1fr", gap: 12 }}>
          {/* Title details */}
          <section style={{ display: "grid", gap: 12 }}>
            <div style={card}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Title Details</div>

              <form action={updateTitleAction} style={{ display: "grid", gap: 10 }}>
                <input type="hidden" name="id" value={selectedTitle.id} />

                <label style={label}>
                  Name
                  <input name="name" defaultValue={selectedWithPerms?.name ?? selectedTitle.name} style={input} required />
                </label>

                <label style={label}>
                  Description
                  <input name="description" defaultValue={selectedWithPerms?.description ?? ""} style={input} />
                </label>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button type="submit" style={btnPrimary}>
                    Save title details
                  </button>

                  <form action={deleteTitleAction}>
                    <input type="hidden" name="id" value={selectedTitle.id} />
                    <button type="submit" style={btnDanger}>
                      Delete title
                    </button>
                  </form>
                </div>

                <div style={{ fontSize: 12, opacity: 0.75 }}>Deleting removes it from all users automatically.</div>
              </form>
            </div>

            <div style={card}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>How to use</div>
              <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.45 }}>
                Use the tree to select permissions by module and path, then click <b>Save Changes</b>.
              </div>
            </div>
          </section>

          {/* Permissions */}
          <section style={card}>
            <form action={updatePermissionsAction} style={{ display: "grid", gap: 12 }}>
              <input type="hidden" name="id" value={selectedTitle.id} />

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontWeight: 900 }}>Permissions</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>Select by module + path. Parent checks apply to all descendants.</div>
                </div>

                <span style={pill}>
                  Selected: <b>{selectedPermissions.length}</b>
                </span>
              </div>

              <PermissionsTreeClient allPermissions={allPermissions} selectedPermissions={selectedPermissions} />

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button type="submit" style={btnPrimary}>
                  Save Changes
                </button>
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  Saves permissions for <b>{selectedWithPerms?.name ?? selectedTitle.name}</b>.
                </div>
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}