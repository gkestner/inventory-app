import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { authOptions } from "@/app/lib/auth";
import { canAccessAdmin } from "@/app/lib/admin-access";
import { prisma } from "@/app/lib/prisma";
import { loadMaintenanceRequestAssignees } from "@/app/lib/maintenance-requests";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { createNotification, createNotificationForUsers } from "@/app/lib/workflow-foundations";
import { ADMIN_VIEW_MAINTENANCE_REQUESTS, RECEIVE_NOTIFICATION_MAINTENANCE_REQUESTS } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type RawSearchParams = {
  archived?: string | string[];
  resent?: string | string[];
  updated?: string | string[];
  error?: string | string[];
};

function firstParam(v: string | string[] | undefined): string {
  if (!v) return "";
  return Array.isArray(v) ? v[0] ?? "" : v;
}

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
        maintenanceAssignees: Array<{ userId: string; user: { id: string; name: string | null; email: string | null } }>;
      }>
    >;
    findUnique: (args: unknown) => Promise<
      | {
          id: string;
          title: string;
          status: "OPEN" | "RESOLVED" | "ARCHIVED";
          location: { id: string; name: string };
          requestedByUserId?: string;
          assignedMaintenanceUserId?: string | null;
          maintenanceAssignees?: Array<{ userId: string }>;
        }
      | null
    >;
    update: (args: unknown) => Promise<unknown>;
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

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = String(raw ?? "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

async function requireAdmin() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");
  const [hasAdminAccess, perms] = await Promise.all([canAccessAdmin(session), loadUserPermissions(session)]);
  const canViewQueue = perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_MAINTENANCE_REQUESTS]);
  if (!hasAdminAccess || !canViewQueue) redirect("/");
  return session;
}

