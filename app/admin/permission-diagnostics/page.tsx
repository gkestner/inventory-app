import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

type SearchParams = { userId?: string };

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

async function requireAdmin() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");
  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.ADMIN_VIEW_USERS, Permission.ADMIN_EDIT_USERS])) {
    redirect("/");
  }
}

export default async function PermissionDiagnosticsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  await requireAdmin();

  const sp = (await searchParams) ?? {};
  const selectedUserId = String(sp.userId ?? "").trim();

  const db = (await import("@/app/lib/prisma")).prisma as any;

  const users = await db.user.findMany({
    where: { active: true },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, email: true },
  });

  const selected = selectedUserId
    ? await db.user.findUnique({ where: { id: selectedUserId }, select: { id: true, name: true, email: true } })
    : null;

  const [directPerms, titles, roles] = selected
    ? await Promise.all([
        db.userPermission.findMany({ where: { userId: selected.id }, select: { permission: true } }),
        db.userPermissionTitle.findMany({
          where: { userId: selected.id },
          include: { title: { include: { permissions: true } } },
        }),
        db.userRole.findMany({
          where: { userId: selected.id },
          include: {
            role: {
              include: {
                permissions: true,
                titles: { include: { title: { include: { permissions: true } } } },
              },
            },
          },
        }),
      ])
    : [[], [], []];

  const effective = new Set<string>();
  for (const p of directPerms as any[]) effective.add(String(p.permission));
  for (const t of titles as any[]) {
    for (const tp of t.title.permissions as any[]) effective.add(String(tp.permission));
  }
  for (const r of roles as any[]) {
    for (const rp of r.role.permissions as any[]) effective.add(String(rp.permission));
    for (const rt of r.role.titles as any[]) {
      for (const p of rt.title.permissions as any[]) effective.add(String(p.permission));
    }
  }

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Permission Diagnostics</h1>

        <form method="get" style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
          <label style={{ display: "grid", gap: 6, maxWidth: 520 }}>
            User
            <select name="userId" defaultValue={selectedUserId || users[0]?.id || ""}>
              <option value="">Select user</option>
              {users.map((u: any) => (
                <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
              ))}
            </select>
          </label>
          <button type="submit" style={{ marginTop: 10, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", fontWeight: 800 }}>
            Diagnose
          </button>
        </form>

        {selected ? (
          <>
            <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
              <h2 style={{ marginTop: 0 }}>Summary</h2>
              <div>{selected.name} ({selected.email})</div>
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>Effective permissions: {effective.size}</div>
            </section>

            <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
              <h2 style={{ marginTop: 0 }}>Direct Permissions</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(directPerms as any[]).map((p) => (
                  <code key={String(p.permission)}>{String(p.permission)}</code>
                ))}
                {(directPerms as any[]).length === 0 ? <span style={{ opacity: 0.8 }}>None</span> : null}
              </div>
            </section>

            <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
              <h2 style={{ marginTop: 0 }}>Titles</h2>
              {(titles as any[]).map((t) => (
                <div key={t.titleId} style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 900 }}>{t.title.name}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {(t.title.permissions as any[]).map((p: any) => (
                      <code key={String(p.permission)}>{String(p.permission)}</code>
                    ))}
                  </div>
                </div>
              ))}
              {(titles as any[]).length === 0 ? <span style={{ opacity: 0.8 }}>None</span> : null}
            </section>

            <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
              <h2 style={{ marginTop: 0 }}>Roles</h2>
              {(roles as any[]).map((r) => (
                <div key={r.roleId} style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 900 }}>{r.role.name}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {(r.role.permissions as any[]).map((p: any) => (
                      <code key={String(p.permission)}>{String(p.permission)}</code>
                    ))}
                  </div>
                </div>
              ))}
              {(roles as any[]).length === 0 ? <span style={{ opacity: 0.8 }}>None</span> : null}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
