import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/app/lib/prisma";
import {
  evaluateTemperatureAlertState,
  notifyTemperatureAlert,
  parseMocreoWebhookPayload,
  shouldSendAlert,
} from "@/app/lib/mocreo";

export const dynamic = "force-dynamic";

type Db = {
  mocreoHub: {
    findUnique: (args: unknown) => Promise<
      | {
          id: string;
          name: string;
          active: boolean;
          minTempF: unknown;
          maxTempF: unknown;
          lastAlertAt: Date | null;
          location: { name: string } | null;
          assignedMaintenanceUserId: string | null;
          recipients: Array<{ userId: string }>;
        }
      | null
    >;
    update: (args: unknown) => Promise<unknown>;
  };
  mocreoDevice: {
    findUnique: (args: unknown) => Promise<
      | {
          id: string;
          minTempF: unknown;
          maxTempF: unknown;
        }
      | null
    >;
    upsert: (args: unknown) => Promise<{ id: string }>;
  };
  mocreoTemperatureReading: {
    create: (args: unknown) => Promise<unknown>;
  };
  auditLog: {
    create: (args: unknown) => Promise<unknown>;
  };
};

const db = prisma as unknown as Db;

function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function collectPayloadCandidates(raw: unknown): unknown[] {
  const out: unknown[] = [raw];
  const root = asObject(raw);
  if (!root) return out;

  const pushArray = (v: unknown) => {
    if (!Array.isArray(v)) return;
    for (const entry of v) out.push(entry);
  };

  pushArray(root.events);
  pushArray(root.readings);
  pushArray(root.records);
  pushArray(root.data);
  pushArray(root.sensors);
  pushArray(root.devices);

  const eventObj = asObject(root.event);
  if (eventObj) {
    pushArray(eventObj.readings);
    pushArray(eventObj.records);
    pushArray(eventObj.data);
    pushArray(eventObj.sensors);
    pushArray(eventObj.devices);
  }

  return out;
}

