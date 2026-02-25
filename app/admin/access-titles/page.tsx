// app/admin/access-titles/page.tsx
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { Permission, Role } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: { id?: string | null; email?: string | null; role?: Role | null } | null;
} | null;

async function requireAdmin() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");
  const role = (session.user as any)?.role ?? null;
  if (role !== Role.ADMIN) redirect("/");
}

const GROUPS: Array<{ title: string; perms: Permission[] }> = [
  {
    title: "Maintenance",
    perms: [
      "VIEW_MAINTENANCE" as Permission,
      "VIEW_MAINTENANCE_TICKETS" as Permission,
      "CREATE_MAINTENANCE_TICKETS" as Permission,
      "UPDATE_OWN_MAINTENANCE_TICKETS" as Permission,
    ].filter(Boolean) as Permission[],
  },
  {
    title: "Work Orders",
    perms: [
      Permission.VIEW_WORK_ORDERS,
      Permission.CREATE_WORK_ORDERS,
      Permission.UPDATE_OWN_WORK_ORDERS,
      Permission.SUBMIT_OWN_WORK_ORDERS,
    ],
  },
  {
    title: "Checkout",
    perms: [Permission.VIEW_CHECKOUT, Permission.CREATE_CHECKOUT],
  },
  {
    title: "Admin (dangerous)",
    perms: [
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_EDIT_ITEMS,
      Permission.ADMIN_IMPORT_EXPORT_ITEMS,
      Permission.ADMIN_VIEW_USERS,
      Permission.ADMIN_EDIT_USERS,
      Permission.ADMIN_VIEW_LOCATIONS,
      Permission.ADMIN_EDIT_LOCATIONS,
      Permission.ADMIN_VIEW_WORK_ORDERS,
      Permission.ADMIN_EDIT_WORK_ORDERS,
      Permission.ADMIN_DELETE_WORK_ORDERS,
      Permission.ADMIN_VIEW_MAINTENANCE_TICKETS,
      Permission.ADMIN_EXPORT_MAINTENANCE_TICKETS,
    ],
  },
];

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function safePerm(p: string): Permission | null {
  // runtime guard: only allow perms that exist in current generated enum
  const values = new Set(Object.values(Permission) as string[]);
  return values.has(p) ? (p as Permission) : null;
}

export default async function AdminAccessTitlesPage() {
  await requireAdmin();

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";
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
    minWidth: 0,
  };
  const label: CSSProperties = { display: "grid", gap: 6, fontSize: 12, opacity: 0.9, fontWeight: 900 };

  const titles = await prisma.accessTitle.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true, permissions: true, _count: { select: { users: true } } },
  });

  async function createTitleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    if (!name) throw new Error("Name required");

    await prisma.accessTitle.create({
      data: { name, description, permissions: [] },
    });

    revalidatePath("/admin/access-titles");
    redirect("/admin/access-titles");
  }

  async function saveTitleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing id");

    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;

    const permsRaw = formData.getAll("perms").map((x) => String(x));
    const perms = uniq(permsRaw.map(safePerm).filter(Boolean) as Permission[]);

    await prisma.accessTitle.update({
      where: { id },
      data: { name, description, permissions: perms },
    });

    revalidatePath("/admin/access-titles");
    redirect("/admin/access-titles");
  }

  async function deleteTitleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing id");

    // Unassign from users first (onDelete SetNull should also handle, but do it explicitly)
    await prisma.user.updateMany({ where: { accessTitleId: id }, data: { accessTitleId: null } });
    await prisma.accessTitle.delete({ where: { id } });

    revalidatePath("/admin/access-titles");
    redirect("/admin/access-titles");
  }

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto", color: fg }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Admin: Access Titles</h1>
          <Link href="/admin/users" style={{ ...btn, textDecoration: "none" }}>
            ← Users
          </Link>
        </div>

        <div style={{ marginTop: 12, border, borderRadius: 14, background: surface, padding: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Create new title</div>
          <form action={createTitleAction} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
            <label style={{ ...label, flex: "1 1 260px", minWidth: 220 }}>
              Name
              <input name="name" placeholder="e.g. Maintenance Tech" style={input} />
            </label>
            <label style={{ ...label, flex: "2 1 420px", minWidth: 260 }}>
              Description (optional)
              <input name="description" placeholder="Optional" style={input} />
            </label>
            <button type="submit" style={btn}>
              Create
            </button>
          </form>
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          {titles.map((t) => (
            <details key={t.id} style={{ border, borderRadius: 14, background: surface, padding: 12 }}>
              <summary style={{ cursor: "pointer", fontWeight: 900 }}>
                {t.name} <span style={{ opacity: 0.7, fontWeight: 700 }}>({t._count.users} users)</span>
              </summary>

              <form action={saveTitleAction} style={{ marginTop: 12, display: "grid", gap: 10 }}>
                <input type="hidden" name="id" value={t.id} />

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <label style={{ ...label, flex: "1 1 260px", minWidth: 220 }}>
                    Name
                    <input name="name" defaultValue={t.name} style={input} />
                  </label>
                  <label style={{ ...label, flex: "2 1 420px", minWidth: 260 }}>
                    Description
                    <input name="description" defaultValue={t.description ?? ""} style={input} />
                  </label>
                </div>

                <div style={{ fontWeight: 900, marginTop: 4 }}>Permissions</div>

                <div style={{ display: "grid", gap: 10 }}>
                  {GROUPS.map((g) => (
                    <div key={g.title} style={{ borderTop: border, paddingTop: 10 }}>
                      <div style={{ fontWeight: 900, marginBottom: 8 }}>{g.title}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                        {g.perms.map((p) => {
                          const checked = t.permissions.includes(p);
                          return (
                            <label key={p} style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 800 }}>
                              <input type="checkbox" name="perms" value={p} defaultChecked={checked} />
                              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>
                                {p}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button type="submit" style={btn}>
                    Save
                  </button>

                  <form action={deleteTitleAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <button
                      type="submit"
                      style={{ ...btn, background: "rgba(244,67,54,0.14)", border: "1px solid rgba(244,67,54,0.55)" }}
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </form>
            </details>
          ))}

          {titles.length === 0 ? (
            <div style={{ padding: 12, border, borderRadius: 14, background: surface, opacity: 0.85 }}>
              No access titles yet. Create one above.
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}