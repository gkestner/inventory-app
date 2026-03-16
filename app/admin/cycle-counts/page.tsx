import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { RECEIVE_NOTIFICATION_CYCLE_COUNTS } from "@/app/lib/permission-constants";
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
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS])) {
    redirect("/");
  }
  return session;
}

export default async function CycleCountsPage() {
  const session = await requireAdmin();

  const actorEmail = (session.user?.email ?? "").trim().toLowerCase();
  const actor = await (getCompatDb() as any).user.findUnique({ where: { email: actorEmail }, select: { id: true } });
  if (!actor?.id) redirect("/login");

  async function createSessionAction(formData: FormData) {
    "use server";

    const session = await requireAdmin();
    const actorEmail = (session.user?.email ?? "").trim().toLowerCase();
    const actor = await (getCompatDb() as any).user.findUnique({ where: { email: actorEmail }, select: { id: true } });
    if (!actor?.id) redirect("/login");

    const name = String(formData.get("name") ?? "").trim();
    const locationId = String(formData.get("locationId") ?? "").trim();
    if (!name || !locationId) throw new Error("Name and location are required.");

    const db = getCompatDb();
    if (!db.cycleCountSession?.create) throw new Error("Cycle count table unavailable. Run latest migrations.");

    await db.cycleCountSession.create({
      data: {
        name,
        locationId,
        createdByUserId: actor.id,
      },
    });

    await createAuditLog({
      actorUserId: actor.id,
      module: "cycle-count",
      action: "create-session",
      entityType: "CycleCountSession",
      message: `Created cycle count session ${name}`,
    });

    redirect("/admin/cycle-counts");
  }

  async function saveCountAction(formData: FormData) {
    "use server";

    const session = await requireAdmin();
    const actorEmail = (session.user?.email ?? "").trim().toLowerCase();
    const actor = await (getCompatDb() as any).user.findUnique({ where: { email: actorEmail }, select: { id: true } });
    if (!actor?.id) redirect("/login");

    const sessionId = String(formData.get("sessionId") ?? "").trim();
    const itemId = String(formData.get("itemId") ?? "").trim();
    const expectedQty = Number(String(formData.get("expectedQty") ?? "0"));
    const countedQty = Number(String(formData.get("countedQty") ?? "0"));
    const notes = String(formData.get("notes") ?? "").trim() || null;

    if (!sessionId || !itemId) throw new Error("Missing cycle count target.");

    const varianceQty = Number.isFinite(expectedQty) && Number.isFinite(countedQty) ? countedQty - expectedQty : 0;

    const db = getCompatDb();
    if (!db.cycleCountItem?.upsert) throw new Error("Cycle count item table unavailable. Run latest migrations.");

    await db.cycleCountItem.upsert({
      where: { sessionId_itemId: { sessionId, itemId } },
      update: { expectedQty, countedQty, varianceQty, notes },
      create: { sessionId, itemId, expectedQty, countedQty, varianceQty, notes },
    });

    if (varianceQty !== 0) {
      await createNotification({
        userId: actor.id,
        type: "CYCLE_COUNT",
        title: "Cycle count variance detected",
        body: `Variance ${varianceQty} saved for an item in active count session.`,
        href: "/admin/cycle-counts",
        requiredPermission: RECEIVE_NOTIFICATION_CYCLE_COUNTS,
      });
    }

    await createAuditLog({
      actorUserId: actor.id,
      module: "cycle-count",
      action: "save-line",
      entityType: "CycleCountItem",
      entityId: `${sessionId}:${itemId}`,
      message: `Saved cycle count line (variance ${varianceQty})`,
    });

    redirect("/admin/cycle-counts");
  }

  const [locations, sessions, items] = await Promise.all([
    (getCompatDb() as any).location.findMany({
      where: { active: true, receiptEnabled: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getCompatDb().cycleCountSession?.findMany
      ? getCompatDb().cycleCountSession!.findMany({
          orderBy: { createdAt: "desc" },
          include: { location: { select: { name: true } }, createdByUser: { select: { name: true } } },
          take: 30,
        })
      : [],
    (getCompatDb() as any).item.findMany({ where: { active: true }, orderBy: { name: "asc" }, take: 300, select: { id: true, name: true, onHandQty: true } }),
  ]);

  const activeSession = sessions.find((s: any) => s.status === "OPEN") || null;
  const activeLines = activeSession && getCompatDb().cycleCountItem?.findMany
    ? await getCompatDb().cycleCountItem!.findMany({ where: { sessionId: activeSession.id }, include: { item: { select: { name: true } } }, orderBy: { createdAt: "desc" } })
    : [];

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Cycle Counts</h1>

        <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
          <h2 style={{ marginTop: 0 }}>Start New Session</h2>
          <form action={createSessionAction} style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input name="name" placeholder="Session name" required />
              <select name="locationId" defaultValue={locations[0]?.id ?? ""} required>
                {locations.map((l: any) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <button type="submit" style={{ width: 180, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", fontWeight: 800 }}>
              Create Session
            </button>
          </form>
        </section>

        {activeSession ? (
          <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
            <h2 style={{ marginTop: 0 }}>Active Session: {activeSession.name}</h2>
            <form action={saveCountAction} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="sessionId" value={activeSession.id} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px 1fr", gap: 10 }}>
                <select name="itemId" defaultValue={items[0]?.id ?? ""}>
                  {items.map((it: any) => (
                    <option key={it.id} value={it.id}>{it.name}</option>
                  ))}
                </select>
                <input name="expectedQty" type="number" placeholder="Expected" required />
                <input name="countedQty" type="number" placeholder="Counted" required />
                <input name="notes" placeholder="Notes (optional)" />
              </div>
              <button type="submit" style={{ width: 180, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", fontWeight: 800 }}>
                Save Count Line
              </button>
            </form>

            <div style={{ marginTop: 10, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Item", "Expected", "Counted", "Variance", "Notes"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeLines.map((ln: any) => (
                    <tr key={ln.id}>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{ln.item?.name ?? ln.itemId}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{ln.expectedQty}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{ln.countedQty}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)", fontWeight: 900 }}>{ln.varianceQty}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{ln.notes ?? "-"}</td>
                    </tr>
                  ))}
                  {activeLines.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: 8, opacity: 0.75 }}>No lines yet.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Session", "Location", "Created By", "Status", "Created"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((s: any) => (
                <tr key={s.id}>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{s.name}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{s.location?.name ?? "-"}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{s.createdByUser?.name ?? "-"}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{s.status}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{new Date(s.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {sessions.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 10, opacity: 0.75 }}>No cycle counts yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
