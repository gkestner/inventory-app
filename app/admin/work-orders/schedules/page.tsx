import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { RECEIVE_NOTIFICATION_WORK_ORDER_SCHEDULES } from "@/app/lib/permission-constants";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { createAuditLog, createNotification, getCompatDb } from "@/app/lib/workflow-foundations";

export const dynamic = "force-dynamic";

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

async function requireAdmin() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");
  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.ADMIN_VIEW_WORK_ORDERS, Permission.ADMIN_EDIT_WORK_ORDERS])) {
    redirect("/");
  }
  return session;
}

function toInt(v: FormDataEntryValue | null, fallback: number): number {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

export default async function WorkOrderSchedulesPage() {
  const session = await requireAdmin();

  const actorEmail = (session.user?.email ?? "").trim().toLowerCase();
  const actor = await (getCompatDb() as any).user.findUnique({ where: { email: actorEmail }, select: { id: true } });
  if (!actor?.id) redirect("/login");

  async function createScheduleAction(formData: FormData) {
    "use server";

    const session = await requireAdmin();
    const actorEmail = (session.user?.email ?? "").trim().toLowerCase();
    const actor = await (getCompatDb() as any).user.findUnique({ where: { email: actorEmail }, select: { id: true } });
    if (!actor?.id) redirect("/login");

    const title = String(formData.get("title") ?? "").trim();
    const locationId = String(formData.get("locationId") ?? "").trim();
    const defaultUserId = String(formData.get("defaultUserId") ?? "").trim() || null;
    const intervalDays = toInt(formData.get("intervalDays"), 30);
    const description = String(formData.get("description") ?? "").trim() || null;

    if (!title || !locationId) throw new Error("Title and location are required.");

    const db = getCompatDb();
    if (!db.pmSchedule?.create) {
      throw new Error("PM scheduler table not available. Run latest migrations.");
    }

    await db.pmSchedule.create({
      data: {
        title,
        description,
        locationId,
        defaultUserId,
        intervalDays,
        createdByUserId: actor.id,
        nextDueAt: addDays(new Date(), intervalDays),
      },
    });

    await createAuditLog({
      actorUserId: actor.id,
      module: "pm-scheduler",
      action: "create",
      entityType: "PmSchedule",
      message: `Created PM schedule ${title}`,
    });

    redirect("/admin/work-orders/schedules");
  }

  async function runDueNowAction() {
    "use server";

    const session = await requireAdmin();
    const actorEmail = (session.user?.email ?? "").trim().toLowerCase();
    const actor = await (getCompatDb() as any).user.findUnique({ where: { email: actorEmail }, select: { id: true } });
    if (!actor?.id) redirect("/login");

    const db = getCompatDb();
    if (!db.pmSchedule?.findMany) {
      throw new Error("PM scheduler table not available. Run latest migrations.");
    }

    const due = await db.pmSchedule.findMany({ where: { active: true, nextDueAt: { lte: new Date() } }, take: 200 });

    for (const s of due) {
      const wo = await (getCompatDb() as any).workOrder.create({
        data: {
          status: "DRAFT",
          locationId: s.locationId,
          createdByUserId: s.defaultUserId || actor.id,
          updatedByUserId: actor.id,
          startTime: null,
          notes: `[PM] ${s.title}${s.description ? ` - ${s.description}` : ""}`,
        },
        select: { id: true, createdByUserId: true },
      });

      await db.pmSchedule.update({
        where: { id: s.id },
        data: { lastGeneratedAt: new Date(), nextDueAt: addDays(new Date(), s.intervalDays) },
      });

      await createNotification({
        userId: wo.createdByUserId,
        type: "SCHEDULER",
        title: `PM Work Order Generated: ${s.title}`,
        body: "A recurring PM work order was generated for your queue.",
        href: `/maintenance/work-orders/${wo.id}`,
        requiredPermission: RECEIVE_NOTIFICATION_WORK_ORDER_SCHEDULES,
      });
    }

    await createAuditLog({
      actorUserId: actor.id,
      module: "pm-scheduler",
      action: "generate-due",
      entityType: "PmSchedule",
      message: `Generated ${due.length} due PM work orders`,
    });

    redirect("/admin/work-orders/schedules");
  }

  const [locations, users] = await Promise.all([
    (getCompatDb() as any).location.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    (getCompatDb() as any).user.findMany({ where: { active: true }, orderBy: [{ name: "asc" }], select: { id: true, name: true, email: true } }),
  ]);

  const db = getCompatDb();
  const schedules = db.pmSchedule?.findMany
    ? await db.pmSchedule.findMany({
        orderBy: { nextDueAt: "asc" },
        include: {
          location: { select: { name: true } },
          defaultUser: { select: { name: true, email: true } },
        },
      })
    : [];

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Work Order PM Scheduler</h1>
          <Link href="/admin/work-orders" style={{ textDecoration: "none", fontWeight: 800 }}>
            Back to Work Orders
          </Link>
          <form action={runDueNowAction} style={{ marginLeft: "auto" }}>
            <button type="submit" style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", fontWeight: 800 }}>
              Generate Due Now
            </button>
          </form>
        </div>

        <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
          <h2 style={{ marginTop: 0 }}>Add PM Schedule</h2>
          <form action={createScheduleAction} style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <input name="title" placeholder="Schedule title" required />
              <select name="locationId" required defaultValue={locations[0]?.id ?? ""}>
                {locations.map((l: any) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <select name="defaultUserId" defaultValue="">
                <option value="">Assign at generation time</option>
                {users.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                <span style={{ whiteSpace: "nowrap" }}>Repeat every</span>
                <input name="intervalDays" type="number" min={1} defaultValue={30} style={{ width: 90 }} />
                <span style={{ whiteSpace: "nowrap" }}>days</span>
              </label>
              <input name="description" placeholder="Optional description" />
            </div>
            <button type="submit" style={{ width: 200, padding: "9px 12px", borderRadius: 10, border: "1px solid var(--border)", fontWeight: 800 }}>
              Save Schedule
            </button>
          </form>
        </section>

        <section style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {[
                  "Title",
                  "Location",
                  "Assigned User",
                  "Interval (days)",
                  "Next Due",
                  "Last Generated",
                  "Active",
                ].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedules.map((s: any) => (
                <tr key={s.id}>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{s.title}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{s.location?.name ?? "-"}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
                    {s.defaultUser ? `${s.defaultUser.name} (${s.defaultUser.email})` : "-"}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{s.intervalDays}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{new Date(s.nextDueAt).toLocaleString()}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
                    {s.lastGeneratedAt ? new Date(s.lastGeneratedAt).toLocaleString() : "-"}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{s.active ? "Yes" : "No"}</td>
                </tr>
              ))}
              {schedules.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 12, opacity: 0.75 }}>
                    No schedules yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
