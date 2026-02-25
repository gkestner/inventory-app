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

type AccessTitleRow = {
  id: string;
  name: string;
  description: string | null;
  permissions: Array<{ permission: Permission }>;
  _count: { users: number };
};

type AccessTitleDelegate = {
  findMany: (args: unknown) => Promise<unknown[]>;
  create: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
  delete: (args: unknown) => Promise<unknown>;
};

type AccessTitlePermissionDelegate = {
  deleteMany: (args: unknown) => Promise<unknown>;
  createMany: (args: unknown) => Promise<unknown>;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toStringSafe(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function toNullableString(v: unknown): string | null {
  if (v === null || typeof v === "undefined") return null;
  const s = toStringSafe(v).trim();
  return s ? s : null;
}

function toIntSafe(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
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

export default async function AdminAccessTitlesPage() {
  await requireAdmin();

  // Avoid build-time dependency until client is regenerated
  const p = prisma as unknown as Partial<{
    accessTitle: AccessTitleDelegate;
    accessTitlePermission: AccessTitlePermissionDelegate;
  }>;

  const ready =
    typeof p.accessTitle?.findMany === "function" &&
    typeof p.accessTitle?.create === "function" &&
    typeof p.accessTitle?.update === "function" &&
    typeof p.accessTitle?.delete === "function" &&
    typeof p.accessTitlePermission?.deleteMany === "function" &&
    typeof p.accessTitlePermission?.createMany === "function";

  if (!ready) {
    return (
      <NotReadyPanel
        title="Not ready yet"
        details={[
          "Your Prisma Client does not include Access Titles yet (or prisma generate hasn’t been run).",
          "Fix:",
          "1) Apply migration: `npx prisma migrate deploy` (Neon)",
          "2) Regenerate: `npx prisma generate`",
          "3) Redeploy",
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

    await p.accessTitle!.create({
      data: { name, description },
      select: { id: true },
    });

    revalidatePath("/admin/access-titles");
    redirect("/admin/access-titles");
  }

  async function updateTitleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = nonEmpty(formData.get("id"));
    const name = nonEmpty(formData.get("name"));
    const description = nonEmpty(formData.get("description")) || null;

    if (!id || !name) redirect("/admin/access-titles");

    await p.accessTitle!.update({
      where: { id },
      data: { name, description },
    });

    revalidatePath("/admin/access-titles");
    redirect("/admin/access-titles");
  }

  async function updatePermissionsAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const accessTitleId = nonEmpty(formData.get("id"));
    if (!accessTitleId) redirect("/admin/access-titles");

    const selected = safePermissionsFromFormData(formData, "permissions");

    await prisma.$transaction(async (tx) => {
      await (tx as unknown as { accessTitlePermission: AccessTitlePermissionDelegate }).accessTitlePermission.deleteMany({
        where: { accessTitleId },
      });

      if (selected.length > 0) {
        await (tx as unknown as { accessTitlePermission: AccessTitlePermissionDelegate }).accessTitlePermission.createMany({
          data: selected.map((perm) => ({ accessTitleId, permission: perm })),
        });
      }
    });

    revalidatePath("/admin/access-titles");
    redirect("/admin/access-titles");
  }

  async function deleteTitleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = nonEmpty(formData.get("id"));
    if (!id) redirect("/admin/access-titles");

    await p.accessTitle!.delete({ where: { id } });

    revalidatePath("/admin/access-titles");
    redirect("/admin/access-titles");
  }

  let titles: AccessTitleRow[] = [];
  try {
    const raw = await p.accessTitle!.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        permissions: { select: { permission: true } },
        _count: { select: { users: true } },
      },
    });

    titles = (raw ?? []).map((row) => {
      const r = isRecord(row) ? row : {};
      const permsRaw = Array.isArray(r.permissions) ? r.permissions : [];
      const cnt = isRecord(r._count) ? r._count : {};

      const perms: Array<{ permission: Permission }> = [];
      for (const pr of permsRaw) {
        if (!isRecord(pr)) continue;
        if (isPermissionValue(pr.permission)) perms.push({ permission: pr.permission });
      }

      return {
        id: toStringSafe(r.id).trim(),
        name: toStringSafe(r.name).trim(),
        description: toNullableString(r.description),
        permissions: perms,
        _count: { users: toIntSafe(cnt.users) },
      };
    });
  } catch {
    return (
      <NotReadyPanel
        title="Database tables not ready"
        details={[
          "Your app can compile, but the database is missing the Access Title tables/columns.",
          "Fix: run `npx prisma migrate deploy` against Neon, then redeploy.",
        ]}
      />
    );
  }

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";

  const card: CSSProperties = {
    border,
    borderRadius: 14,
    background: surface,
    padding: 12,
  };

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
                const selectedList = t.permissions.map((x) => x.permission);
                const selectedSet = new Set(selectedList);

                return (
                  <details key={t.id} style={{ borderTop: border, paddingTop: 10 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 900 }}>
                      {t.name}{" "}
                      <span style={{ opacity: 0.75, fontWeight: 700 }}>
                        • {t._count.users} user{t._count.users === 1 ? "" : "s"}
                      </span>
                    </summary>

                    <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                      {/* Edit name/desc */}
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

                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <button type="submit" style={btnPrimary}>
                            Save title
                          </button>
                        </div>
                      </form>

                      {/* Permissions (TREE UI) */}
                      <form action={updatePermissionsAction} style={{ display: "grid", gap: 8 }}>
                        <input type="hidden" name="id" value={t.id} />

                        <div style={{ fontWeight: 900 }}>Permissions</div>
                        <div style={{ fontSize: 12, opacity: 0.8 }}>
                          Use group checkboxes to toggle whole sections, or search to find a permission quickly.
                        </div>

                        <PermissionsTreeClient
                          allPermissions={allPermissions}
                          selectedPermissions={Array.from(selectedSet)}
                        />

                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <button type="submit" style={btnPrimary}>
                            Save permissions
                          </button>
                          <div style={{ fontSize: 12, opacity: 0.75 }}>
                            Selected: <b>{selectedList.length}</b>
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
          Tip: create a title named <b>Maintenance</b> and check the permissions you want maintenance staff to have.
        </div>
      </div>
    </main>
  );
}