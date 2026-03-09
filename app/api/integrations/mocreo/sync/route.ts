import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/app/lib/prisma";
import {
  evaluateTemperatureAlertState,
  notifyTemperatureAlert,
  shouldSendAlert,
  toNumberOrNull,
} from "@/app/lib/mocreo";

export const dynamic = "force-dynamic";

const MOCREO_BASE_URL = "https://api.sync-sign.com/v2";
const MAX_POLL_MINUTES = 180;
const SAMPLE_PAGE_SIZE = 200;

function normalizeKey(value: string): string {
  return value.trim().toUpperCase();
}

type MocreoNode = {
  nodeId?: string;
  thingName?: string;
  name?: string;
  batteryLevel?: number | null;
  signalLevel?: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function toNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractAccessToken(payload: unknown): string {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const token =
    toNonEmptyString(root.accessToken) ||
    toNonEmptyString(root.access_token) ||
    toNonEmptyString(data.accessToken) ||
    toNonEmptyString(data.access_token) ||
    toNonEmptyString(root.token) ||
    toNonEmptyString(data.token);
  return token;
}

function extractApiErrorMessage(payload: unknown): string {
  const root = asRecord(payload);
  const err = asRecord(root.error);
  const data = asRecord(root.data);

  return (
    toNonEmptyString(err.message) ||
    toNonEmptyString(root.message) ||
    toNonEmptyString(data.message) ||
    toNonEmptyString(err.name) ||
    ""
  );
}

type MocreoSample = {
  time?: number;
  data?: {
    tm?: number;
  };
};

type HubRow = {
  id: string;
  name: string;
  externalHubId: string;
  active: boolean;
  minTempF: unknown;
  maxTempF: unknown;
  lastAlertAt: Date | null;
  lastReadingAt: Date | null;
  location: { name: string } | null;
  assignedMaintenanceUserId: string | null;
  recipients: Array<{ userId: string }>;
};

function parseIntSafe(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function cToF(celsius: number): number {
  return celsius * (9 / 5) + 32;
}

function toIntPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.trunc(value)));
}

function resolveSyncAuth(req: NextRequest): boolean {
  const expected = process.env.MOCREO_SYNC_TOKEN?.trim();
  if (!expected) return true;

  const tokenFromHeader = req.headers.get("x-mocreo-sync-token")?.trim();
  if (tokenFromHeader && tokenFromHeader === expected) return true;

  const bearer = req.headers.get("authorization")?.trim() ?? "";
  if (bearer.toLowerCase().startsWith("bearer ")) {
    const incoming = bearer.slice(7).trim();
    if (incoming && incoming === expected) return true;
  }

  const tokenFromQuery = req.nextUrl.searchParams.get("token")?.trim();
  if (tokenFromQuery && tokenFromQuery === expected) return true;

  return false;
}

