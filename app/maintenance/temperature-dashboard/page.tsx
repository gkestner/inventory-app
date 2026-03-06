import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { canAccessAdmin } from "@/app/lib/admin-access";
import { loadMaintenancePrimaryAssignments } from "@/app/lib/preventative-maintenance";

export const dynamic = "force-dynamic";

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type HubRow = {
  id: string;
  name: string;
  externalHubId: string;
  active: boolean;
  minTempF: unknown;
  maxTempF: unknown;
  lastReadingAt: Date | null;
  lastTempF: unknown;
  lastAlertState: "NORMAL" | "HIGH" | "LOW" | "UNKNOWN" | null;
  location: { id: string; name: string } | null;
  assignedMaintenanceUser: { id: string; name: string | null; email: string | null } | null;
  recipients: Array<{ user: { id: string; name: string | null; email: string | null } }>;
  devices: Array<{
    id: string;
    name: string;
    externalDeviceId: string;
    lastReadingAt: Date | null;
    lastTempF: unknown;
    lastAlertState: "NORMAL" | "HIGH" | "LOW" | "UNKNOWN" | null;
    lastBatteryPct: number | null;
  }>;
};

type AlertRow = {
  id: string;
  recordedAt: Date;
  tempF: unknown;
  alertState: "HIGH" | "LOW" | "NORMAL" | "UNKNOWN";
  hub: { id: string; name: string; location: { name: string } | null };
  device: { name: string } | null;
};

type Db = {
  user: {
    findUnique: (args: unknown) => Promise<{ id: string; active: boolean } | null>;
    findMany: (args: unknown) => Promise<Array<{ id: string; name: string | null; email: string | null }>>;
  };
  location: {
    findMany: (args: unknown) => Promise<Array<{ id: string; name: string }>>;
  };
  mocreoHub: {
    findMany: (args: unknown) => Promise<HubRow[]>;
    create: (args: unknown) => Promise<{ id: string }>;
    update: (args: unknown) => Promise<{ id: string }>;
    findUnique: (args: unknown) => Promise<{ id: string; active: boolean } | null>;
  };
  mocreoHubRecipient: {
    deleteMany: (args: unknown) => Promise<unknown>;
    createMany: (args: unknown) => Promise<unknown>;
  };
  mocreoTemperatureReading: {
    findMany: (args: unknown) => Promise<AlertRow[]>;
  };
  auditLog: {
    create: (args: unknown) => Promise<unknown>;
  };
};

const db = prisma as unknown as Db;

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function personLabel(user: { name: string | null; email: string | null } | null | undefined): string {
  if (!user) return "Unassigned";
  return String(user.name ?? "").trim() || String(user.email ?? "").trim() || "Unknown";
}

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

