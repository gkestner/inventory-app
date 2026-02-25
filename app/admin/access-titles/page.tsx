// app/admin/access-titles/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Permission, Role } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";

// ✅ client permission tree
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
  if ((session.user?.role ?? null) !== Role.ADMIN) redirect("/");
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

/**
 * ✅ Detect PermissionTitle permissions join table without prisma.$unsafe.
 * We only ever allow-list known names (so we can interpolate identifier safely).
 */
async function detectPermissionTitleJoinTable(): Promise<"PermissionTitlePermission" | "AccessTitlePermission" | null> {
  const candidates = ["PermissionTitlePermission", "AccessTitlePermission"] as const;

  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (${candidates[0]}, ${candidates[1]})
    ORDER BY CASE table_name
      WHEN ${candidates[0]} THEN 0
      WHEN ${candidates[1]} THEN 1
      ELSE 99
    END
    LIMIT 1
  `;

  const t = (rows?.[0]?.table_name ?? null) as string | null;
  if (t === "PermissionTitlePermission" || t === "AccessTitlePermission") return t;
  return null;
}

type TitleRow = {
  id: string;
  name: string;
  active: boolean;
  description: string | null;
  permissions: Permission[];
  usersCount: number;
};

export default async function AdminAccessTitlesPage() {
  await requireAdmin();

  let joinTable: "PermissionTitlePermission" | "AccessTitlePermission" | null = null;
  try {
    joinTable = await detectPermissionTitleJoinTable();
  } catch {
    joinTable = null;
  }

  if (!joinTable) {
    return (
      <NotReadyPanel
        title="Database tables not ready"
        details={[
          'Missing Permission Title permissions join table (expected "PermissionTitlePermission" or "AccessTitlePermission").',
          "Fix:",
          "1) Run `npx prisma migrate deploy` against Neon",
          "2) Redeploy",
        ]}
      />
    );
  }

  async function createTitleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const name = nonEmpty(formData.get("name"));
    const description = nonEmpty(formData.get("description")) || null;
    if (!name) redirect("/admin/access-titles");

    await prisma.permissionTitle.create({
      data: { name, description, active: true },
      select: { id: true },
    });

    revalidatePath("/admin/access-titles");
    revalidatePath("/admin/users"); // ✅ users page needs to see new titles
    redirect("/admin/access-titles");
  }

  async function updateTitleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = nonEmpty(formData.get("id"));
    const name = nonEmpty(formData.get("name"));
    const description = nonEmpty(formData.get("description")) || null;
    const activeRaw = nonEmpty(formData.get("active"));
    const active = activeRaw === "true";

    if (!id || !name) redirect("/admin/access-titles");

    await prisma.permissionTitle.update({
      where: { id },
      data: { name, description, active },
    });

    revalidatePath("/admin/access-titles");
    revalidatePath("/admin/users");
    redirect("/admin/access-titles");
  }

  async function updatePermissionsAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const permissionTitleId = nonEmpty(formData.get("id"));
    if (!permissionTitleId) redirect("/admin/access-titles");

    const selected = safePermissionsFromFormData(formData, "permissions");

    // ✅ allow-list identifier
    if (joinTable !== "PermissionTitlePermission" && joinTable !== "AccessTitlePermission") {
      redirect("/admin/access-titles");
    }

    await prisma.$transaction(async (tx) => {
      // Clear existing
      await tx.$executeRawUnsafe(
        `DELETE FROM "public"."${joinTable}" WHERE "permissionTitleId" = $1`,
        permissionTitleId
      );

      // Insert new
      if (selected.length > 0) {
        const valuesSql: string[] = [];
        const params: unknown[] = [permissionTitleId];

        for (let i = 0; i < selected.length; i++) {
          valuesSql.push(`($1, $${i + 2})`);
          params.push(selected[i]);
        }

        await tx.$executeRawUnsafe(
          `INSERT INTO "public"."${joinTable}" ("permissionTitleId","permission") VALUES ${valuesSql.join(", ")}`,
          ...params
        );
      }
    });

    revalidatePath("/admin/access-titles");
    revalidatePath("/admin/users"); // ✅ users inherit title perms; refresh view
    redirect("/admin/access-titles");
  }

  async function deleteTitleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = nonEmpty(formData.get("id"));
    if (!id) redirect("/admin/access-titles");

    await prisma.permissionTitle.delete({ where: { id } });

    revalidatePath("/admin/access-titles");
    revalidatePath("/admin/users");
    redirect("/admin/access-titles");
  }

  // ----- Load titles + permissions + user counts (no prisma.$unsafe) -----
  let titles: TitleRow[] = [];
  try {
    const base = await prisma.permissionTitle.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: { id: true, name: true, description: true, active: true },
    });

    const ids = base.map((b) => b.id);

    const permsById = new Map<string, Permission[]>();
    if (ids.length > 0) {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
      const rows = await prisma.$queryRawUnsafe<Array<{ permissionTitleId: string; permission: Permission }>>(
        `SELECT "permissionTitleId", "permission"
         FROM "public"."${joinTable}"
         WHERE "permissionTitleId" IN (${placeholders})`,
        ...ids
      );

      for (const r of rows ?? []) {
        if (!r?.permissionTitleId) continue;
        if (!isPermissionValue(r.permission)) continue;
        const arr = permsById.get(r.permissionTitleId) ?? [];
        arr.push(r.permission);
        permsById.set(r.permissionTitleId, arr);
      }
    }

    const countsById = new Map<string, number>();
    if (ids.length > 0) {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
      const rows = await prisma.$queryRawUnsafe<Array<{ titleId: string; c: bigint }>>(
        `SELECT "titleId", COUNT(*)::bigint AS c
         FROM "public"."UserPermissionTitle"
         WHERE "titleId" IN (${placeholders})
         GROUP BY "titleId"`,
        ...ids
      );

      for (const r of rows ?? []) {
        if (!r?.titleId) continue;
        countsById.set(r.titleId, Number(r.c ?? 0));
      }
    }

    titles = base.map((t) => ({
      id: t.id,
      name: t.name,
      active: t.active,
      description: t.description,
      permissions: (permsById.get(t.id) ?? []).sort(),
      usersCount: countsById.get(t.id) ?? 0,
    }));
  } catch {
    return (
      <NotReadyPanel
        title="Database tables not ready"
        details={[
          "Your app can compile, but the database is missing Permission Title tables/columns.",
          "Fix: run `npx prisma migrate deploy` against Neon, then redeploy.",
        ]}
      />
    );
  }

  // ----- UI -----
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

  const allPermissions = Object.values(Permission);

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

        {/* Create */}
        <div style={{ marginTop: 12, ...card }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Create new title</div>
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
              <button type="submit" style={btnPrimary}>
                Create
              </button>
            </div>
          </form>
        </div>

        {/* List */}
        <div style={{ marginTop: 12, ...card }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900 }}>Titles</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Total: <b>{titles.length}</b>
            </div>
          </div>

          {titles.length === 0 ? (
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>No titles yet.</div>
          ) : (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {titles.map((t) => {
                const selected = t.permissions;

                return (
                  <details key={t.id} style={{ borderTop: border, paddingTop: 10 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 900 }}>
                      {t.name}{" "}
                      <span style={{ opacity: 0.75, fontWeight: 700 }}>
                        • {t.usersCount} user{t.usersCount === 1 ? "" : "s"} • {selected.length} perm{" "}
                        {!t.active ? "• Inactive" : ""}
                      </span>
                    </summary>

                    <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                      {/* Edit */}
                      <form action={updateTitleAction} style={{ display: "grid", gap: 8 }}>
                        <input type="hidden" name="id" value={t.id} />

                        <label style={label}>
                          Name
                          <input name="name" defaultValue={t.name} style={input} required />
                        </label>

                        <label style={label}>
                          Description
                          <input name="description" defaultValue={t.description ?? ""} style={input} />
                        </label>

                        <label style={{ ...label, gridAutoFlow: "column", alignItems: "center", justifyContent: "start" }}>
                          <span style={{ fontWeight: 900 }}>Active</span>
                          <select name="active" defaultValue={t.active ? "true" : "false"} style={input as CSSProperties}>
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        </label>

                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <button type="submit" style={btnPrimary}>
                            Save title
                          </button>
                        </div>
                      </form>

                      {/* Permissions tree (client) */}
                      <form action={updatePermissionsAction} style={{ display: "grid", gap: 10 }}>
                        <input type="hidden" name="id" value={t.id} />

                        <div>
                          <div style={{ fontWeight: 900 }}>Permissions</div>
                          <div style={{ fontSize: 12, opacity: 0.8 }}>
                            Select permissions this title grants. Users assigned this title inherit them.
                          </div>
                        </div>

                        <div style={{ border, borderRadius: 14, padding: 10 }}>
                          <PermissionsTreeClient
                            allPermissions={allPermissions as unknown as string[]}
                            selectedPermissions={selected as unknown as string[]}
                          />
                        </div>

                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <button type="submit" style={btnPrimary}>
                            Save permissions
                          </button>
                          <div style={{ fontSize: 12, opacity: 0.75 }}>
                            Selected: <b>{selected.length}</b>
                          </div>
                        </div>
                      </form>

                      {/* Delete */}
                      <form action={deleteTitleAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <button type="submit" style={btnDanger}>
                          Delete title
                        </button>
                        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                          Deleting a title removes it from all users automatically.
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
          Tip: create a title named <b>Maintenance</b>, choose permissions, then assign it to users on{" "}
          <Link href="/admin/users" style={{ textDecoration: "underline" }}>
            Admin Users
          </Link>
          .
        </div>
      </div>
    </main>
  );
}