export default async function AdminMaintenanceRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<RawSearchParams>;
}) {
  await requireAdmin();
  const sp = (await searchParams) ?? {};
  const archived = firstParam(sp?.archived) === "1";
  const resent = firstParam(sp?.resent) === "1";
  const updated = firstParam(sp?.updated) === "1";
  const errorText = firstParam(sp?.error);

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

    if (existing.requestedByUserId) {
      await createNotification({
        userId: existing.requestedByUserId,
        type: "SYSTEM",
        title: `Maintenance request closed - ${existing.location.name}`,
        body: `${existing.title} has been resolved and archived by admin.`,
        href: "/maintenance-requests",
        requiredPermission: RECEIVE_NOTIFICATION_MAINTENANCE_REQUESTS,
      });
    }

    revalidatePath("/admin/maintenance-requests");
    revalidatePath("/maintenance-requests");
    revalidatePath("/admin/reports/maintenance-requests");
    revalidatePath("/notifications");
    redirect("/admin/maintenance-requests?archived=1");
  }

  async function resendNotificationAction(formData: FormData) {
    "use server";

    const session = await requireAdmin();
    const email = String(session.user?.email ?? "").trim().toLowerCase();
    if (!email) redirect("/login");

    const actor = await db.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!actor || !actor.active) redirect("/login");

    const requestId = String(formData.get("requestId") ?? "").trim();
    if (!requestId) redirect("/admin/maintenance-requests");

    const existing = await db.maintenanceRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        title: true,
        status: true,
        location: { select: { id: true, name: true } },
        maintenanceAssignees: { select: { userId: true } },
      },
    });
    if (!existing) redirect("/admin/maintenance-requests");

    const requestAssigneeIds = uniqueStrings((existing.maintenanceAssignees ?? []).map((a) => a.userId));

    const assignees = await loadMaintenanceRequestAssignees();
    const locationFallbackIds = uniqueStrings(assignees.filter((a) => a.locationId === existing.location.id).map((a) => a.userId));
    const recipientIds = requestAssigneeIds.length > 0 ? requestAssigneeIds : locationFallbackIds;

    if (recipientIds.length > 0) {
      await createNotificationForUsers({
        userIds: recipientIds,
        type: "SYSTEM",
        title: `Reminder: maintenance request - ${existing.location.name}`,
        body: `${existing.title} is currently ${existing.status.toLowerCase()}. Please review in the maintenance request queue.`,
        href: "/maintenance-requests",
        requiredPermission: RECEIVE_NOTIFICATION_MAINTENANCE_REQUESTS,
      });
    }

    await db.auditLog.create({
      data: {
        actorUserId: actor.id,
        module: "MAINTENANCE_REQUESTS",
        action: "ADMIN_RESEND_REQUEST_NOTIFICATION",
        entityType: "MaintenanceRequest",
        entityId: existing.id,
        message: `Admin resent maintenance request notification: ${existing.title}`,
        metadata: {
          locationId: existing.location.id,
          locationName: existing.location.name,
          recipientIds,
          recipientCount: recipientIds.length,
        },
      },
    });

    revalidatePath("/admin/maintenance-requests");
    revalidatePath("/maintenance-requests");
    revalidatePath("/notifications");
    redirect("/admin/maintenance-requests?resent=1");
  }

  async function updateAssigneeAction(formData: FormData) {
    "use server";

    const session = await requireAdmin();
    const email = String(session.user?.email ?? "").trim().toLowerCase();
    if (!email) redirect("/login");

    const actor = await db.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!actor || !actor.active) redirect("/login");

    const requestId = String(formData.get("requestId") ?? "").trim();
    const selectedUserIds = uniqueStrings(formData.getAll("assignedUserIds").map((x) => String(x ?? "").trim()));
    if (!requestId) redirect("/admin/maintenance-requests");

    const existing = await db.maintenanceRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        title: true,
        status: true,
        location: { select: { id: true, name: true } },
        assignedMaintenanceUserId: true,
        maintenanceAssignees: { select: { userId: true } },
      },
    });
    if (!existing) redirect("/admin/maintenance-requests");

    const assignees = await loadMaintenanceRequestAssignees();
    const validIds = new Set(assignees.filter((a) => a.locationId === existing.location.id).map((a) => a.userId));

    const nextAssignedUserIds = selectedUserIds.filter((id) => validIds.has(id));
    if (nextAssignedUserIds.length !== selectedUserIds.length) {
      redirect("/admin/maintenance-requests?error=" + encodeURIComponent("One or more selected assignees are not valid for this location."));
    }

    const nextAssignedUserId = nextAssignedUserIds[0] ?? null;
    const previousAssignedUserIds = uniqueStrings((existing.maintenanceAssignees ?? []).map((a) => a.userId));
    const newlyAddedUserIds = nextAssignedUserIds.filter((id) => !previousAssignedUserIds.includes(id));

    await db.maintenanceRequest.update({
      where: { id: existing.id },
      data: {
        assignedMaintenanceUserId: nextAssignedUserId,
        maintenanceAssignees: {
          deleteMany: { requestId: existing.id },
          ...(nextAssignedUserIds.length > 0 ? { createMany: { data: nextAssignedUserIds.map((userId) => ({ userId })) } } : {}),
        },
      },
    });

    await db.auditLog.create({
      data: {
        actorUserId: actor.id,
        module: "MAINTENANCE_REQUESTS",
        action: "ADMIN_UPDATE_REQUEST_ASSIGNEE",
        entityType: "MaintenanceRequest",
        entityId: existing.id,
        message: `Admin updated assignee for maintenance request: ${existing.title}`,
        metadata: {
          locationId: existing.location.id,
          locationName: existing.location.name,
          previousAssignedUserId: existing.assignedMaintenanceUserId ?? null,
          nextAssignedUserId,
          previousAssignedUserIds,
          nextAssignedUserIds,
        },
      },
    });

    if (newlyAddedUserIds.length > 0) {
      await createNotificationForUsers({
        userIds: newlyAddedUserIds,
        type: "SYSTEM",
        title: `Assigned maintenance request - ${existing.location.name}`,
        body: `${existing.title} has been assigned to you by admin.`,
        href: "/maintenance-requests",
        requiredPermission: RECEIVE_NOTIFICATION_MAINTENANCE_REQUESTS,
      });
    }

    revalidatePath("/admin/maintenance-requests");
    revalidatePath("/maintenance-requests");
    revalidatePath("/notifications");
    redirect("/admin/maintenance-requests?updated=1");
  }

  const assignees = await loadMaintenanceRequestAssignees();
  const assigneesByLocation = new Map<
    string,
    Array<{ userId: string; userName: string; userEmail: string }>
  >();
  for (const row of assignees) {
    const arr = assigneesByLocation.get(row.locationId) ?? [];
    if (!arr.find((x) => x.userId === row.userId)) {
      arr.push({ userId: row.userId, userName: row.userName, userEmail: row.userEmail });
      assigneesByLocation.set(row.locationId, arr);
    }
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
      maintenanceAssignees: { select: { userId: true, user: { select: { id: true, name: true, email: true } } } },
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

        {archived ? (
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "color-mix(in srgb, #087c3e 14%, var(--surface))", padding: 10, fontWeight: 700 }}>
            Request resolved and archived.
          </div>
        ) : null}
        {updated ? (
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "color-mix(in srgb, #087c3e 14%, var(--surface))", padding: 10, fontWeight: 700 }}>
            Request assignee updated.
          </div>
        ) : null}
        {resent ? (
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "color-mix(in srgb, #087c3e 14%, var(--surface))", padding: 10, fontWeight: 700 }}>
            Notification resent to assigned users.
          </div>
        ) : null}
        {errorText ? (
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "color-mix(in srgb, #b00020 12%, var(--surface))", padding: 10, fontWeight: 700 }}>
            {errorText}
          </div>
        ) : null}

        <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", padding: 12, display: "grid", gap: 10 }}>
          {rows.length === 0 ? <div style={{ padding: 14, opacity: 0.8 }}>No requests yet.</div> : null}

          {rows.map((row) => {
            const locationAssignees = assigneesByLocation.get(row.location.id) ?? [];
            const assignedUsers = row.maintenanceAssignees.map((x) => x.user);
            const assignedLabel =
              assignedUsers.length > 0
                ? assignedUsers.map((u) => personLabel(u)).join(", ")
                : personLabel(row.assignedMaintenanceUser);
            const assignedUserIdSet = new Set(row.maintenanceAssignees.map((x) => x.userId));
            return (
              <article
                key={row.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  background: "color-mix(in srgb, var(--surface-2) 35%, transparent)",
                  padding: 12,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 700 }}>Status</div>
                    <div style={{ fontWeight: 900 }}>{row.status}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 700 }}>Requested</div>
                    <div>{fmtDateTime(row.createdAt)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 700 }}>Store</div>
                    <div style={{ fontWeight: 800 }}>{row.location.name}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 700 }}>Requester</div>
                    <div>{personLabel(row.requestedByUser)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 700 }}>Assigned Tech</div>
                    <div>{assignedLabel}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 700 }}>Resolved</div>
                    <div>{fmtDateTime(row.resolvedAt)}</div>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 700 }}>Issue</div>
                  <div style={{ marginTop: 2, fontWeight: 800 }}>{row.title}</div>
                  <div style={{ marginTop: 4, opacity: 0.9 }}>{row.description}</div>
                  {row.resolutionNotes ? <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>Resolution: {row.resolutionNotes}</div> : null}
                </div>

                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", alignItems: "start" }}>
                  <form action={updateAssigneeAction} style={{ display: "grid", gap: 6 }}>
                    <input type="hidden" name="requestId" value={row.id} />
                    <fieldset style={{ margin: 0, padding: 8, border: "1px solid var(--border)", borderRadius: 8, display: "grid", gap: 6 }}>
                      <legend style={{ padding: "0 6px", fontSize: 12, opacity: 0.8 }}>Assign tech(s)</legend>
                      {locationAssignees.length === 0 ? (
                        <span style={{ fontSize: 12, opacity: 0.7 }}>No eligible techs for this location.</span>
                      ) : (
                        locationAssignees.map((assignee) => (
                          <label key={`${row.id}-${assignee.userId}`} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                            <input
                              type="checkbox"
                              name="assignedUserIds"
                              value={assignee.userId}
                              defaultChecked={assignedUserIdSet.has(assignee.userId)}
                            />
                            <span>{assignee.userName || assignee.userEmail}</span>
                          </label>
                        ))
                      )}
                    </fieldset>
                    <button
                      type="submit"
                      style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface-2)", padding: "8px 10px", fontWeight: 800, cursor: "pointer" }}
                    >
                      Update Assignees
                    </button>
                  </form>

                  <form action={resendNotificationAction} style={{ alignSelf: "end" }}>
                    <input type="hidden" name="requestId" value={row.id} />
                    <button
                      type="submit"
                      style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface-2)", padding: "8px 10px", fontWeight: 800, cursor: "pointer" }}
                    >
                      Resend Notification
                    </button>
                  </form>

                  {row.status === "OPEN" ? (
                    <form action={archiveAction} style={{ display: "grid", gap: 6 }}>
                      <input type="hidden" name="requestId" value={row.id} />
                      <input name="resolutionNotes" placeholder="Resolution notes" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", width: "100%" }} />
                      <button type="submit" style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface-2)", padding: "8px 10px", fontWeight: 800, cursor: "pointer" }}>
                        Resolve & Archive
                      </button>
                    </form>
                  ) : (
                    <div style={{ alignSelf: "end", opacity: 0.7, fontSize: 12 }}>Closed</div>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
