import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { getCompatDb } from "@/app/lib/workflow-foundations";

export const dynamic = "force-dynamic";

type SearchParams = { module?: string; q?: string };

type AuditRow = {
  id: string;
  createdAt: Date | string;
  module: string;
  action: string;
  entityType: string;
  entityId: string | null;
  message: string | null;
  actorUser: { name: string; email: string } | null;
};

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

async function requireAuditView() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");
  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.ADMIN_VIEW_USERS, Permission.ADMIN_EDIT_USERS])) {
    redirect("/");
  }
}

export default async function AuditPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  await requireAuditView();

  const sp = (await searchParams) ?? {};
  const moduleFilter = String(sp.module ?? "").trim();
  const q = String(sp.q ?? "").trim();

  const db = getCompatDb();
  const rows: AuditRow[] = db.auditLog?.findMany
    ? await db.auditLog.findMany({
        where: {
          ...(moduleFilter ? { module: moduleFilter } : {}),
          ...(q
            ? {
                OR: [
                  { action: { contains: q, mode: "insensitive" } },
                  { entityType: { contains: q, mode: "insensitive" } },
                  { entityId: { contains: q, mode: "insensitive" } },
                  { message: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 600,
        include: {
          actorUser: { select: { name: true, email: true } },
        },
      }) as AuditRow[]
    : [];

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1300, margin: "0 auto", display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Audit Trail</h1>

        <form method="get" style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input name="module" placeholder="module" defaultValue={moduleFilter} style={{ minWidth: 180 }} />
          <input name="q" placeholder="search" defaultValue={q} style={{ minWidth: 220 }} />
          <button type="submit" style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", fontWeight: 800 }}>Apply</button>
        </form>

        <section style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Time", "Module", "Action", "Entity", "Actor", "Message"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{new Date(r.createdAt).toLocaleString()}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{r.module}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{r.action}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{r.entityType}{r.entityId ? `:${r.entityId}` : ""}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
                    {r.actorUser ? `${r.actorUser.name} (${r.actorUser.email})` : "-"}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{r.message ?? "-"}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 12, opacity: 0.8 }}>No audit entries yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