function parseTempInput(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

export default async function TemperatureDashboardPage() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");

  const email = String(session.user?.email ?? "").trim().toLowerCase();
  if (!email) redirect("/login");

  const me = await db.user.findUnique({ where: { email }, select: { id: true, active: true } });
  if (!me || !me.active) redirect("/login");

  const isAdmin = await canAccessAdmin(session);

  async function saveHubAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    if (!session) redirect("/login");
    if (!(await canAccessAdmin(session))) redirect("/");

    const email = String(session.user?.email ?? "").trim().toLowerCase();
    if (!email) redirect("/login");
    const actor = await db.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!actor || !actor.active) redirect("/login");

    const hubId = String(formData.get("hubId") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const externalHubId = String(formData.get("externalHubId") ?? "").trim();
    const locationIdRaw = String(formData.get("locationId") ?? "").trim();
    const assignedMaintenanceUserIdRaw = String(formData.get("assignedMaintenanceUserId") ?? "").trim();
    const notifyUserIds = formData
      .getAll("notifyUserIds")
      .map((v) => String(v ?? "").trim())
      .filter(Boolean);

    const minTempF = parseTempInput(formData.get("minTempF"));
    const maxTempF = parseTempInput(formData.get("maxTempF"));

    if (!name || !externalHubId) {
      redirect("/maintenance/temperature-dashboard?error=missing");
    }

    if (minTempF !== null && maxTempF !== null && minTempF >= maxTempF) {
      redirect("/maintenance/temperature-dashboard?error=range");
    }

    const locationId = locationIdRaw || null;
    let assignedMaintenanceUserId = assignedMaintenanceUserIdRaw || null;

    if (!hubId && !assignedMaintenanceUserId && locationId) {
      const assignments = await loadMaintenancePrimaryAssignments();
      assignedMaintenanceUserId = assignments.find((a) => a.locationId === locationId)?.userId ?? null;
    }

    const saved = hubId
      ? await db.mocreoHub.update({
          where: { id: hubId },
          data: {
            name,
            externalHubId,
            locationId,
            assignedMaintenanceUserId,
            minTempF,
            maxTempF,
          },
          select: { id: true },
        })
      : await db.mocreoHub.create({
          data: {
            name,
            externalHubId,
            locationId,
            assignedMaintenanceUserId,
            minTempF,
            maxTempF,
            active: true,
          },
          select: { id: true },
        });

    await db.mocreoHubRecipient.deleteMany({ where: { hubId: saved.id } });

    if (notifyUserIds.length > 0) {
      await db.mocreoHubRecipient.createMany({
        data: notifyUserIds.map((userId) => ({ hubId: saved.id, userId })),
        skipDuplicates: true,
      });
    }

    await db.auditLog.create({
      data: {
        actorUserId: actor.id,
        module: "MOCREO_TEMPERATURE",
        action: hubId ? "UPDATE_HUB_CONFIG" : "CREATE_HUB_CONFIG",
        entityType: "MocreoHub",
        entityId: saved.id,
        message: `${hubId ? "Updated" : "Created"} Mocreo hub ${name}.`,
      },
    });

    revalidatePath("/maintenance/temperature-dashboard");
    redirect("/maintenance/temperature-dashboard?saved=1");
  }

  async function toggleHubAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    if (!session) redirect("/login");
    if (!(await canAccessAdmin(session))) redirect("/");

    const email = String(session.user?.email ?? "").trim().toLowerCase();
    if (!email) redirect("/login");
    const actor = await db.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!actor || !actor.active) redirect("/login");

    const hubId = String(formData.get("hubId") ?? "").trim();
    if (!hubId) redirect("/maintenance/temperature-dashboard");

    const existing = await db.mocreoHub.findUnique({ where: { id: hubId }, select: { id: true, active: true } });
    if (!existing) redirect("/maintenance/temperature-dashboard");

    await db.mocreoHub.update({ where: { id: hubId }, data: { active: !existing.active }, select: { id: true } });

    await db.auditLog.create({
      data: {
        actorUserId: actor.id,
        module: "MOCREO_TEMPERATURE",
        action: existing.active ? "DEACTIVATE_HUB" : "ACTIVATE_HUB",
        entityType: "MocreoHub",
        entityId: hubId,
        message: `${existing.active ? "Deactivated" : "Activated"} Mocreo hub.`,
      },
    });

    revalidatePath("/maintenance/temperature-dashboard");
    redirect("/maintenance/temperature-dashboard");
  }

  const [users, locations, hubs, recentAlerts] = await Promise.all([
    db.user.findMany({
      where: { active: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true },
    }),
    db.location.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.mocreoHub.findMany({
      where: isAdmin
        ? {}
        : {
            OR: [{ assignedMaintenanceUserId: me.id }, { recipients: { some: { userId: me.id } } }],
          },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        externalHubId: true,
        active: true,
        minTempF: true,
        maxTempF: true,
        lastReadingAt: true,
        lastTempF: true,
        lastAlertState: true,
        location: { select: { id: true, name: true } },
        assignedMaintenanceUser: { select: { id: true, name: true, email: true } },
        recipients: { select: { user: { select: { id: true, name: true, email: true } } } },
        devices: {
          orderBy: [{ lastReadingAt: "desc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            externalDeviceId: true,
            lastReadingAt: true,
            lastTempF: true,
            lastAlertState: true,
            lastBatteryPct: true,
          },
        },
      },
    }),
    db.mocreoTemperatureReading.findMany({
      where: {
        alertState: { in: ["HIGH", "LOW"] },
        hub: isAdmin
          ? undefined
          : {
              OR: [{ assignedMaintenanceUserId: me.id }, { recipients: { some: { userId: me.id } } }],
            },
      },
      orderBy: { recordedAt: "desc" },
      take: 120,
      select: {
        id: true,
        recordedAt: true,
        tempF: true,
        alertState: true,
        hub: { select: { id: true, name: true, location: { select: { name: true } } } },
        device: { select: { name: true } },
      },
    }),
  ]);

  const statusMessage = isAdmin
    ? "This dashboard lets you register Mocreo hubs, assign the maintenance tech, and add extra notification recipients."
    : "This dashboard shows your assigned hubs and any alerts where you are a recipient.";

  return (
    <main>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 12 }}>
        <section
          style={{
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: 18,
            background:
              "linear-gradient(150deg, color-mix(in srgb, var(--brand) 14%, var(--surface)) 0%, var(--surface) 70%)",
            boxShadow: "var(--shadow)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 950 }}>Mocreo Temperature Dashboard</h1>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>{statusMessage}</p>
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <code>POST /api/integrations/mocreo/webhook</code>
            <span style={{ fontSize: 12, opacity: 0.8 }}>
              Optional security header: <code>x-mocreo-token</code> = <code>MOCREO_WEBHOOK_TOKEN</code>
            </span>
            <Link href="/notifications" style={{ textDecoration: "none", fontWeight: 800 }}>
              {"Notifications ->"}
            </Link>
          </div>
        </section>

        {isAdmin ? (
          <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", padding: 14 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 900 }}>Register / Update Hub</h2>
            <form action={saveHubAction} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="hubId" value="" />

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 800 }}>Hub Name</span>
                  <input name="name" required placeholder="Example: Walk-In Freezer Hub" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)" }} />
                </label>

                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 800 }}>Mocreo Hub ID</span>
                  <input name="externalHubId" required placeholder="Hub external id from Mocreo" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)" }} />
                </label>

                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 800 }}>Store Location</span>
                  <select name="locationId" defaultValue="" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)" }}>
                    <option value="">No location</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 800 }}>Associated Maintenance Tech</span>
                  <select name="assignedMaintenanceUserId" defaultValue="" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)" }}>
                    <option value="">Auto from primary location</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {personLabel(u)}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 800 }}>Min Temp (F)</span>
                  <input name="minTempF" type="number" step="0.1" placeholder="34" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)" }} />
                </label>

                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 800 }}>Max Temp (F)</span>
                  <input name="maxTempF" type="number" step="0.1" placeholder="42" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)" }} />
                </label>
              </div>

              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontWeight: 800 }}>Additional Recipients</span>
                <select name="notifyUserIds" multiple size={7} style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)", minHeight: 140 }}>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {personLabel(u)}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: 12, opacity: 0.8 }}>
                  Hold Ctrl/Cmd to multi-select. These users get the same alert notifications as the associated maintenance tech.
                </span>
              </label>

              <button type="submit" style={{ width: "fit-content", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", cursor: "pointer", fontWeight: 900, background: "linear-gradient(160deg, var(--brand-2) 0%, var(--brand) 100%)", color: "var(--brand-contrast)" }}>
                Save Hub Configuration
              </button>
            </form>
          </section>
        ) : null}

        <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", overflow: "hidden" }}>
          <div style={{ padding: 14, borderBottom: "1px solid var(--border)" }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Hub Dashboard</h2>
          </div>
          {hubs.length === 0 ? (
            <div style={{ padding: 14, opacity: 0.8 }}>No hubs configured yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 10, padding: 12 }}>
              {hubs.map((hub) => {
                const recipientLabels = hub.recipients.map((r) => personLabel(r.user));
                const min = toNumberOrNull(hub.minTempF);
                const max = toNumberOrNull(hub.maxTempF);
                const lastTemp = toNumberOrNull(hub.lastTempF);

                return (
                  <article key={hub.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface-2)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>
                          {hub.name} {hub.active ? "" : "(Inactive)"}
                        </h3>
                        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                          Hub ID: <code>{hub.externalHubId}</code>
                        </div>
                      </div>
                      {isAdmin ? (
                        <form action={toggleHubAction}>
                          <input type="hidden" name="hubId" value={hub.id} />
                          <button type="submit" style={{ padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", cursor: "pointer", fontWeight: 800 }}>
                            {hub.active ? "Deactivate" : "Activate"}
                          </button>
                        </form>
                      ) : null}
                    </div>

                    <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, fontSize: 13 }}>
                      <div>
                        <strong>Store:</strong> {hub.location?.name ?? "-"}
                      </div>
                      <div>
                        <strong>Assigned Maintenance:</strong> {personLabel(hub.assignedMaintenanceUser)}
                      </div>
                      <div>
                        <strong>Thresholds:</strong> {min === null ? "-" : `${min}F`} to {max === null ? "-" : `${max}F`}
                      </div>
                      <div>
                        <strong>Last Reading:</strong> {lastTemp === null ? "-" : `${lastTemp.toFixed(1)}F`} ({fmtDateTime(hub.lastReadingAt)})
                      </div>
                      <div>
                        <strong>Last Alert State:</strong> {hub.lastAlertState ?? "UNKNOWN"}
                      </div>
                      <div>
                        <strong>Extra Recipients:</strong> {recipientLabels.length ? recipientLabels.join(", ") : "None"}
                      </div>
                    </div>

                    <div style={{ marginTop: 10, overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid var(--border)" }}>
                            <th style={{ textAlign: "left", padding: "6px 4px", fontSize: 12 }}>Device</th>
                            <th style={{ textAlign: "left", padding: "6px 4px", fontSize: 12 }}>Device ID</th>
                            <th style={{ textAlign: "left", padding: "6px 4px", fontSize: 12 }}>Last Temp</th>
                            <th style={{ textAlign: "left", padding: "6px 4px", fontSize: 12 }}>Alert</th>
                            <th style={{ textAlign: "left", padding: "6px 4px", fontSize: 12 }}>Battery</th>
                            <th style={{ textAlign: "left", padding: "6px 4px", fontSize: 12 }}>Last Seen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hub.devices.map((device) => {
                            const dTemp = toNumberOrNull(device.lastTempF);
                            return (
                              <tr key={device.id} style={{ borderBottom: "1px solid var(--border)" }}>
                                <td style={{ padding: "6px 4px" }}>{device.name}</td>
                                <td style={{ padding: "6px 4px", fontFamily: "monospace", fontSize: 12 }}>{device.externalDeviceId}</td>
                                <td style={{ padding: "6px 4px" }}>{dTemp === null ? "-" : `${dTemp.toFixed(1)}F`}</td>
                                <td style={{ padding: "6px 4px", fontWeight: 800 }}>{device.lastAlertState ?? "UNKNOWN"}</td>
                                <td style={{ padding: "6px 4px" }}>{device.lastBatteryPct === null ? "-" : `${device.lastBatteryPct}%`}</td>
                                <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{fmtDateTime(device.lastReadingAt)}</td>
                              </tr>
                            );
                          })}
                          {hub.devices.length === 0 ? (
                            <tr>
                              <td colSpan={6} style={{ padding: "8px 4px", opacity: 0.8 }}>
                                No readings have been received yet for this hub.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>

                    {isAdmin ? (
                      <details style={{ marginTop: 10 }}>
                        <summary style={{ cursor: "pointer", fontWeight: 800 }}>Edit Hub Settings</summary>
                        <form action={saveHubAction} style={{ display: "grid", gap: 8, marginTop: 8 }}>
                          <input type="hidden" name="hubId" value={hub.id} />

                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
                            <label style={{ display: "grid", gap: 4 }}>
                              <span style={{ fontWeight: 700 }}>Hub Name</span>
                              <input
                                name="name"
                                required
                                defaultValue={hub.name}
                                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)" }}
                              />
                            </label>

                            <label style={{ display: "grid", gap: 4 }}>
                              <span style={{ fontWeight: 700 }}>Mocreo Hub ID</span>
                              <input
                                name="externalHubId"
                                required
                                defaultValue={hub.externalHubId}
                                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)" }}
                              />
                            </label>

                            <label style={{ display: "grid", gap: 4 }}>
                              <span style={{ fontWeight: 700 }}>Store</span>
                              <select
                                name="locationId"
                                defaultValue={hub.location?.id ?? ""}
                                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)" }}
                              >
                                <option value="">No location</option>
                                {locations.map((loc) => (
                                  <option key={loc.id} value={loc.id}>
                                    {loc.name}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label style={{ display: "grid", gap: 4 }}>
                              <span style={{ fontWeight: 700 }}>Associated Maintenance Tech</span>
                              <select
                                name="assignedMaintenanceUserId"
                                defaultValue={hub.assignedMaintenanceUser?.id ?? ""}
                                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)" }}
                              >
                                <option value="">None</option>
                                {users.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {personLabel(u)}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label style={{ display: "grid", gap: 4 }}>
                              <span style={{ fontWeight: 700 }}>Min Temp (F)</span>
                              <input
                                name="minTempF"
                                type="number"
                                step="0.1"
                                defaultValue={toNumberOrNull(hub.minTempF) ?? ""}
                                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)" }}
                              />
                            </label>

                            <label style={{ display: "grid", gap: 4 }}>
                              <span style={{ fontWeight: 700 }}>Max Temp (F)</span>
                              <input
                                name="maxTempF"
                                type="number"
                                step="0.1"
                                defaultValue={toNumberOrNull(hub.maxTempF) ?? ""}
                                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)" }}
                              />
                            </label>
                          </div>

                          <label style={{ display: "grid", gap: 4 }}>
                            <span style={{ fontWeight: 700 }}>Additional Recipients</span>
                            <select
                              name="notifyUserIds"
                              multiple
                              size={6}
                              defaultValue={hub.recipients.map((r) => r.user.id)}
                              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", minHeight: 120 }}
                            >
                              {users.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {personLabel(u)}
                                </option>
                              ))}
                            </select>
                          </label>

                          <button
                            type="submit"
                            style={{ width: "fit-content", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", fontWeight: 800, cursor: "pointer" }}
                          >
                            Save Changes
                          </button>
                        </form>
                      </details>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", overflow: "hidden" }}>
          <div style={{ padding: 14, borderBottom: "1px solid var(--border)" }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Recent Alerts</h2>
          </div>
          {recentAlerts.length === 0 ? (
            <div style={{ padding: 14, opacity: 0.8 }}>No high/low alerts yet.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
                    <th style={{ textAlign: "left", padding: 10 }}>When</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Hub</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Location</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Device</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Temp</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Alert State</th>
                  </tr>
                </thead>
                <tbody>
                  {recentAlerts.map((row) => {
                    const temp = toNumberOrNull(row.tempF);
                    return (
                      <tr key={row.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: 10, whiteSpace: "nowrap", fontSize: 13 }}>{fmtDateTime(row.recordedAt)}</td>
                        <td style={{ padding: 10 }}>{row.hub.name}</td>
                        <td style={{ padding: 10 }}>{row.hub.location?.name ?? "-"}</td>
                        <td style={{ padding: 10 }}>{row.device?.name ?? "-"}</td>
                        <td style={{ padding: 10 }}>{temp === null ? "-" : `${temp.toFixed(1)}F`}</td>
                        <td style={{ padding: 10, fontWeight: 900 }}>{row.alertState}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