export async function POST(req: NextRequest) {
  const webhookToken = process.env.MOCREO_WEBHOOK_TOKEN?.trim();
  if (webhookToken) {
    const incoming = req.headers.get("x-mocreo-token")?.trim() ?? "";
    if (!incoming || incoming !== webhookToken) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const candidates = collectPayloadCandidates(body);
  const parsedReadings = new Map<string, ReturnType<typeof parseMocreoWebhookPayload>>();

  for (const candidate of candidates) {
    const direct = parseMocreoWebhookPayload(candidate);
    if (direct) {
      const key = `${direct.externalHubId}::${direct.externalDeviceId}::${direct.externalReadingId ?? direct.recordedAt.toISOString()}`;
      parsedReadings.set(key, direct);
      continue;
    }

    const root = asObject(body);
    const leaf = asObject(candidate);
    if (!root || !leaf) continue;

    const withEvent = parseMocreoWebhookPayload({ ...root, event: leaf });
    if (withEvent) {
      const key = `${withEvent.externalHubId}::${withEvent.externalDeviceId}::${withEvent.externalReadingId ?? withEvent.recordedAt.toISOString()}`;
      parsedReadings.set(key, withEvent);
      continue;
    }

    const merged = parseMocreoWebhookPayload({ ...root, ...leaf });
    if (merged) {
      const key = `${merged.externalHubId}::${merged.externalDeviceId}::${merged.externalReadingId ?? merged.recordedAt.toISOString()}`;
      parsedReadings.set(key, merged);
    }
  }

  const parsedList = Array.from(parsedReadings.values()).filter(
    (x): x is NonNullable<typeof x> => x !== null
  );

  if (parsedList.length === 0) {
    return NextResponse.json({ ok: false, error: "Unsupported Mocreo payload shape" }, { status: 400 });
  }

  let ingested = 0;
  let alertedCount = 0;
  let ignoredNoHub = 0;
  let ignoredInactive = 0;
  const states: string[] = [];

  for (const parsed of parsedList) {
    const hub = await db.mocreoHub.findUnique({
      where: { externalHubId: parsed.externalHubId },
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

    if (!hub) {
      ignoredNoHub += 1;
      continue;
    }

    if (!hub.active) {
      ignoredInactive += 1;
      continue;
    }

    const hubMinTempF = decimalToNumber(hub.minTempF);
    const hubMaxTempF = decimalToNumber(hub.maxTempF);

    const existingDevice = await db.mocreoDevice.findUnique({
      where: {
        hubId_externalDeviceId: {
          hubId: hub.id,
          externalDeviceId: parsed.externalDeviceId,
        },
      },
      select: { id: true, minTempF: true, maxTempF: true },
    });

    const deviceMinTempF = decimalToNumber(existingDevice?.minTempF);
    const deviceMaxTempF = decimalToNumber(existingDevice?.maxTempF);

    const alertState = evaluateTemperatureAlertState(parsed.temperatureF, {
      minTempF: deviceMinTempF ?? hubMinTempF,
      maxTempF: deviceMaxTempF ?? hubMaxTempF,
    });

    const device = await db.mocreoDevice.upsert({
      where: {
        hubId_externalDeviceId: {
          hubId: hub.id,
          externalDeviceId: parsed.externalDeviceId,
        },
      },
      update: {
        name: parsed.deviceName,
        lastSeenAt: parsed.recordedAt,
        lastReadingAt: parsed.recordedAt,
        lastTempF: parsed.temperatureF,
        lastBatteryPct: parsed.batteryPct,
        lastSignalPct: parsed.signalPct,
        lastAlertState: alertState,
        lastRawPayload: parsed.rawPayload,
      },
      create: {
        hubId: hub.id,
        externalDeviceId: parsed.externalDeviceId,
        name: parsed.deviceName,
        lastSeenAt: parsed.recordedAt,
        lastReadingAt: parsed.recordedAt,
        lastTempF: parsed.temperatureF,
        lastBatteryPct: parsed.batteryPct,
        lastSignalPct: parsed.signalPct,
        lastAlertState: alertState,
        lastRawPayload: parsed.rawPayload,
      },
      select: { id: true },
    });

    await db.mocreoTemperatureReading.create({
      data: {
        hubId: hub.id,
        deviceId: device.id,
        externalReadingId: parsed.externalReadingId,
        recordedAt: parsed.recordedAt,
        tempF: parsed.temperatureF,
        batteryPct: parsed.batteryPct,
        signalPct: parsed.signalPct,
        alertState,
        rawPayload: parsed.rawPayload,
      },
    });

    const sendAlert = shouldSendAlert(alertState, hub.lastAlertAt);

    await db.mocreoHub.update({
      where: { id: hub.id },
      data: {
        lastReadingAt: parsed.recordedAt,
        lastTempF: parsed.temperatureF,
        lastAlertState: alertState,
        lastAlertAt: sendAlert ? new Date() : hub.lastAlertAt,
      },
    });

    if (sendAlert) {
      const recipients = new Set<string>();
      if (hub.assignedMaintenanceUserId) recipients.add(hub.assignedMaintenanceUserId);
      for (const row of hub.recipients) recipients.add(row.userId);

      await notifyTemperatureAlert({
        userIds: Array.from(recipients),
        hubName: hub.name,
        locationName: hub.location?.name ?? null,
        temperatureF: parsed.temperatureF,
        alertState,
        href: "/maintenance/temperature-dashboard",
      });
      alertedCount += 1;
    }

    await db.auditLog.create({
      data: {
        module: "MOCREO_TEMPERATURE",
        action: "WEBHOOK_READING_INGESTED",
        entityType: "MocreoHub",
        entityId: hub.id,
        message: `Ingested Mocreo reading for hub ${hub.name}.`,
        metadata: {
          externalHubId: parsed.externalHubId,
          externalDeviceId: parsed.externalDeviceId,
          recordedAt: parsed.recordedAt.toISOString(),
          temperatureF: parsed.temperatureF,
          alertState,
          thresholds: {
            hub: { minTempF: hubMinTempF, maxTempF: hubMaxTempF },
            device: { minTempF: deviceMinTempF, maxTempF: deviceMaxTempF },
            effective: {
              minTempF: deviceMinTempF ?? hubMinTempF,
              maxTempF: deviceMaxTempF ?? hubMaxTempF,
            },
          },
        },
      },
    });

    ingested += 1;
    states.push(alertState);
  }

  if (ingested === 0 && ignoredNoHub > 0) {
    return NextResponse.json({ ok: true, ignored: true, reason: "hub_not_registered", candidates: parsedList.length }, { status: 202 });
  }

  if (ingested === 0 && ignoredInactive > 0) {
    return NextResponse.json({ ok: true, ignored: true, reason: "hub_inactive", candidates: parsedList.length }, { status: 202 });
  }

  return NextResponse.json({
    ok: true,
    candidates: parsedList.length,
    ingested,
    ignoredNoHub,
    ignoredInactive,
    alerted: alertedCount,
    alertStates: Array.from(new Set(states)),
  });
}