async function getAccessToken(): Promise<string> {
  const username = process.env.MOCREO_API_USERNAME?.trim();
  const password = process.env.MOCREO_API_PASSWORD?.trim();

  if (!username || !password) {
    throw new Error("Missing MOCREO_API_USERNAME or MOCREO_API_PASSWORD");
  }

  const res = await fetch(`${MOCREO_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password, provider: "mocreo" }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as unknown;
  const token = extractAccessToken(json);
  if (!token) {
    const msg = extractApiErrorMessage(json);
    const raw = JSON.stringify(json).slice(0, 400);
    throw new Error(
      msg
        ? `Mocreo token response missing accessToken: ${msg}`
        : `Mocreo token response missing accessToken. Payload: ${raw}`
    );
  }
  return token;
}

async function fetchNodes(accessToken: string): Promise<MocreoNode[]> {
  const res = await fetch(`${MOCREO_BASE_URL}/nodes`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nodes request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  if (!Array.isArray(json)) return [];
  return json as MocreoNode[];
}

async function fetchNodeSamples(args: {
  accessToken: string;
  nodeId: string;
  beginTimeSec: number;
  endTimeSec: number;
}): Promise<MocreoSample[]> {
  const out: MocreoSample[] = [];
  let offset = 0;

  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`${MOCREO_BASE_URL}/nodes/${encodeURIComponent(args.nodeId)}/samples`);
    url.searchParams.set("limit", String(SAMPLE_PAGE_SIZE));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("beginTime", String(args.beginTimeSec));
    url.searchParams.set("endTime", String(args.endTimeSec));

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${args.accessToken}` },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Samples request failed for node ${args.nodeId} (${res.status}): ${text.slice(0, 300)}`);
    }

    const pageRows = (await res.json()) as unknown;
    if (!Array.isArray(pageRows) || pageRows.length === 0) break;

    out.push(...(pageRows as MocreoSample[]));

    if (pageRows.length < SAMPLE_PAGE_SIZE) break;
    offset += SAMPLE_PAGE_SIZE;

    // Keep requests under Mocreo's documented limit of 5 requests/sec.
    await new Promise((resolve) => setTimeout(resolve, 220));
  }

  return out;
}

async function runSync(req: NextRequest) {
  if (!resolveSyncAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const intervalFromEnv = parseIntSafe(process.env.MOCREO_POLL_INTERVAL_MINUTES);
  const intervalFromQuery = parseIntSafe(req.nextUrl.searchParams.get("minutes"));
  const minutesRaw = intervalFromQuery ?? intervalFromEnv ?? 10;
  const minutes = Math.max(1, Math.min(MAX_POLL_MINUTES, minutesRaw));

  const endTimeSec = parseIntSafe(req.nextUrl.searchParams.get("endTime")) ?? Math.trunc(Date.now() / 1000);
  const beginTimeSec =
    parseIntSafe(req.nextUrl.searchParams.get("beginTime")) ?? Math.max(0, endTimeSec - minutes * 60);

  const hubs = await prisma.mocreoHub.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      externalHubId: true,
      active: true,
      minTempF: true,
      maxTempF: true,
      lastAlertAt: true,
      lastReadingAt: true,
      location: { select: { name: true } },
      assignedMaintenanceUserId: true,
      recipients: { select: { userId: true } },
    },
  });

  const hubByExternalId = new Map<string, HubRow>();
  for (const hub of hubs) {
    hubByExternalId.set(normalizeKey(hub.externalHubId), hub as HubRow);
  }

  const accessToken = await getAccessToken();
  const nodes = await fetchNodes(accessToken);

  const availableThingNames = nodes
    .map((node) => String(node.thingName ?? "").trim())
    .filter((x) => x.length > 0);

  const targetNodes = nodes.filter((node) => {
    const thingName = String(node.thingName ?? "").trim();
    return thingName && hubByExternalId.has(normalizeKey(thingName));
  });

  let ingested = 0;
  let alerted = 0;
  let skippedDuplicate = 0;
  let skippedNoTemp = 0;

  for (const node of targetNodes) {
    const nodeId = String(node.nodeId ?? "").trim();
    const thingName = String(node.thingName ?? "").trim();
    if (!nodeId || !thingName) continue;

    const hub = hubByExternalId.get(normalizeKey(thingName));
    if (!hub) continue;

    const samples = await fetchNodeSamples({
      accessToken,
      nodeId,
      beginTimeSec,
      endTimeSec,
    });

    if (samples.length === 0) continue;

    const uniqueById = new Map<string, MocreoSample>();
    for (const sample of samples) {
      const ts = Number(sample.time);
      if (!Number.isFinite(ts)) continue;
      const externalReadingId = `poll:${nodeId}:${Math.trunc(ts)}`;
      uniqueById.set(externalReadingId, sample);
    }

    const externalIds = Array.from(uniqueById.keys());
    if (externalIds.length === 0) continue;

    const existing = await prisma.mocreoTemperatureReading.findMany({
      where: { externalReadingId: { in: externalIds } },
      select: { externalReadingId: true },
    });
    const existingSet = new Set(existing.map((x) => String(x.externalReadingId ?? "")).filter(Boolean));

    const existingDevice = await prisma.mocreoDevice.findUnique({
      where: {
        hubId_externalDeviceId: {
          hubId: hub.id,
          externalDeviceId: nodeId,
        },
      },
      select: { id: true, minTempF: true, maxTempF: true },
    });

    const deviceMinTempF = toNumberOrNull(existingDevice?.minTempF);
    const deviceMaxTempF = toNumberOrNull(existingDevice?.maxTempF);
    const hubMinTempF = toNumberOrNull(hub.minTempF);
    const hubMaxTempF = toNumberOrNull(hub.maxTempF);

    const sortedPairs = Array.from(uniqueById.entries()).sort((a, b) => {
      const at = Number(a[1].time ?? 0);
      const bt = Number(b[1].time ?? 0);
      return at - bt;
    });

    let latestReadingAt: Date | null = hub.lastReadingAt;
    let latestTempF: number | null = null;
    let latestState: "NORMAL" | "HIGH" | "LOW" | "UNKNOWN" = "UNKNOWN";
    let hubLastAlertAt = hub.lastAlertAt;

    for (const [externalReadingId, sample] of sortedPairs) {
      if (existingSet.has(externalReadingId)) {
        skippedDuplicate += 1;
        continue;
      }

      const tempRaw = Number(sample.data?.tm);
      if (!Number.isFinite(tempRaw)) {
        skippedNoTemp += 1;
        continue;
      }

      const recordedAt = new Date(Math.trunc(Number(sample.time) * 1000));
      const tempF = cToF(tempRaw / 100);
      const alertState = evaluateTemperatureAlertState(tempF, {
        minTempF: deviceMinTempF ?? hubMinTempF,
        maxTempF: deviceMaxTempF ?? hubMaxTempF,
      });

      const device = await prisma.mocreoDevice.upsert({
        where: {
          hubId_externalDeviceId: {
            hubId: hub.id,
            externalDeviceId: nodeId,
          },
        },
        update: {
          name: String(node.name ?? "").trim() || `Node ${nodeId}`,
          lastSeenAt: recordedAt,
          lastReadingAt: recordedAt,
          lastTempF: tempF,
          lastBatteryPct: toIntPercent(node.batteryLevel),
          lastSignalPct: toIntPercent(node.signalLevel),
          lastAlertState: alertState,
          lastRawPayload: { source: "mocreo-public-api-poll", node, sample },
        },
        create: {
          hubId: hub.id,
          externalDeviceId: nodeId,
          name: String(node.name ?? "").trim() || `Node ${nodeId}`,
          lastSeenAt: recordedAt,
          lastReadingAt: recordedAt,
          lastTempF: tempF,
          lastBatteryPct: toIntPercent(node.batteryLevel),
          lastSignalPct: toIntPercent(node.signalLevel),
          lastAlertState: alertState,
          lastRawPayload: { source: "mocreo-public-api-poll", node, sample },
        },
        select: { id: true },
      });

      await prisma.mocreoTemperatureReading.create({
        data: {
          hubId: hub.id,
          deviceId: device.id,
          externalReadingId,
          recordedAt,
          tempF,
          batteryPct: toIntPercent(node.batteryLevel),
          signalPct: toIntPercent(node.signalLevel),
          alertState,
          rawPayload: { source: "mocreo-public-api-poll", node, sample },
        },
      });

      const shouldAlert = shouldSendAlert(alertState, hubLastAlertAt);
      if (shouldAlert) {
        const recipients = new Set<string>();
        if (hub.assignedMaintenanceUserId) recipients.add(hub.assignedMaintenanceUserId);
        for (const row of hub.recipients) recipients.add(row.userId);

        await notifyTemperatureAlert({
          userIds: Array.from(recipients),
          hubName: hub.name,
          locationName: hub.location?.name ?? null,
          temperatureF: tempF,
          alertState,
          href: "/maintenance/temperature-dashboard",
        });
        hubLastAlertAt = new Date();
        alerted += 1;
      }

      if (!latestReadingAt || recordedAt.getTime() >= latestReadingAt.getTime()) {
        latestReadingAt = recordedAt;
        latestTempF = tempF;
        latestState = alertState;
      }

      ingested += 1;
    }

    if (latestReadingAt) {
      await prisma.mocreoHub.update({
        where: { id: hub.id },
        data: {
          lastReadingAt: latestReadingAt,
          lastTempF: latestTempF,
          lastAlertState: latestState,
          lastAlertAt: hubLastAlertAt,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        module: "MOCREO_TEMPERATURE",
        action: "POLL_SYNC_COMPLETED",
        entityType: "MocreoHub",
        entityId: hub.id,
        message: `Mocreo poll sync processed for hub ${hub.name}.`,
        metadata: {
          externalHubId: hub.externalHubId,
          nodeId,
          beginTimeSec,
          endTimeSec,
          sampleCandidates: samples.length,
          ingested,
          skippedDuplicate,
          skippedNoTemp,
          alerted,
        },
      },
    });

    // Keep requests under Mocreo's documented limit of 5 requests/sec.
    await new Promise((resolve) => setTimeout(resolve, 220));
  }

  return NextResponse.json({
    ok: true,
    beginTimeSec,
    endTimeSec,
    minutes,
    hubsActive: hubs.length,
    nodesFound: nodes.length,
    nodesMatched: targetNodes.length,
    availableThingNamesSample: availableThingNames.slice(0, 8),
    ingested,
    skippedDuplicate,
    skippedNoTemp,
    alerted,
  });
}

export async function POST(req: NextRequest) {
  try {
    return await runSync(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    return await runSync(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
