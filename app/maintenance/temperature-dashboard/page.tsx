import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { canAccessAdmin } from "@/app/lib/admin-access";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { ADMIN_VIEW_TEMPERATURE_DASHBOARD, VIEW_TEMPERATURE_DASHBOARD } from "@/app/lib/permission-constants";
import { loadMaintenancePrimaryAssignments } from "@/app/lib/preventative-maintenance";
import {
  evaluateTemperatureAlertState,
  notifyTemperatureAlert,
  shouldSendAlert,
} from "@/app/lib/mocreo";
import { performMocreoPollSync } from "@/app/lib/mocreo-poll-sync";
import AutoRefresh from "@/app/maintenance/temperature-dashboard/AutoRefresh";
import CopyWebhookField from "@/app/maintenance/temperature-dashboard/CopyWebhookField";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type SearchParams = Record<string, string | string[] | undefined>;

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
    minTempF: unknown;
    maxTempF: unknown;
    lastSeenAt: Date | null;
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

type SensorReadingRow = {
  hubId: string;
  deviceId: string | null;
  recordedAt: Date;
  tempF: unknown;
};

type SensorPoint = {
  ts: number;
  temp: number;
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
    delete: (args: unknown) => Promise<{ id: string }>;
    findUnique: (args: unknown) => Promise<
      | {
          id: string;
          active: boolean;
          name: string;
          externalHubId: string;
        }
      | null
    >;
  };
  mocreoHubRecipient: {
    deleteMany: (args: unknown) => Promise<unknown>;
    createMany: (args: unknown) => Promise<unknown>;
  };
  mocreoDevice: {
    findUnique: (args: unknown) => Promise<
      | {
          id: string;
          hubId: string;
          name: string;
          externalDeviceId: string;
        }
      | null
    >;
    update: (args: unknown) => Promise<{ id: string }>;
    delete: (args: unknown) => Promise<{ id: string }>;
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

function parseOptionalDateTime(raw: FormDataEntryValue | null): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function sparklinePoints(values: number[], width = 160, height = 34): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  return values
    .map((v, i) => {
      const x = values.length === 1 ? 0 : (i / (values.length - 1)) * width;
      const y = range === 0 ? height / 2 : height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function getConnectionHealth(lastSeen: Date | null): {
  label: "ONLINE" | "DEGRADED" | "OFFLINE" | "NO_DATA";
  minutes: number | null;
  color: string;
} {
  if (!lastSeen) return { label: "NO_DATA", minutes: null, color: "#9ca3af" };
  const mins = Math.max(0, Math.round((Date.now() - lastSeen.getTime()) / 60000));
  // Mocreo reporting intervals can be longer than a few minutes; avoid false offline flags.
  if (mins <= 30) return { label: "ONLINE", minutes: mins, color: "#22c55e" };
  if (mins <= 120) return { label: "DEGRADED", minutes: mins, color: "#f59e0b" };
  return { label: "OFFLINE", minutes: mins, color: "#ef4444" };
}

function linePointsForTimedSeries(args: {
  points: SensorPoint[];
  width: number;
  height: number;
  minTemp: number;
  maxTemp: number;
  startTs: number;
  endTs: number;
}): string {
  const { points, width, height, minTemp, maxTemp, startTs, endTs } = args;
  if (points.length === 0) return "";

  const tempRange = Math.max(0.001, maxTemp - minTemp);
  const timeRange = Math.max(1, endTs - startTs);

  return points
    .map((p) => {
      const clampedTs = Math.max(startTs, Math.min(endTs, p.ts));
      const x = ((clampedTs - startTs) / timeRange) * width;
      const y = height - ((p.temp - minTemp) / tempRange) * height;
      return `${x.toFixed(1)},${Math.max(0, Math.min(height, y)).toFixed(1)}`;
    })
    .join(" ");
}

function firstParam(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function dashboardMessageFromCode(code: string | undefined): string | null {
  const c = String(code ?? "").trim().toLowerCase();
  if (!c) return null;

  const table: Record<string, string> = {
    missing: "Hub name and Mocreo Hub ID are required.",
    range: "Hub threshold range is invalid. Min must be less than Max.",
    missing_device: "Device and hub are required.",
    device_range: "Device threshold range is invalid. Min must be less than Max.",
    invalid_device: "Selected device does not belong to the selected hub.",
    missing_hub: "Please select a hub for the pairing test.",
    invalid_hub: "Selected hub is invalid or inactive.",
    host_missing: "Unable to determine host URL for pairing test.",
    save_failed: "Could not save hub configuration. Please verify values and try again.",
    duplicate_hub_id: "That Mocreo Hub ID is already registered to another hub.",
    missing_hub_delete: "Hub id is missing for delete action.",
    invalid_hub_delete: "Hub not found for delete action.",
    hub_delete_failed: "Hub delete failed. Try again or check related records.",
    missing_sensor_delete: "Sensor id is missing for delete action.",
    invalid_sensor_delete: "Sensor not found for delete action.",
    sensor_delete_failed: "Sensor delete failed. Try again.",
    forbidden: "You do not have permission to perform this action.",
  };

  return table[c] ?? c;
}

export default async function TemperatureDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");

  const email = String(session.user?.email ?? "").trim().toLowerCase();
  if (!email) redirect("/login");

  const me = await db.user.findUnique({ where: { email }, select: { id: true, active: true } });
  if (!me || !me.active) redirect("/login");
  const meId = me.id;

  const isAdmin = await canAccessAdmin(session);
  const perms = await loadUserPermissions(session);
  const canView =
    perms.allowAll ||
    hasAnyPermission(perms, [VIEW_TEMPERATURE_DASHBOARD, ADMIN_VIEW_TEMPERATURE_DASHBOARD]) ||
    isAdmin;
  if (!canView) redirect("/");

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

    let savedId = "";
    try {
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

          savedId = saved.id;

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
          entityId: savedId,
          message: `${hubId ? "Updated" : "Created"} Mocreo hub ${name}.`,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (/unique|duplicate|externalhubid/i.test(msg)) {
        redirect("/maintenance/temperature-dashboard?error=duplicate_hub_id");
      }
      redirect("/maintenance/temperature-dashboard?error=save_failed");
    }

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

  async function deleteHubAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    if (!session) redirect("/login");
    if (!(await canAccessAdmin(session))) redirect("/");

    const email = String(session.user?.email ?? "").trim().toLowerCase();
    if (!email) redirect("/login");
    const actor = await db.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!actor || !actor.active) redirect("/login");

    const hubId = String(formData.get("hubId") ?? "").trim();
    if (!hubId) {
      redirect("/maintenance/temperature-dashboard?error=missing_hub_delete");
    }

    const existing = await db.mocreoHub.findUnique({
      where: { id: hubId },
      select: { id: true, name: true, externalHubId: true, active: true },
    });
    if (!existing) {
      redirect("/maintenance/temperature-dashboard?error=invalid_hub_delete");
    }

    try {
      await db.mocreoHub.delete({ where: { id: hubId }, select: { id: true } });

      await db.auditLog.create({
        data: {
          actorUserId: actor.id,
          module: "MOCREO_TEMPERATURE",
          action: "DELETE_HUB",
          entityType: "MocreoHub",
          entityId: hubId,
          message: `Deleted Mocreo hub ${existing.name}.`,
          metadata: { externalHubId: existing.externalHubId },
        },
      });
    } catch {
      redirect("/maintenance/temperature-dashboard?error=hub_delete_failed");
    }

    revalidatePath("/maintenance/temperature-dashboard");
    redirect("/maintenance/temperature-dashboard?deletedHub=1");
  }

  async function saveDeviceThresholdAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    if (!session) redirect("/login");
    if (!(await canAccessAdmin(session))) redirect("/");

    const email = String(session.user?.email ?? "").trim().toLowerCase();
    if (!email) redirect("/login");
    const actor = await db.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!actor || !actor.active) redirect("/login");

    const deviceId = String(formData.get("deviceId") ?? "").trim();
    const hubId = String(formData.get("hubId") ?? "").trim();
    const minTempF = parseTempInput(formData.get("deviceMinTempF"));
    const maxTempF = parseTempInput(formData.get("deviceMaxTempF"));

    if (!deviceId || !hubId) {
      redirect("/maintenance/temperature-dashboard?error=missing_device");
    }

    if (minTempF !== null && maxTempF !== null && minTempF >= maxTempF) {
      redirect("/maintenance/temperature-dashboard?error=device_range");
    }

    const device = await db.mocreoDevice.findUnique({
      where: { id: deviceId },
      select: { id: true, hubId: true, name: true, externalDeviceId: true },
    });
    if (!device || device.hubId !== hubId) {
      redirect("/maintenance/temperature-dashboard?error=invalid_device");
    }

    await db.mocreoDevice.update({
      where: { id: device.id },
      data: { minTempF, maxTempF },
      select: { id: true },
    });

    await db.auditLog.create({
      data: {
        actorUserId: actor.id,
        module: "MOCREO_TEMPERATURE",
        action: "UPDATE_DEVICE_THRESHOLDS",
        entityType: "MocreoDevice",
        entityId: device.id,
        message: `Updated thresholds for sensor ${device.name}.`,
        metadata: {
          hubId,
          externalDeviceId: device.externalDeviceId,
          minTempF,
          maxTempF,
        },
      },
    });

    revalidatePath("/maintenance/temperature-dashboard");
    redirect("/maintenance/temperature-dashboard?savedDevice=1");
  }

  async function deleteSensorAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    if (!session) redirect("/login");
    if (!(await canAccessAdmin(session))) redirect("/");

    const email = String(session.user?.email ?? "").trim().toLowerCase();
    if (!email) redirect("/login");
    const actor = await db.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!actor || !actor.active) redirect("/login");

    const deviceId = String(formData.get("deviceId") ?? "").trim();
    if (!deviceId) {
      redirect("/maintenance/temperature-dashboard?error=missing_sensor_delete");
    }

    const existing = await db.mocreoDevice.findUnique({
      where: { id: deviceId },
      select: { id: true, hubId: true, name: true, externalDeviceId: true },
    });
    if (!existing) {
      redirect("/maintenance/temperature-dashboard?error=invalid_sensor_delete");
    }

    try {
      await db.mocreoDevice.delete({ where: { id: deviceId }, select: { id: true } });

      await db.auditLog.create({
        data: {
          actorUserId: actor.id,
          module: "MOCREO_TEMPERATURE",
          action: "DELETE_SENSOR",
          entityType: "MocreoDevice",
          entityId: existing.id,
          message: `Deleted Mocreo sensor ${existing.name}.`,
          metadata: {
            hubId: existing.hubId,
            externalDeviceId: existing.externalDeviceId,
          },
        },
      });
    } catch {
      redirect("/maintenance/temperature-dashboard?error=sensor_delete_failed");
    }

    revalidatePath("/maintenance/temperature-dashboard");
    redirect("/maintenance/temperature-dashboard?deletedSensor=1");
  }

  async function runWebhookPairingTestAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    if (!session) redirect("/login");
    if (!(await canAccessAdmin(session))) redirect("/");

    const hubId = String(formData.get("hubId") ?? "").trim();
    if (!hubId) {
      redirect("/maintenance/temperature-dashboard?test=missing_hub");
    }

    const selectedHub = await db.mocreoHub.findUnique({
      where: { id: hubId },
      select: { id: true, name: true, externalHubId: true, active: true },
    });

    if (!selectedHub || !selectedHub.active) {
      redirect("/maintenance/temperature-dashboard?test=invalid_hub");
    }

    const tempFInput = String(formData.get("temperatureF") ?? "").trim();
    const batteryInput = String(formData.get("batteryPct") ?? "").trim();
    const signalInput = String(formData.get("signalPct") ?? "").trim();

    const tempF = Number.isFinite(Number(tempFInput)) ? Number(tempFInput) : 45;
    const batteryPct = Number.isFinite(Number(batteryInput)) ? Math.trunc(Number(batteryInput)) : 88;
    const signalPct = Number.isFinite(Number(signalInput)) ? Math.trunc(Number(signalInput)) : 90;

    const payload = {
      event: {
        externalHubId: selectedHub.externalHubId,
        hubName: selectedHub.name,
        externalDeviceId: `test-device-${selectedHub.externalHubId}`,
        deviceName: `${selectedHub.name} Test Sensor`,
        timestamp: new Date().toISOString(),
        temperatureF: tempF,
        batteryPct,
        signalPct,
        readingId: `test-${Date.now()}`,
      },
    };

    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
    const proto = h.get("x-forwarded-proto") ?? "http";

    if (!host) {
      redirect("/maintenance/temperature-dashboard?test=host_missing");
    }

    const webhookUrl = `${proto}://${host}/api/integrations/mocreo/webhook`;

    const webhookToken = process.env.MOCREO_WEBHOOK_TOKEN?.trim();
    const headersObj: Record<string, string> = { "content-type": "application/json" };
    if (webhookToken) headersObj["x-mocreo-token"] = webhookToken;

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: headersObj,
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    revalidatePath("/maintenance/temperature-dashboard");

    if (!response.ok) {
      redirect(`/maintenance/temperature-dashboard?test=failed&code=${response.status}`);
    }

    redirect("/maintenance/temperature-dashboard?test=ok");
  }

  async function runSyncNowAction() {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    if (!session) redirect("/login");
    if (!(await canAccessAdmin(session))) redirect("/");

    let payload: {
      nodesMatched?: number;
      nodesFound?: number;
      devicesFound?: number;
      availableThingNamesSample?: unknown;
      availableDeviceThingNamesSample?: unknown;
      ingested?: number;
      samplesFetched?: number;
      matchedNodesNoSamples?: number;
      fallbackNodesQueried?: number;
      sampleIdsTried?: number;
      sampleRequestAttempts?: number;
      skippedDuplicate?: number;
      skippedNoTemp?: number;
      skippedNoTimestamp?: number;
      hubsActive?: number;
    } | null = null;

    try {
      payload = (await performMocreoPollSync()) as {
        nodesMatched?: number;
        nodesFound?: number;
        devicesFound?: number;
        availableThingNamesSample?: unknown;
        availableDeviceThingNamesSample?: unknown;
        ingested?: number;
        samplesFetched?: number;
        matchedNodesNoSamples?: number;
        fallbackNodesQueried?: number;
        sampleIdsTried?: number;
        sampleRequestAttempts?: number;
        skippedDuplicate?: number;
        skippedNoTemp?: number;
        skippedNoTimestamp?: number;
        hubsActive?: number;
      };
    } catch (error) {
      const message = error instanceof Error ? error.message.trim() : "Unknown error";
      const sp = new URLSearchParams();
      sp.set("sync", "failed");
      sp.set("code", "500");
      if (message) sp.set("reason", message.slice(0, 180));
      redirect(`/maintenance/temperature-dashboard?${sp.toString()}`);
    }

    revalidatePath("/maintenance/temperature-dashboard");
    const sp = new URLSearchParams();
    sp.set("sync", "ok");
    if (typeof payload?.hubsActive === "number") sp.set("hubsActive", String(payload.hubsActive));
    if (typeof payload?.nodesFound === "number") sp.set("nodesFound", String(payload.nodesFound));
    if (typeof payload?.devicesFound === "number") sp.set("devicesFound", String(payload.devicesFound));
    if (typeof payload?.nodesMatched === "number") sp.set("nodesMatched", String(payload.nodesMatched));
    if (typeof payload?.ingested === "number") sp.set("ingested", String(payload.ingested));
    if (typeof payload?.samplesFetched === "number") sp.set("samplesFetched", String(payload.samplesFetched));
    if (typeof payload?.matchedNodesNoSamples === "number")
      sp.set("matchedNodesNoSamples", String(payload.matchedNodesNoSamples));
    if (typeof payload?.fallbackNodesQueried === "number")
      sp.set("fallbackNodesQueried", String(payload.fallbackNodesQueried));
    if (typeof payload?.sampleIdsTried === "number") sp.set("sampleIdsTried", String(payload.sampleIdsTried));
    if (typeof payload?.sampleRequestAttempts === "number")
      sp.set("sampleRequestAttempts", String(payload.sampleRequestAttempts));
    if (typeof payload?.skippedDuplicate === "number") sp.set("skippedDuplicate", String(payload.skippedDuplicate));
    if (typeof payload?.skippedNoTemp === "number") sp.set("skippedNoTemp", String(payload.skippedNoTemp));
    if (typeof payload?.skippedNoTimestamp === "number")
      sp.set("skippedNoTimestamp", String(payload.skippedNoTimestamp));
    if (Array.isArray(payload?.availableThingNamesSample) && payload.availableThingNamesSample.length > 0) {
      const sample = payload.availableThingNamesSample
        .map((x) => String(x ?? "").trim())
        .filter(Boolean)
        .slice(0, 8)
        .join(", ");
      if (sample) sp.set("thingNames", sample.slice(0, 280));
    }
    if (Array.isArray(payload?.availableDeviceThingNamesSample) && payload.availableDeviceThingNamesSample.length > 0) {
      const sample = payload.availableDeviceThingNamesSample
        .map((x) => String(x ?? "").trim())
        .filter(Boolean)
        .slice(0, 8)
        .join(", ");
      if (sample) sp.set("deviceThingNames", sample.slice(0, 280));
    }
    redirect(`/maintenance/temperature-dashboard?${sp.toString()}`);
  }

  async function ingestManualReadingAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    if (!session) redirect("/login");
    if (!(await canAccessAdmin(session))) redirect("/");

    const email = String(session.user?.email ?? "").trim().toLowerCase();
    if (!email) redirect("/login");
    const actor = await db.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!actor || !actor.active) redirect("/login");

    const hubId = String(formData.get("hubId") ?? "").trim();
    const externalDeviceId = String(formData.get("externalDeviceId") ?? "").trim();
    const deviceName = String(formData.get("deviceName") ?? "").trim() || `Device ${externalDeviceId}`;
    const tempF = parseTempInput(formData.get("temperatureF"));
    const batteryPct = parseTempInput(formData.get("batteryPct"));
    const signalPct = parseTempInput(formData.get("signalPct"));
    const recordedAt = parseOptionalDateTime(formData.get("recordedAt")) ?? new Date();

    if (!hubId || !externalDeviceId || tempF === null) {
      redirect("/maintenance/temperature-dashboard?manual=missing");
    }

    const hub = await (prisma as any).mocreoHub.findUnique({
      where: { id: hubId },
      select: {
        id: true,
        name: true,
        active: true,
        minTempF: true,
        maxTempF: true,
        lastAlertAt: true,
        location: { select: { name: true } },
        assignedMaintenanceUserId: true,
        recipients: { select: { userId: true } },
      },
    });

    if (!hub || !hub.active) {
      redirect("/maintenance/temperature-dashboard?manual=invalid_hub");
    }

    const existingDevice = await (prisma as any).mocreoDevice.findUnique({
      where: {
        hubId_externalDeviceId: {
          hubId: hub.id,
          externalDeviceId,
        },
      },
      select: { id: true, minTempF: true, maxTempF: true },
    });

    const hubMinTempF = toNumberOrNull(hub.minTempF);
    const hubMaxTempF = toNumberOrNull(hub.maxTempF);
    const deviceMinTempF = toNumberOrNull(existingDevice?.minTempF);
    const deviceMaxTempF = toNumberOrNull(existingDevice?.maxTempF);

    const alertState = evaluateTemperatureAlertState(tempF, {
      minTempF: deviceMinTempF ?? hubMinTempF,
      maxTempF: deviceMaxTempF ?? hubMaxTempF,
    });

    const device = await (prisma as any).mocreoDevice.upsert({
      where: {
        hubId_externalDeviceId: {
          hubId: hub.id,
          externalDeviceId,
        },
      },
      update: {
        name: deviceName,
        lastSeenAt: recordedAt,
        lastReadingAt: recordedAt,
        lastTempF: tempF,
        lastBatteryPct: batteryPct === null ? null : Math.trunc(batteryPct),
        lastSignalPct: signalPct === null ? null : Math.trunc(signalPct),
        lastAlertState: alertState,
      },
      create: {
        hubId: hub.id,
        externalDeviceId,
        name: deviceName,
        lastSeenAt: recordedAt,
        lastReadingAt: recordedAt,
        lastTempF: tempF,
        lastBatteryPct: batteryPct === null ? null : Math.trunc(batteryPct),
        lastSignalPct: signalPct === null ? null : Math.trunc(signalPct),
        lastAlertState: alertState,
      },
      select: { id: true },
    });

    await (prisma as any).mocreoTemperatureReading.create({
      data: {
        hubId: hub.id,
        deviceId: device.id,
        externalReadingId: `manual-${Date.now()}`,
        recordedAt,
        tempF,
        batteryPct: batteryPct === null ? null : Math.trunc(batteryPct),
        signalPct: signalPct === null ? null : Math.trunc(signalPct),
        alertState,
        rawPayload: {
          source: "manual-dashboard-entry",
          externalDeviceId,
          deviceName,
          recordedAt: recordedAt.toISOString(),
        },
      },
    });

    const sendAlert = shouldSendAlert(alertState, hub.lastAlertAt);
    await (prisma as any).mocreoHub.update({
      where: { id: hub.id },
      data: {
        lastReadingAt: recordedAt,
        lastTempF: tempF,
        lastAlertState: alertState,
        lastAlertAt: sendAlert ? new Date() : hub.lastAlertAt,
      },
    });

    if (sendAlert) {
      const recipients = new Set<string>();
      if (hub.assignedMaintenanceUserId) recipients.add(hub.assignedMaintenanceUserId);
      for (const row of hub.recipients as Array<{ userId: string }>) recipients.add(row.userId);

      await notifyTemperatureAlert({
        userIds: Array.from(recipients),
        hubName: hub.name,
        locationName: hub.location?.name ?? null,
        temperatureF: tempF,
        alertState,
        href: "/maintenance/temperature-dashboard",
      });
    }

    await db.auditLog.create({
      data: {
        actorUserId: actor.id,
        module: "MOCREO_TEMPERATURE",
        action: "MANUAL_READING_INGESTED",
        entityType: "MocreoHub",
        entityId: hub.id,
        message: `Manual reading entered for hub ${hub.name}.`,
        metadata: { externalDeviceId, deviceName, temperatureF: tempF, recordedAt: recordedAt.toISOString() },
      },
    });

    revalidatePath("/maintenance/temperature-dashboard");
    redirect("/maintenance/temperature-dashboard?manual=ok");
  }

  const [users, locations, hubs, recentAlerts, paramsRaw] = await Promise.all([
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
            OR: [{ assignedMaintenanceUserId: meId }, { recipients: { some: { userId: meId } } }],
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
            minTempF: true,
            maxTempF: true,
            lastSeenAt: true,
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
              OR: [{ assignedMaintenanceUserId: meId }, { recipients: { some: { userId: meId } } }],
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
    searchParams ?? Promise.resolve({}),
  ]);

  const latestSyncAudit = await (prisma as any).auditLog.findFirst({
    where: {
      module: "MOCREO_TEMPERATURE",
      action: "POLL_SYNC_COMPLETED",
    },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      metadata: true,
    },
  });

  const latestSyncMeta =
    latestSyncAudit && typeof latestSyncAudit.metadata === "object" && latestSyncAudit.metadata !== null
      ? (latestSyncAudit.metadata as Record<string, unknown>)
      : null;
  const lastSyncNodesMatched = Number(latestSyncMeta?.sampleCandidates ?? latestSyncMeta?.nodesMatched ?? NaN);
  const lastSyncIngested = Number(latestSyncMeta?.ingested ?? NaN);
  const lastSyncSkippedDuplicate = Number(latestSyncMeta?.skippedDuplicate ?? NaN);
  const lastSyncSkippedNoTemp = Number(latestSyncMeta?.skippedNoTemp ?? NaN);
  const lastSyncSkippedNoTimestamp = Number(latestSyncMeta?.skippedNoTimestamp ?? NaN);

  const hubIds = hubs.map((h) => h.id);
  const sensorReadings: SensorReadingRow[] =
    hubIds.length === 0
      ? []
      : await prisma.mocreoTemperatureReading.findMany({
          where: {
            hubId: { in: hubIds },
            deviceId: { not: null },
            tempF: { not: null },
            recordedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
          orderBy: { recordedAt: "asc" },
          take: 10000,
          select: {
            hubId: true,
            deviceId: true,
            recordedAt: true,
            tempF: true,
          },
        });

  const latestReadingByDevice = new Map<string, { tempF: number; recordedAt: Date }>();
  const historyByDevice = new Map<string, SensorPoint[]>();

  for (const row of sensorReadings) {
    const deviceIdKey = String(row.deviceId ?? "").trim();
    if (!deviceIdKey) continue;
    const temp = Number(row.tempF);
    if (!Number.isFinite(temp)) continue;
    latestReadingByDevice.set(deviceIdKey, { tempF: temp, recordedAt: row.recordedAt });

    const hist = historyByDevice.get(deviceIdKey) ?? [];
    hist.push({ ts: row.recordedAt.getTime(), temp });
    if (hist.length > 120) hist.shift();
    historyByDevice.set(deviceIdKey, hist);
  }
  const params = paramsRaw as SearchParams;
  const errorCode = firstParam(params.error);
  const errorText = dashboardMessageFromCode(errorCode);
  const savedOk = firstParam(params.saved) === "1";
  const savedDeviceOk = firstParam(params.savedDevice) === "1";
  const manualOk = firstParam(params.manual) === "ok";
  const deletedHubOk = firstParam(params.deletedHub) === "1";
  const deletedSensorOk = firstParam(params.deletedSensor) === "1";

  const statusMessage = isAdmin
    ? "This dashboard lets you register Mocreo hubs, assign the maintenance tech, and add extra notification recipients."
    : "This dashboard shows your assigned hubs and any alerts where you are a recipient.";

  const testValue = firstParam(params.test);
  const testCode = firstParam(params.code);
  const testState = testValue ? `${testValue}${testCode ? ` (${testCode})` : ""}` : null;
  const syncValue = firstParam(params.sync);
  const syncCode = firstParam(params.code);
  const syncReasonRaw = firstParam(params.reason);
  const syncReasonLower = typeof syncReasonRaw === "string" ? syncReasonRaw.toLowerCase() : "";
  const syncReasonLooksLikeAuthHtml =
    syncReasonLower.includes("authentication required") ||
    syncReasonLower.includes("llms.txt") ||
    syncReasonLower.includes("<!doctype html") ||
    syncReasonLower.includes("<html");
  const syncReason =
    syncCode === "401" || syncReasonLooksLikeAuthHtml
      ? "Stale app session detected. Close and reopen the app (or hard refresh browser) and run Sync Now again."
      : syncReasonRaw;
  const syncState = syncValue ? `${syncValue}${syncCode ? ` (${syncCode})` : ""}` : null;
  const syncHubsActive = Number(firstParam(params.hubsActive) ?? "NaN");
  const syncNodesFound = Number(firstParam(params.nodesFound) ?? "NaN");
  const syncDevicesFound = Number(firstParam(params.devicesFound) ?? "NaN");
  const syncNodesMatched = Number(firstParam(params.nodesMatched) ?? "NaN");
  const syncThingNames = firstParam(params.thingNames);
  const syncDeviceThingNames = firstParam(params.deviceThingNames);
  const syncIngested = Number(firstParam(params.ingested) ?? "NaN");
  const syncSamplesFetched = Number(firstParam(params.samplesFetched) ?? "NaN");
  const syncMatchedNodesNoSamples = Number(firstParam(params.matchedNodesNoSamples) ?? "NaN");
  const syncFallbackNodesQueried = Number(firstParam(params.fallbackNodesQueried) ?? "NaN");
  const syncSampleIdsTried = Number(firstParam(params.sampleIdsTried) ?? "NaN");
  const syncSampleRequestAttempts = Number(firstParam(params.sampleRequestAttempts) ?? "NaN");
  const syncSkippedDuplicate = Number(firstParam(params.skippedDuplicate) ?? "NaN");
  const syncSkippedNoTemp = Number(firstParam(params.skippedNoTemp) ?? "NaN");
  const syncSkippedNoTimestamp = Number(firstParam(params.skippedNoTimestamp) ?? "NaN");
  const refreshSecRaw = firstParam(params.refreshSec);
  const refreshSec = Math.max(5, Math.min(300, Number.isFinite(Number(refreshSecRaw)) ? Number(refreshSecRaw) : 20));
  const reqHeaders = await headers();
  const host = reqHeaders.get("x-forwarded-host") ?? reqHeaders.get("host") ?? "";
  const proto = reqHeaders.get("x-forwarded-proto") ?? "https";
  const absoluteSyncUrl = host
    ? `${proto}://${host}/api/integrations/mocreo/sync`
    : "/api/integrations/mocreo/sync";

  return (
    <main>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 12 }}>
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 900, fontSize: 16, padding: "2px 2px" }}>Dashboard Overview</summary>
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
              <code>POST /api/integrations/mocreo/sync</code>
              <span style={{ fontSize: 12, opacity: 0.8 }}>
                Optional security header: <code>x-mocreo-sync-token</code> = <code>MOCREO_SYNC_TOKEN</code>
              </span>
              <AutoRefresh seconds={refreshSec} />
              <Link href="/notifications" style={{ textDecoration: "none", fontWeight: 800 }}>
                {"Notifications ->"}
              </Link>
            </div>
          </section>
        </details>

        {errorText ? (
          <section style={{ border: "1px solid rgba(239,68,68,0.45)", borderRadius: 12, padding: 12, background: "rgba(239,68,68,0.12)" }}>
            <strong>Action failed:</strong> {errorText}
          </section>
        ) : null}

        {savedOk || savedDeviceOk || manualOk || deletedHubOk || deletedSensorOk ? (
          <section style={{ border: "1px solid rgba(34,197,94,0.45)", borderRadius: 12, padding: 12, background: "rgba(34,197,94,0.12)" }}>
            {savedOk
              ? "Hub configuration saved."
              : savedDeviceOk
                ? "Sensor thresholds updated."
                : manualOk
                  ? "Manual reading ingested."
                  : deletedHubOk
                    ? "Hub deleted."
                    : "Sensor deleted."}
          </section>
        ) : null}

        {syncValue === "ok" ? (
          <section
            style={{
              border:
                Number.isFinite(syncIngested) && syncIngested > 0
                  ? "1px solid rgba(34,197,94,0.45)"
                  : "1px solid rgba(245,158,11,0.45)",
              borderRadius: 12,
              padding: 12,
              background:
                Number.isFinite(syncIngested) && syncIngested > 0
                  ? "rgba(34,197,94,0.12)"
                  : "rgba(245,158,11,0.12)",
            }}
          >
            <div style={{ fontWeight: 900 }}>
              {Number.isFinite(syncIngested) && syncIngested > 0
                ? "Sync completed and readings were ingested."
                : "Sync completed but no new readings were ingested."}
            </div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.95 }}>
              Active hubs: {Number.isFinite(syncHubsActive) ? syncHubsActive : "-"} | Devices found: {Number.isFinite(syncDevicesFound) ? syncDevicesFound : "-"} | Nodes found: {Number.isFinite(syncNodesFound) ? syncNodesFound : "-"} | Nodes matched: {Number.isFinite(syncNodesMatched) ? syncNodesMatched : "-"} | Sample IDs tried: {Number.isFinite(syncSampleIdsTried) ? syncSampleIdsTried : "-"} | Sample requests tried: {Number.isFinite(syncSampleRequestAttempts) ? syncSampleRequestAttempts : "-"} | Samples fetched: {Number.isFinite(syncSamplesFetched) ? syncSamplesFetched : "-"} | Ingested: {Number.isFinite(syncIngested) ? syncIngested : "-"} | Duplicates skipped: {Number.isFinite(syncSkippedDuplicate) ? syncSkippedDuplicate : "-"} | No-temp skipped: {Number.isFinite(syncSkippedNoTemp) ? syncSkippedNoTemp : "-"} | No-time skipped: {Number.isFinite(syncSkippedNoTimestamp) ? syncSkippedNoTimestamp : "-"}
            </div>
            {Number.isFinite(syncIngested) && syncIngested === 0 ? (
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.95 }}>
                Check mapping and pairing: dashboard <b>Mocreo Hub ID</b> must equal Mocreo hub serial/SN (<code>thingName</code>). If devices are found but nodes are 0, sensors may not be paired to the hub yet.
              </div>
            ) : null}
            {Number.isFinite(syncMatchedNodesNoSamples) && syncMatchedNodesNoSamples > 0 ? (
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.95 }}>
                Matched nodes with no returned samples: {syncMatchedNodesNoSamples}. Fallback-window retries used: {Number.isFinite(syncFallbackNodesQueried) ? syncFallbackNodesQueried : "-"}.
              </div>
            ) : null}
            {syncThingNames ? (
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.95 }}>
                Mocreo returned hub IDs (sample): <code>{syncThingNames}</code>
              </div>
            ) : null}
            {syncDeviceThingNames ? (
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.95 }}>
                Mocreo device hub IDs (sample): <code>{syncDeviceThingNames}</code>
              </div>
            ) : null}
          </section>
        ) : null}

        {syncValue && syncValue !== "ok" ? (
          <section style={{ border: "1px solid rgba(239,68,68,0.45)", borderRadius: 12, padding: 12, background: "rgba(239,68,68,0.12)" }}>
            <strong>Sync failed:</strong> {syncState}
            {syncReason ? (
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.95 }}>
                Reason: <code>{syncReason}</code>
              </div>
            ) : null}
          </section>
        ) : null}

        {latestSyncAudit ? (
          <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
            <div style={{ fontWeight: 900 }}>Latest Poll Run</div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.92 }}>
              Ran at: {fmtDateTime(latestSyncAudit.createdAt)} | Ingested: {Number.isFinite(lastSyncIngested) ? lastSyncIngested : "-"} | Candidates/Matched: {Number.isFinite(lastSyncNodesMatched) ? lastSyncNodesMatched : "-"} | Duplicates skipped: {Number.isFinite(lastSyncSkippedDuplicate) ? lastSyncSkippedDuplicate : "-"} | No-temp skipped: {Number.isFinite(lastSyncSkippedNoTemp) ? lastSyncSkippedNoTemp : "-"} | No-time skipped: {Number.isFinite(lastSyncSkippedNoTimestamp) ? lastSyncSkippedNoTimestamp : "-"}
            </div>
          </section>
        ) : null}

        <details>
          <summary style={{ cursor: "pointer", fontWeight: 900, fontSize: 16, padding: "2px 2px" }}>Step-by-Step Setup</summary>
          <section
            style={{
              border: "1px solid var(--border)",
              borderRadius: 14,
              background: "var(--surface)",
              boxShadow: "var(--shadow)",
              padding: 14,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Step-by-Step Setup</h2>
            <div style={{ marginTop: 10, display: "grid", gap: 8, lineHeight: 1.5 }}>
            <div>
              <strong>1.</strong> In <strong>Register / Update Hub</strong>, enter a <strong>Hub Name</strong> and the exact
              <strong> Mocreo hub serial/SN</strong> as <strong>Mocreo Hub ID</strong>.
            </div>
            <div>
              <strong>2.</strong> Pick the <strong>Store Location</strong>. The dashboard can auto-assign the maintenance tech from
              that location.
            </div>
            <div>
              <strong>3.</strong> Add <strong>Additional Recipients</strong> who should also get alerts.
            </div>
            <div>
              <strong>4.</strong> Set <strong>Min Temp</strong> and <strong>Max Temp</strong> in F.
              Alerts trigger when a reading is below min or above max.
            </div>
            <div>
              <strong>5.</strong> Optional: set per-sensor Min/Max to override hub defaults.
            </div>
            <div>
              <strong>6.</strong> Click <strong>Save Hub Configuration</strong>.
            </div>
            <div>
              <strong>7.</strong> Configure your scheduler (Vercel Cron, Windows Task, etc.) to call:
              <div style={{ marginTop: 4 }}>
                <code>POST {absoluteSyncUrl}</code>
              </div>
              <CopyWebhookField webhookUrl={absoluteSyncUrl} />
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                Include header <code>x-mocreo-sync-token</code> with your <code>MOCREO_SYNC_TOKEN</code> value.
              </div>
            </div>
            <div>
              <strong>8.</strong> Set environment variables:
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.9 }}>
                <code>MOCREO_API_USERNAME</code>, <code>MOCREO_API_PASSWORD</code>, <code>MOCREO_POLL_INTERVAL_MINUTES</code>, <code>MOCREO_SYNC_TOKEN</code>
              </div>
            </div>
            <div>
              <strong>9.</strong> Run one manual sync call and confirm readings appear in <strong>Hub Dashboard</strong>.
            </div>
            <div>
              <strong>10.</strong> Watch <strong>Recent Alerts</strong> below.
              Alert notifications will go to the assigned maintenance tech + selected recipients.
            </div>
            </div>
          </section>
        </details>

        {isAdmin ? (
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 900, fontSize: 16, padding: "2px 2px" }}>Sync Mocreo Now</summary>
            <section
            style={{
              border: "1px solid var(--border)",
              borderRadius: 14,
              background: "var(--surface)",
              boxShadow: "var(--shadow)",
              padding: 14,
            }}
          >
            <h2 style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 900 }}>Sync Mocreo Now</h2>
            <p style={{ margin: "0 0 10px", color: "var(--muted)", lineHeight: 1.4 }}>
              Use this to manually pull latest Mocreo readings immediately.
            </p>
            <form action={runSyncNowAction}>
              <button
                type="submit"
                style={{
                  width: "fit-content",
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                  fontWeight: 900,
                  background: "var(--surface-2)",
                  color: "var(--foreground)",
                }}
              >
                Sync Now
              </button>
            </form>
              {syncState ? (
                <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>
                  Last sync result: {syncState}
                </div>
              ) : null}
            </section>
          </details>
        ) : null}

        {isAdmin ? (
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 900, fontSize: 16, padding: "2px 2px" }}>Register / Update Hub</summary>
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
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
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
          </details>
        ) : null}

        {isAdmin ? (
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 900, fontSize: 16, padding: "2px 2px" }}>Manual Reading Fallback</summary>
            <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", padding: 14 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 900 }}>Manual Reading Fallback</h2>
            <p style={{ margin: "0 0 10px", color: "var(--muted)", lineHeight: 1.4 }}>
              Use this temporary workaround when Mocreo webhook configuration is unavailable. Enter the reading shown in the Mocreo app and this dashboard will update sensor status and alerts.
            </p>

            <form action={ingestManualReadingAction} style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 800 }}>Hub</span>
                  <select name="hubId" required style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)" }}>
                    <option value="">Select hub</option>
                    {hubs.map((hub) => (
                      <option key={`manual-${hub.id}`} value={hub.id}>
                        {hub.name} ({hub.externalHubId})
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 800 }}>Device ID</span>
                  <input name="externalDeviceId" required placeholder="ex: sensor serial" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)" }} />
                </label>

                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 800 }}>Device Name</span>
                  <input name="deviceName" placeholder="Optional friendly name" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)" }} />
                </label>

                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 800 }}>Temperature F</span>
                  <input name="temperatureF" type="number" step="0.1" required placeholder="39.1" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)" }} />
                </label>

                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 800 }}>Battery %</span>
                  <input name="batteryPct" type="number" placeholder="88" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)" }} />
                </label>

                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 800 }}>Signal %</span>
                  <input name="signalPct" type="number" placeholder="90" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)" }} />
                </label>

                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 800 }}>Recorded At (optional)</span>
                  <input name="recordedAt" type="datetime-local" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)" }} />
                </label>
              </div>

              <button type="submit" style={{ width: "fit-content", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", cursor: "pointer", fontWeight: 900, background: "var(--surface-2)", color: "var(--foreground)" }}>
                Save Manual Reading
              </button>
            </form>
            </section>
          </details>
        ) : null}

        {isAdmin ? (
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 900, fontSize: 16, padding: "2px 2px" }}>Webhook Pairing Test</summary>
            <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", padding: 14 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 900 }}>Webhook Pairing Test</h2>
            <p style={{ margin: "0 0 10px", color: "var(--muted)", lineHeight: 1.4 }}>
              Send a synthetic Mocreo reading to your webhook for one registered hub to confirm pairing, ingestion, and notification routing.
            </p>

            <form action={runWebhookPairingTestAction} style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 800 }}>Hub</span>
                  <select name="hubId" required style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)" }}>
                    <option value="">Select hub</option>
                    {hubs
                      .filter((x) => x.active)
                      .map((hub) => (
                        <option key={hub.id} value={hub.id}>
                          {hub.name} ({hub.externalHubId})
                        </option>
                      ))}
                  </select>
                </label>

                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 800 }}>Temperature F (test)</span>
                  <input name="temperatureF" type="number" step="0.1" defaultValue="45" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)" }} />
                </label>

                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 800 }}>Battery %</span>
                  <input name="batteryPct" type="number" defaultValue="88" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)" }} />
                </label>

                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 800 }}>Signal %</span>
                  <input name="signalPct" type="number" defaultValue="90" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)" }} />
                </label>
              </div>

              <button type="submit" style={{ width: "fit-content", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", cursor: "pointer", fontWeight: 900, background: "var(--surface-2)", color: "var(--foreground)" }}>
                Run Pairing Test
              </button>
            </form>

              {testState ? (
                <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>
                  Last test result: {testState}
                </div>
              ) : null}
            </section>
          </details>
        ) : null}

        <details open>
          <summary style={{ cursor: "pointer", fontWeight: 900, fontSize: 16, padding: "2px 2px" }}>Hub Dashboard</summary>
          <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", overflow: "hidden" }}>
          <div style={{ padding: 14, borderBottom: "1px solid var(--border)" }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Hub Dashboard</h2>
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
              Sensor-level thresholds override hub thresholds when set.
            </div>
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
                const nowTs = Date.now();
                const startTs = nowTs - 24 * 60 * 60 * 1000;
                const chartWidth = 920;
                const chartHeight = 180;
                const seriesPalette = [
                  "#38bdf8",
                  "#22c55e",
                  "#f59e0b",
                  "#f97316",
                  "#e879f9",
                  "#a78bfa",
                  "#fb7185",
                  "#2dd4bf",
                ];

                const series = hub.devices
                  .map((d, idx) => ({
                    device: d,
                    color: seriesPalette[idx % seriesPalette.length],
                    points: (historyByDevice.get(d.id) ?? []).filter((p) => p.ts >= startTs),
                  }))
                  .filter((s) => s.points.length > 1);

                const allTemps = series.flatMap((s) => s.points.map((p) => p.temp));
                const chartMinTemp = allTemps.length > 0 ? Math.min(...allTemps) : 0;
                const chartMaxTemp = allTemps.length > 0 ? Math.max(...allTemps) : 100;
                const paddedMin = chartMinTemp - 2;
                const paddedMax = chartMaxTemp + 2;

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
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <form action={toggleHubAction}>
                            <input type="hidden" name="hubId" value={hub.id} />
                            <button type="submit" style={{ padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", cursor: "pointer", fontWeight: 800 }}>
                              {hub.active ? "Deactivate" : "Activate"}
                            </button>
                          </form>

                          <form action={deleteHubAction}>
                            <input type="hidden" name="hubId" value={hub.id} />
                            <button
                              type="submit"
                              style={{
                                padding: "7px 10px",
                                border: "1px solid rgba(239,68,68,0.45)",
                                borderRadius: 8,
                                background: "rgba(239,68,68,0.12)",
                                cursor: "pointer",
                                fontWeight: 800,
                              }}
                              title="Delete this hub and linked Mocreo records"
                            >
                              Delete Hub
                            </button>
                          </form>
                        </div>
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

                    <div style={{ marginTop: 10, border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--surface)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 800, fontSize: 13 }}>Sensor Temperature Overlay (Last 24h)</div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>Live chart updates with auto-refresh</div>
                      </div>

                      {series.length === 0 ? (
                        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>Need at least two readings per sensor to draw overlay lines.</div>
                      ) : (
                        <>
                          <div style={{ marginTop: 8, overflowX: "auto" }}>
                            <svg width={chartWidth} height={chartHeight + 28} viewBox={`0 0 ${chartWidth} ${chartHeight + 28}`} role="img" aria-label={`24 hour sensor overlay for ${hub.name}`}>
                              <line x1="0" y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="var(--border)" strokeWidth="1" />
                              <line x1="0" y1="0" x2="0" y2={chartHeight} stroke="var(--border)" strokeWidth="1" />

                              {series.map((s) => {
                                const pts = linePointsForTimedSeries({
                                  points: s.points,
                                  width: chartWidth,
                                  height: chartHeight,
                                  minTemp: paddedMin,
                                  maxTemp: paddedMax,
                                  startTs,
                                  endTs: nowTs,
                                });

                                return (
                                  <polyline
                                    key={`overlay-${s.device.id}`}
                                    points={pts}
                                    fill="none"
                                    stroke={s.color}
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                );
                              })}

                              <text x="0" y={chartHeight + 18} fill="var(--muted)" fontSize="11">
                                24h ago
                              </text>
                              <text x={chartWidth - 28} y={chartHeight + 18} fill="var(--muted)" fontSize="11">
                                now
                              </text>
                              <text x="4" y="12" fill="var(--muted)" fontSize="11">
                                {paddedMax.toFixed(1)}F
                              </text>
                              <text x="4" y={chartHeight - 4} fill="var(--muted)" fontSize="11">
                                {paddedMin.toFixed(1)}F
                              </text>
                            </svg>
                          </div>

                          <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap" }}>
                            {series.map((s) => (
                              <div key={`legend-${s.device.id}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                                <span style={{ width: 12, height: 3, background: s.color, borderRadius: 2, display: "inline-block" }} />
                                <span>{s.device.name}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    <div style={{ marginTop: 10, overflowX: "auto" }}>
                      <div
                        style={{
                          marginBottom: 8,
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          background: "var(--surface)",
                          padding: 8,
                          display: "flex",
                          gap: 12,
                          flexWrap: "wrap",
                          alignItems: "center",
                          fontSize: 12,
                        }}
                      >
                        <strong>Connection Health:</strong>
                        {hub.devices.map((device) => {
                          const latest = latestReadingByDevice.get(device.id);
                          const dSeen = latest?.recordedAt ?? device.lastSeenAt ?? device.lastReadingAt;
                          const health = getConnectionHealth(dSeen);
                          return (
                            <span key={`health-${device.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <span style={{ width: 8, height: 8, borderRadius: 999, background: health.color, display: "inline-block" }} />
                              <span>
                                {device.name}: <b>{health.label}</b>
                                {health.minutes !== null ? ` (${health.minutes}m)` : ""}
                              </span>
                            </span>
                          );
                        })}
                        {hub.devices.length === 0 ? <span style={{ opacity: 0.75 }}>No sensors discovered yet.</span> : null}
                      </div>

                      <div style={{ marginBottom: 6, fontSize: 12, opacity: 0.8 }}>
                        Connection status is based on webhook "last seen" timestamps.
                      </div>
                      <div style={{ marginBottom: 6, fontSize: 12, opacity: 0.8 }}>
                        Live sensor table (auto-refresh) with 24h trend sparkline per sensor.
                      </div>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid var(--border)" }}>
                            <th style={{ textAlign: "left", padding: "6px 4px", fontSize: 12 }}>Device</th>
                            <th style={{ textAlign: "left", padding: "6px 4px", fontSize: 12 }}>Device ID</th>
                            <th style={{ textAlign: "left", padding: "6px 4px", fontSize: 12 }}>Connection</th>
                            <th style={{ textAlign: "left", padding: "6px 4px", fontSize: 12 }}>Thresholds (F)</th>
                            <th style={{ textAlign: "left", padding: "6px 4px", fontSize: 12 }}>Current Temp</th>
                            <th style={{ textAlign: "left", padding: "6px 4px", fontSize: 12 }}>Trend (24h)</th>
                            <th style={{ textAlign: "left", padding: "6px 4px", fontSize: 12 }}>Alert</th>
                            <th style={{ textAlign: "left", padding: "6px 4px", fontSize: 12 }}>Battery</th>
                            <th style={{ textAlign: "left", padding: "6px 4px", fontSize: 12 }}>Last Seen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hub.devices.map((device) => {
                            const latest = latestReadingByDevice.get(device.id);
                            const dTemp = latest?.tempF ?? toNumberOrNull(device.lastTempF);
                            const dSeen = latest?.recordedAt ?? device.lastSeenAt ?? device.lastReadingAt;
                            const dMin = toNumberOrNull(device.minTempF);
                            const dMax = toNumberOrNull(device.maxTempF);
                            const health = getConnectionHealth(dSeen);
                            const trend = historyByDevice.get(device.id) ?? [];
                            const points = sparklinePoints(trend.map((t) => t.temp));
                            return (
                              <tr key={device.id} style={{ borderBottom: "1px solid var(--border)" }}>
                                <td style={{ padding: "6px 4px" }}>{device.name}</td>
                                <td style={{ padding: "6px 4px", fontFamily: "monospace", fontSize: 12 }}>{device.externalDeviceId}</td>
                                <td style={{ padding: "6px 4px", fontSize: 12, whiteSpace: "nowrap" }}>
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: 999, background: health.color, display: "inline-block" }} />
                                    <span>
                                      {health.label}
                                      {health.minutes !== null ? ` (${health.minutes}m)` : ""}
                                    </span>
                                  </span>
                                </td>
                                <td style={{ padding: "6px 4px" }}>
                                  {dMin === null && dMax === null
                                    ? `Hub default (${min === null ? "-" : min} to ${max === null ? "-" : max})`
                                    : `${dMin === null ? "-" : dMin} to ${dMax === null ? "-" : dMax}`}
                                </td>
                                <td style={{ padding: "6px 4px", fontWeight: 800 }}>
                                  {dTemp === null ? "No temperature parsed" : `${dTemp.toFixed(1)}F`}
                                </td>
                                <td style={{ padding: "6px 4px" }}>
                                  {trend.length < 2 ? (
                                    <span style={{ fontSize: 12, opacity: 0.75 }}>Need more samples</span>
                                  ) : (
                                    <svg width="160" height="36" viewBox="0 0 160 36" role="img" aria-label={`Temp trend for ${device.name}`}>
                                      <polyline
                                        points={points}
                                        fill="none"
                                        stroke="var(--brand)"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  )}
                                </td>
                                <td style={{ padding: "6px 4px", fontWeight: 800 }}>{device.lastAlertState ?? "UNKNOWN"}</td>
                                <td style={{ padding: "6px 4px" }}>{device.lastBatteryPct === null ? "-" : `${device.lastBatteryPct}%`}</td>
                                <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{fmtDateTime(dSeen)}</td>
                              </tr>
                            );
                          })}
                          {hub.devices.length === 0 ? (
                            <tr>
                              <td colSpan={9} style={{ padding: "8px 4px", opacity: 0.8 }}>
                                No readings have been received yet for this hub.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>

                    {isAdmin ? (
                      <details style={{ marginTop: 10 }}>
                        <summary style={{ cursor: "pointer", fontWeight: 800 }}>Edit Sensor Thresholds</summary>
                        {hub.devices.length === 0 ? (
                          <div
                            style={{
                              marginTop: 8,
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              padding: 10,
                              background: "var(--surface)",
                              fontSize: 13,
                              opacity: 0.9,
                            }}
                          >
                            No sensors discovered yet for this hub. Run <strong>Webhook Pairing Test</strong> for this hub or verify Mocreo webhook delivery. Sensor controls appear here after the first reading is ingested.
                          </div>
                        ) : (
                          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                            {hub.devices.map((device) => (
                              <form
                                key={`threshold-${device.id}`}
                                action={saveDeviceThresholdAction}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "minmax(180px, 2fr) repeat(2, minmax(120px, 1fr)) auto",
                                  gap: 8,
                                  alignItems: "end",
                                  border: "1px solid var(--border)",
                                  borderRadius: 8,
                                  padding: 8,
                                  background: "var(--surface)",
                                }}
                              >
                                <input type="hidden" name="hubId" value={hub.id} />
                                <input type="hidden" name="deviceId" value={device.id} />

                                <label style={{ display: "grid", gap: 2 }}>
                                  <span style={{ fontWeight: 700, fontSize: 12 }}>{device.name}</span>
                                  <span style={{ opacity: 0.75, fontSize: 11, fontFamily: "monospace" }}>{device.externalDeviceId}</span>
                                </label>

                                <label style={{ display: "grid", gap: 2 }}>
                                  <span style={{ fontSize: 12, fontWeight: 700 }}>Min F</span>
                                  <input
                                    name="deviceMinTempF"
                                    type="number"
                                    step="0.1"
                                    defaultValue={toNumberOrNull(device.minTempF) ?? ""}
                                    placeholder={toNumberOrNull(hub.minTempF) === null ? "Hub default" : String(toNumberOrNull(hub.minTempF))}
                                    style={{ padding: "7px 8px", borderRadius: 8, border: "1px solid var(--border)" }}
                                  />
                                </label>

                                <label style={{ display: "grid", gap: 2 }}>
                                  <span style={{ fontSize: 12, fontWeight: 700 }}>Max F</span>
                                  <input
                                    name="deviceMaxTempF"
                                    type="number"
                                    step="0.1"
                                    defaultValue={toNumberOrNull(device.maxTempF) ?? ""}
                                    placeholder={toNumberOrNull(hub.maxTempF) === null ? "Hub default" : String(toNumberOrNull(hub.maxTempF))}
                                    style={{ padding: "7px 8px", borderRadius: 8, border: "1px solid var(--border)" }}
                                  />
                                </label>

                                <button
                                  type="submit"
                                  style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface-2)", fontWeight: 800, cursor: "pointer" }}
                                >
                                  Save Sensor
                                </button>
                              </form>
                            ))}

                            {hub.devices.map((device) => (
                              <form
                                key={`delete-sensor-${device.id}`}
                                action={deleteSensorAction}
                                style={{
                                  display: "flex",
                                  justifyContent: "flex-end",
                                  marginTop: -4,
                                }}
                              >
                                <input type="hidden" name="deviceId" value={device.id} />
                                <button
                                  type="submit"
                                  style={{
                                    padding: "6px 10px",
                                    border: "1px solid rgba(239,68,68,0.45)",
                                    borderRadius: 8,
                                    background: "rgba(239,68,68,0.12)",
                                    fontWeight: 800,
                                    cursor: "pointer",
                                  }}
                                  title={`Delete sensor ${device.name}`}
                                >
                                  Delete Sensor: {device.name}
                                </button>
                              </form>
                            ))}
                          </div>
                        )}
                      </details>
                    ) : null}

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
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
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
        </details>

        <details open>
          <summary style={{ cursor: "pointer", fontWeight: 900, fontSize: 16, padding: "2px 2px" }}>Recent Alerts</summary>
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
        </details>
      </div>
    </main>
  );
}
