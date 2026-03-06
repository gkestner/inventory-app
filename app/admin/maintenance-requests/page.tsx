import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { authOptions } from "@/app/lib/auth";
import { canAccessAdmin } from "@/app/lib/admin-access";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { ADMIN_VIEW_MAINTENANCE_REQUESTS } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type Db = {
  user: {
    findUnique: (args: unknown) => Promise<{ id: string; active: boolean } | null>;
  };
  maintenanceRequest: {
    findMany: (args: unknown) => Promise<
      Array<{
        id: string;
        status: "OPEN" | "RESOLVED" | "ARCHIVED";
        title: string;
        description: string;
        createdAt: Date;
        resolvedAt: Date | null;
        archivedAt: Date | null;
        resolutionNotes: string | null;
        location: { id: string; name: string };
        requestedByUser: { name: string | null; email: string | null };
        assignedMaintenanceUser: { id: string; name: string | null; email: string | null } | null;
      }>
    >;
    findUnique: (args: unknown) => Promise<
      | {
          id: string;
          title: string;
          status: "OPEN" | "RESOLVED" | "ARCHIVED";
          location: { id: string; name: string };
          requestedByUserId: string;
        }
      | null
    >;
    update: (args: unknown) => Promise<unknown>;
  };
  notification: {
    create: (args: unknown) => Promise<unknown>;
  };
  auditLog: {
    create: (args: unknown) => Promise<unknown>;
  };
};

const db = prisma as unknown as Db;

function fmtDateTime(value: Date | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function personLabel(person: { name: string | null; email: string | null } | null | undefined): string {
  if (!person) return "Unassigned";
  return String(person.name ?? "").trim() || String(person.email ?? "").trim() || "Unknown";
}

async function requireAdmin() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");
  const [hasAdminAccess, perms] = await Promise.all([canAccessAdmin(session), loadUserPermissions(session)]);
  const canViewQueue = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_MAINTENANCE_REQUESTS]);
  if (!hasAdminAccess || !canViewQueue) redirect("/");
  return session;
}

export default async function AdminMaintenanceRequestsPage() {
  const session = await requireAdmin();

  async function archiveAction(formData: FormData) {
    "use server";

    const session = await requireAdmin();
    const email = String(session.user?.email ?? "").trim().toLowerCase();
    if (!email) redirect("/login");

    const actor = await db.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!actor || !actor.active) redirect("/login");

    const requestId = String(formData.get("requestId") ?? "").trim();
    const resolutionNotes = String(formData.get("resolutionNotes") ?? "").trim() || null;
    if (!requestId) redirect("/admin/maintenance-requests");

    const existing = await db.maintenanceRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        title: true,
        status: true,
        location: { select: { id: true, name: true } },
        requestedByUserId: true,
      },
    });
    if (!existing) redirect("/admin/maintenance-requests");
    if (existing.status !== "OPEN") redirect("/admin/maintenance-requests");

    const now = new Date();
    await db.maintenanceRequest.update({
      where: { id: existing.id },
      data: {
        status: "ARCHIVED",
        resolvedAt: now,
        archivedAt: now,
        resolvedByUserId: actor.id,
        resolutionNotes,
      },
    });

    await db.auditLog.create({
      data: {
        actorUserId: actor.id,
        module: "MAINTENANCE_REQUESTS",
        action: "ADMIN_ARCHIVE_REQUEST",
        entityType: "MaintenanceRequest",
        entityId: existing.id,
        message: `Admin resolved and archived request: ${existing.title}`,
        metadata: {
          locationId: existing.location.id,
          locationName: existing.location.name,
          resolutionNotes,
        },
      },
    });

    await db.notification.create({
      data: {
        userId: existing.requestedByUserId,
        type: "SYSTEM",
        title: `Maintenance request closed - ${existing.location.name}`,
        body: `${existing.title} has been resolved and archived by admin.`,
        href: "/maintenance-requests",
      },
    });

    revalidatePath("/admin/maintenance-requests");
    revalidatePath("/maintenance-requests");
    revalidatePath("/admin/reports/maintenance-requests");
    revalidatePath("/notifications");
    redirect("/admin/maintenance-requests?archived=1");
  }

  const rows = await db.maintenanceRequest.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 400,
    select: {
      id: true,
      status: true,
      title: true,
      description: true,
      createdAt: true,
      resolvedAt: true,
      archivedAt: true,
      resolutionNotes: true,
      location: { select: { id: true, name: true } },
      requestedByUser: { select: { name: true, email: true } },
      assignedMaintenanceUser: { select: { id: true, name: true, email: true } },
    },
  });

  return (
    <main>
      <div style={{ maxWidth: 1300, margin: "0 auto", display: "grid", gap: 12 }}>
        <section style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 18, background: "var(--surface)", boxShadow: "var(--shadow)" }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Maintenance Request Queue</h1>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
            Admin running log for maintenance issue requests, assignment visibility, and closeout actions. This is separate from Maintenance Tickets (parts checkout invoicing).
          </p>
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/maintenance-requests" style={{ textDecoration: "none", fontWeight: 800 }}>
              {"Open Shared Request Page ->"}
            </Link>
            <Link href="/admin/reports/maintenance-requests" style={{ textDecoration: "none", fontWeight: 800 }}>
              {"Open Request Reports ->"}
            </Link>
            <Link href="/admin/maintenance-tickets" style={{ textDecoration: "none", fontWeight: 800 }}>
              {"Open Maintenance Tickets (Parts) ->"}
            </Link>
          </div>
        </section>

        <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
                  <th style={{ textAlign: "left", padding: 10 }}>Status</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Requested</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Store</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Issue</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Requester</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Assigned Tech</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Resolved</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Admin Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: 10, fontWeight: 900 }}>{row.status}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap", fontSize: 13 }}>{fmtDateTime(row.createdAt)}</td>
                    <td style={{ padding: 10 }}>{row.location.name}</td>
                    <td style={{ padding: 10 }}>
                      <div style={{ fontWeight: 800 }}>{row.title}</div>
                      <div style={{ marginTop: 4, opacity: 0.9 }}>{row.description}</div>
                      {row.resolutionNotes ? <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>Resolution: {row.resolutionNotes}</div> : null}
                    </td>
                    <td style={{ padding: 10 }}>{personLabel(row.requestedByUser)}</td>
                    <td style={{ padding: 10 }}>{personLabel(row.assignedMaintenanceUser)}</td>
                    <td style={{ padding: 10 }}>{fmtDateTime(row.resolvedAt)}</td>
                    <td style={{ padding: 10 }}>
                      {row.status === "OPEN" ? (
                        <form action={archiveAction} style={{ display: "grid", gap: 6 }}>
                          <input type="hidden" name="requestId" value={row.id} />
                          <input name="resolutionNotes" placeholder="Resolution notes" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", width: 220 }} />
                          <button type="submit" style={{ width: "fit-content", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface-2)", padding: "7px 10px", fontWeight: 800, cursor: "pointer" }}>
                            Resolve & Archive
                          </button>
                        </form>
                      ) : (
                        <span style={{ opacity: 0.7, fontSize: 12 }}>Closed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length === 0 ? <div style={{ padding: 14, opacity: 0.8 }}>No requests yet.</div> : null}
        </section>
      </div>
    </main>
  );
}
