import { prisma } from "@/app/lib/prisma";
import {
  evaluateTemperatureAlertState,
  notifyTemperatureAlert,
  shouldSendAlert,
  toNumberOrNull,
} from "@/app/lib/mocreo";

const MOCREO_BASE_URL = "https://api.sync-sign.com/v2";
const MAX_POLL_MINUTES = 180;
const SAMPLE_PAGE_SIZE = 200;
const DEFAULT_FALLBACK_MINUTES = 24 * 60;
const MAX_FALLBACK_MINUTES = 7 * 24 * 60;

type MocreoNode = {
  nodeId?: string;
  node_id?: string;
  thingName?: string;
  thing_name?: string;
  name?: string;
  batteryLevel?: number | null;
  battery_level?: number | null;
  signalLevel?: number | null;
  signal_level?: number | null;
};

type MocreoDevice = {
  id?: string;
  deviceId?: string;
  device_id?: string;
  nodeId?: string;
  node_id?: string;
  sensorId?: string;
  sensor_id?: string;
  thing_id?: string;
  thingId?: string;
  thingName?: string;
  thing_name?: string;
  sn?: string;
  hubId?: string;
  hub_id?: string;
  gatewayId?: string;
  gateway_id?: string;
  parentThingName?: string;
  parent_thing_name?: string;
  info?: {
    id?: string;
    deviceId?: string;
    device_id?: string;
    nodeId?: string;
    node_id?: string;
    sensorId?: string;
    sensor_id?: string;
    thingId?: string;
    thing_id?: string;
    thingName?: string;
    thing_name?: string;
    sn?: string;
    hubId?: string;
    hub_id?: string;
    gatewayId?: string;
    gateway_id?: string;
    parentThingName?: string;
    parent_thing_name?: string;
  };
};

type MocreoSample = {
  time?: number;
  timestamp?: number | string;
  ts?: number | string;
  recordedAt?: number | string;
  createdAt?: number | string;
  data?: {
    tm?: number;
    time?: number | string;
    timestamp?: number | string;
    ts?: number | string;
    recordedAt?: number | string;
    tempF?: number;
    temperatureF?: number;
    tempC?: number;
    temperatureC?: number;
  };
  tempF?: number;
  temperatureF?: number;
  tempC?: number;
  temperatureC?: number;
};

type NormalizedSample = {
  externalReadingId: string;
  timestampSec: number;
  sample: MocreoSample;
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

export type MocreoSyncResult = {
  ok: true;
  beginTimeSec: number;
  endTimeSec: number;
  minutes: number;
  hubsActive: number;
  nodesFound: number;
  devicesFound: number;
  nodesMatched: number;
  availableThingNamesSample: string[];
  availableDeviceThingNamesSample: string[];
  ingested: number;
  samplesFetched: number;
  matchedNodesNoSamples: number;
  fallbackNodesQueried: number;
  sampleIdsTried: number;
  sampleRequestAttempts: number;
  snapshotFallbackUsed: number;
  debugNodeKeysSample: string[];
  debugNodeProbeKeysSample: string[];
  debugNodeDetailKeysSample: string[];
  debugDeviceKeysSample: string[];
  debugDeviceInfoKeysSample: string[];
  skippedDuplicate: number;
  skippedNoTemp: number;
  skippedNoTimestamp: number;
  alerted: number;
};

export type MocreoSyncOptions = {
  minutes?: string | number | null;
  beginTimeSec?: string | number | null;
  endTimeSec?: string | number | null;
};

function normalizeKey(value: string): string {
  return value.trim().toUpperCase();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function toNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseIntSafe(value: string | number | null | undefined): number | null {
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

function extractArrayPayload<T = unknown>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];

  const root = asRecord(payload);
  const candidates = [root.data, root.items, root.records, root.nodes, root.devices, root.events];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as T[];
  }

  return [];
}

function topLevelKeys(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).sort();
}

async function fetchNodeDetailCandidate(args: {
  accessToken: string;
  candidateId: string;
}): Promise<unknown | null> {
  const endpoints = [
    `${MOCREO_BASE_URL}/nodes/${encodeURIComponent(args.candidateId)}`,
    `${MOCREO_BASE_URL}/nodes/${encodeURIComponent(args.candidateId)}/status`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${args.accessToken}` },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const json = (await res.json()) as unknown;
      if (json && typeof json === "object") return json;
    } catch {
      // Ignore and continue to next candidate/endpoint.
    }
  }

  return null;
}

function getNodeId(node: MocreoNode): string {
  return String(node.nodeId ?? node.node_id ?? "").trim();
}

function getNodeThingName(node: MocreoNode): string {
  return String(node.thingName ?? node.thing_name ?? "").trim();
}

function getDeviceHubRef(device: MocreoDevice): string {
  const info = asRecord(device.info);
  return (
    String(device.hubId ?? "").trim() ||
    String(device.hub_id ?? "").trim() ||
    String(device.gatewayId ?? "").trim() ||
    String(device.gateway_id ?? "").trim() ||
    String(device.parentThingName ?? "").trim() ||
    String(device.parent_thing_name ?? "").trim() ||
    String(device.thingName ?? "").trim() ||
    String(device.thing_name ?? "").trim() ||
    String(device.sn ?? "").trim() ||
    String(info.hubId ?? "").trim() ||
    String(info.hub_id ?? "").trim() ||
    String(info.gatewayId ?? "").trim() ||
    String(info.gateway_id ?? "").trim() ||
    String(info.parentThingName ?? "").trim() ||
    String(info.parent_thing_name ?? "").trim() ||
    String(info.thingName ?? "").trim() ||
    String(info.thing_name ?? "").trim() ||
    String(info.sn ?? "").trim()
  );
}

function getDeviceSampleIdCandidates(device: MocreoDevice): string[] {
  const info = asRecord(device.info);
  return Array.from(
    new Set(
      [
        String(device.thingName ?? "").trim(),
        String(device.thing_name ?? "").trim(),
        String(device.sn ?? "").trim(),
        String(device.nodeId ?? "").trim(),
        String(device.node_id ?? "").trim(),
        String(device.deviceId ?? "").trim(),
        String(device.device_id ?? "").trim(),
        String(device.sensorId ?? "").trim(),
        String(device.sensor_id ?? "").trim(),
        String(device.id ?? "").trim(),
        String(device.thingId ?? "").trim(),
        String(device.thing_id ?? "").trim(),
        String(info.nodeId ?? "").trim(),
        String(info.node_id ?? "").trim(),
        String(info.deviceId ?? "").trim(),
        String(info.device_id ?? "").trim(),
        String(info.sensorId ?? "").trim(),
        String(info.sensor_id ?? "").trim(),
        String(info.id ?? "").trim(),
        String(info.thingId ?? "").trim(),
        String(info.thing_id ?? "").trim(),
        String(info.thingName ?? "").trim(),
        String(info.thing_name ?? "").trim(),
        String(info.sn ?? "").trim(),
      ].filter(Boolean)
    )
  );
}

function getNodeBatteryLevel(node: MocreoNode): number | null {
  const n = Number(node.batteryLevel ?? node.battery_level ?? NaN);
  return Number.isFinite(n) ? n : null;
}

function getNodeSignalLevel(node: MocreoNode): number | null {
  const n = Number(node.signalLevel ?? node.signal_level ?? NaN);
  return Number.isFinite(n) ? n : null;
}

function parseTimestampSec(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 10_000_000_000) return Math.trunc(value / 1000);
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      if (asNumber > 10_000_000_000) return Math.trunc(asNumber / 1000);
      return Math.trunc(asNumber);
    }

    const asDateMs = Date.parse(trimmed);
    if (Number.isFinite(asDateMs)) return Math.trunc(asDateMs / 1000);
  }

  return null;
}

function parseSampleTimestampSec(sample: MocreoSample): number | null {
  const data = asRecord(sample.data);
  const candidates: unknown[] = [
    sample.time,
    sample.timestamp,
    sample.ts,
    sample.recordedAt,
    sample.createdAt,
    data.time,
    data.timestamp,
    data.ts,
    data.recordedAt,
  ];

  for (const value of candidates) {
    const ts = parseTimestampSec(value);
    if (ts !== null) return ts;
  }

  return null;
}

function parseSampleTempF(sample: MocreoSample): number | null {
  const data = asRecord(sample.data);

  const centiC = toNumberOrNull(data.tm);
  if (centiC !== null) return cToF(centiC / 100);

  const directF =
    toNumberOrNull(sample.temperatureF) ??
    toNumberOrNull(sample.tempF) ??
    toNumberOrNull(data.temperatureF) ??
    toNumberOrNull(data.tempF);
  if (directF !== null) return directF;

  const directC =
    toNumberOrNull(sample.temperatureC) ??
    toNumberOrNull(sample.tempC) ??
    toNumberOrNull(data.temperatureC) ??
    toNumberOrNull(data.tempC);
  if (directC !== null) return cToF(directC);

  return null;
}

function parseTempFFromUnknown(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;

  const seen = new WeakSet<object>();
  const stack: unknown[] = [value];
  let scanned = 0;

  while (stack.length > 0 && scanned < 400) {
    const current = stack.pop();
    if (typeof current !== "object" || current === null) continue;
    if (seen.has(current)) continue;
    seen.add(current);
    scanned += 1;

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    const obj = current as Record<string, unknown>;

    const directF =
      toNumberOrNull(obj.temperatureF) ??
      toNumberOrNull(obj.tempF) ??
      toNumberOrNull(obj.lastTempF) ??
      toNumberOrNull(obj.currentTempF) ??
      toNumberOrNull(obj.fahrenheit);
    if (directF !== null) return directF;

    const directC =
      toNumberOrNull(obj.temperatureC) ??
      toNumberOrNull(obj.tempC) ??
      toNumberOrNull(obj.lastTempC) ??
      toNumberOrNull(obj.currentTempC) ??
      toNumberOrNull(obj.celsius);
    if (directC !== null) return cToF(directC);

    const centiC = toNumberOrNull(obj.tm);
    if (centiC !== null) return cToF(centiC / 100);

    for (const [key, raw] of Object.entries(obj)) {
      const k = key.toLowerCase();
      const n = toNumberOrNull(raw);
      if (n !== null) {
        if (k.includes("fahrenheit") || k.endsWith("f") || k.includes("temp_f")) return n;
        if (k.includes("celsius") || k.endsWith("c") || k.includes("temp_c")) return cToF(n);
        if (k === "temperature" || k === "temp") return n;

        // Probe-style payloads sometimes expose generic numeric "value" with nearby type/name hints.
        if (k === "value" || k === "val" || k === "reading" || k === "current") {
          const hint = String(obj.type ?? obj.kind ?? obj.name ?? obj.label ?? "").toLowerCase();
          const unit = String(obj.unit ?? obj.units ?? "").toLowerCase();
          if (hint.includes("temp") || hint.includes("temperature")) {
            if (unit === "c" || unit.includes("celsius")) return cToF(n);
            return n;
          }
        }
      }

      if (typeof raw === "object" && raw !== null) stack.push(raw);
    }
  }

  return null;
}

function parseTimestampFromUnknown(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;

  const seen = new WeakSet<object>();
  const stack: unknown[] = [value];
  let scanned = 0;

  while (stack.length > 0 && scanned < 400) {
    const current = stack.pop();
    if (typeof current !== "object" || current === null) continue;
    if (seen.has(current)) continue;
    seen.add(current);
    scanned += 1;

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    const obj = current as Record<string, unknown>;
    const direct = [obj.time, obj.timestamp, obj.ts, obj.recordedAt, obj.createdAt, obj.lastSeenAt, obj.updatedAt];
    for (const candidate of direct) {
      const ts = parseTimestampSec(candidate);
      if (ts !== null) return ts;
    }

    for (const [key, raw] of Object.entries(obj)) {
      const k = key.toLowerCase();
      if (k.includes("time") || k.includes("date") || k.includes("seen") || k.includes("updated")) {
        const ts = parseTimestampSec(raw);
        if (ts !== null) return ts;
      }

      if (typeof raw === "object" && raw !== null) stack.push(raw);
    }
  }

  return null;
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
  return extractArrayPayload<MocreoNode>(json);
}

async function fetchDevices(accessToken: string): Promise<MocreoDevice[]> {
  const res = await fetch(`${MOCREO_BASE_URL}/devices`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!res.ok) {
    return [];
  }

  const json = await res.json();
  return extractArrayPayload<MocreoDevice>(json);
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

    const pageRowsRaw = (await res.json()) as unknown;
    const pageRows = extractArrayPayload<MocreoSample>(pageRowsRaw);
    if (pageRows.length === 0) break;

    out.push(...pageRows);

    if (pageRows.length < SAMPLE_PAGE_SIZE) break;
    offset += SAMPLE_PAGE_SIZE;

    // Keep requests under Mocreo's documented limit of 5 requests/sec.
    await new Promise((resolve) => setTimeout(resolve, 220));
  }

  return out;
}

async function fetchSamplesForCandidate(args: {
  accessToken: string;
  candidateId: string;
  beginTimeSec: number;
  endTimeSec: number;
}): Promise<{ samples: MocreoSample[]; attempts: number }> {
  const baseArgs = {
    accessToken: args.accessToken,
    beginTimeSec: args.beginTimeSec,
    endTimeSec: args.endTimeSec,
  };

  let attempts = 0;

  // Most tenants use node IDs here.
  attempts += 1;
  try {
    const samples = await fetchNodeSamples({
      ...baseArgs,
      nodeId: args.candidateId,
    });
    if (samples.length > 0) return { samples, attempts };
  } catch {
    // Try alternate path below.
  }

  // Some tenants expose sample history behind /devices/{id}/samples.
  attempts += 1;
  try {
    const out: MocreoSample[] = [];
    let offset = 0;

    for (let page = 0; page < 20; page += 1) {
      const url = new URL(`${MOCREO_BASE_URL}/devices/${encodeURIComponent(args.candidateId)}/samples`);
      url.searchParams.set("limit", String(SAMPLE_PAGE_SIZE));
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("beginTime", String(args.beginTimeSec));
      url.searchParams.set("endTime", String(args.endTimeSec));

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${args.accessToken}` },
        cache: "no-store",
      });

      if (!res.ok) break;

      const pageRowsRaw = (await res.json()) as unknown;
      const pageRows = extractArrayPayload<MocreoSample>(pageRowsRaw);
      if (pageRows.length === 0) break;

      out.push(...pageRows);

      if (pageRows.length < SAMPLE_PAGE_SIZE) break;
      offset += SAMPLE_PAGE_SIZE;
      await new Promise((resolve) => setTimeout(resolve, 220));
    }

    if (out.length > 0) return { samples: out, attempts };
  } catch {
    // No-op: caller handles empty result.
  }

  return { samples: [], attempts };
}

export async function performMocreoPollSync(options: MocreoSyncOptions = {}): Promise<MocreoSyncResult> {
  const intervalFromEnv = parseIntSafe(process.env.MOCREO_POLL_INTERVAL_MINUTES);
  const intervalFromOptions = parseIntSafe(options.minutes);
  const minutesRaw = intervalFromOptions ?? intervalFromEnv ?? 10;
  const minutes = Math.max(1, Math.min(MAX_POLL_MINUTES, minutesRaw));

  const endTimeSec = parseIntSafe(options.endTimeSec) ?? Math.trunc(Date.now() / 1000);
  const beginTimeSec = parseIntSafe(options.beginTimeSec) ?? Math.max(0, endTimeSec - minutes * 60);

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
  const devices = await fetchDevices(accessToken);

  const availableThingNames = nodes
    .map((node) => getNodeThingName(node))
    .filter((x) => x.length > 0);

  const availableDeviceThingNames = devices
    .map((d) => {
      const info = asRecord(d.info);
      return (
        String(d.thingName ?? "").trim() ||
        String(d.sn ?? "").trim() ||
        String(info.thingName ?? "").trim() ||
        String(info.sn ?? "").trim()
      );
    })
    .filter((x) => x.length > 0);

  const targetNodes = nodes.filter((node) => {
    const thingName = getNodeThingName(node);
    return thingName && hubByExternalId.has(normalizeKey(thingName));
  });

  let ingested = 0;
  let samplesFetched = 0;
  let matchedNodesNoSamples = 0;
  let fallbackNodesQueried = 0;
  let sampleIdsTried = 0;
  let sampleRequestAttempts = 0;
  let snapshotFallbackUsed = 0;
  let debugNodeKeysSample: string[] = [];
  let debugNodeProbeKeysSample: string[] = [];
  let debugNodeDetailKeysSample: string[] = [];
  let debugDeviceKeysSample: string[] = [];
  let debugDeviceInfoKeysSample: string[] = [];
  let alerted = 0;
  let skippedDuplicate = 0;
  let skippedNoTemp = 0;
  let skippedNoTimestamp = 0;

  const fallbackWindowMinutesRaw = parseIntSafe(process.env.MOCREO_POLL_FALLBACK_MINUTES);
  const fallbackWindowMinutes = Math.max(
    1,
    Math.min(MAX_FALLBACK_MINUTES, fallbackWindowMinutesRaw ?? DEFAULT_FALLBACK_MINUTES)
  );

  for (const node of targetNodes) {
    const nodeId = getNodeId(node);
    const thingName = getNodeThingName(node);
    if (!nodeId || !thingName) continue;

    const hub = hubByExternalId.get(normalizeKey(thingName));
    if (!hub) continue;

    const sampleIdCandidates = new Set<string>();
    sampleIdCandidates.add(nodeId);
    if (thingName) sampleIdCandidates.add(thingName);

    const deviceRowsForHub = devices.filter((device) => {
      const hubRef = getDeviceHubRef(device);
      return hubRef && normalizeKey(hubRef) === normalizeKey(hub.externalHubId);
    });

    for (const deviceRow of deviceRowsForHub) {
      for (const candidate of getDeviceSampleIdCandidates(deviceRow)) sampleIdCandidates.add(candidate);
    }

    const candidateList = Array.from(sampleIdCandidates).filter(Boolean);
    sampleIdsTried += candidateList.length;

    let samples: MocreoSample[] = [];
    let usedFallbackForThisNode = false;
    for (const candidateId of candidateList) {
      const probe = await fetchSamplesForCandidate({
        accessToken,
        candidateId,
        beginTimeSec,
        endTimeSec,
      });
      sampleRequestAttempts += probe.attempts;
      samples = probe.samples;
      if (samples.length > 0) break;
    }

    if (samples.length === 0) {
      const fallbackBeginTimeSec = Math.max(0, endTimeSec - fallbackWindowMinutes * 60);
      if (fallbackBeginTimeSec < beginTimeSec) {
        usedFallbackForThisNode = true;
        fallbackNodesQueried += 1;
        for (const candidateId of candidateList) {
          const probe = await fetchSamplesForCandidate({
            accessToken,
            candidateId,
            beginTimeSec: fallbackBeginTimeSec,
            endTimeSec,
          });
          sampleRequestAttempts += probe.attempts;
          samples = probe.samples;
          if (samples.length > 0) break;
        }
      }
    }

    samplesFetched += samples.length;

    if (samples.length === 0) {
      let detailPayload: unknown | null = null;
      for (const candidateId of candidateList) {
        detailPayload = await fetchNodeDetailCandidate({
          accessToken,
          candidateId,
        });
        if (detailPayload) break;
      }

      if (detailPayload && debugNodeDetailKeysSample.length === 0) {
        const root = asRecord(detailPayload);
        debugNodeDetailKeysSample = topLevelKeys(root).slice(0, 40);
        const probes = Array.isArray(root.probes) ? root.probes : Array.isArray(asRecord(root.data).probes) ? (asRecord(root.data).probes as unknown[]) : [];
        if (probes.length > 0 && debugNodeProbeKeysSample.length === 0) {
          debugNodeProbeKeysSample = topLevelKeys(probes[0]).slice(0, 40);
        }
      }

      const snapshotTempF =
        parseTempFFromUnknown(node) ||
        parseTempFFromUnknown(detailPayload) ||
        deviceRowsForHub.map((row) => parseTempFFromUnknown(row)).find((v): v is number => v !== null) ||
        null;
      const snapshotTs =
        parseTimestampFromUnknown(node) ||
        parseTimestampFromUnknown(detailPayload) ||
        deviceRowsForHub
          .map((row) => parseTimestampFromUnknown(row))
          .find((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0) ||
        endTimeSec;

      if (snapshotTempF !== null && Number.isFinite(snapshotTempF)) {
        const syntheticSample: MocreoSample = {
          time: snapshotTs,
          tempF: snapshotTempF,
          data: {
            time: snapshotTs,
            tempF: snapshotTempF,
          },
        };
        samples = [syntheticSample];
        snapshotFallbackUsed += 1;
      }
    }

    if (samples.length === 0) {
      matchedNodesNoSamples += 1;

      if (debugNodeKeysSample.length === 0) {
        debugNodeKeysSample = topLevelKeys(node).slice(0, 40);
        const probes = Array.isArray((node as Record<string, unknown>).probes)
          ? ((node as Record<string, unknown>).probes as unknown[])
          : [];
        if (probes.length > 0 && debugNodeProbeKeysSample.length === 0) {
          debugNodeProbeKeysSample = topLevelKeys(probes[0]).slice(0, 40);
        }
      }
      if (debugDeviceKeysSample.length === 0 && deviceRowsForHub.length > 0) {
        debugDeviceKeysSample = topLevelKeys(deviceRowsForHub[0]).slice(0, 40);
        debugDeviceInfoKeysSample = topLevelKeys(asRecord(deviceRowsForHub[0].info)).slice(0, 40);
      }

      continue;
    }

    const uniqueById = new Map<string, NormalizedSample>();
    for (const sample of samples) {
      const timestampSec = parseSampleTimestampSec(sample);
      if (timestampSec === null || timestampSec <= 0) {
        skippedNoTimestamp += 1;
        continue;
      }

      const externalReadingId = `poll:${nodeId}:${timestampSec}`;
      uniqueById.set(externalReadingId, { externalReadingId, timestampSec, sample });
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

    const sortedPairs = Array.from(uniqueById.values()).sort((a, b) => a.timestampSec - b.timestampSec);

    let latestReadingAt: Date | null = hub.lastReadingAt;
    let latestTempF: number | null = null;
    let latestState: "NORMAL" | "HIGH" | "LOW" | "UNKNOWN" = "UNKNOWN";
    let hubLastAlertAt = hub.lastAlertAt;

    for (const row of sortedPairs) {
      const externalReadingId = row.externalReadingId;
      const sample = row.sample;
      if (existingSet.has(externalReadingId)) {
        skippedDuplicate += 1;
        continue;
      }

      const tempF = parseSampleTempF(sample);
      if (tempF === null || !Number.isFinite(tempF)) {
        skippedNoTemp += 1;
        continue;
      }

      const recordedAt = new Date(row.timestampSec * 1000);
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
          lastBatteryPct: toIntPercent(getNodeBatteryLevel(node)),
          lastSignalPct: toIntPercent(getNodeSignalLevel(node)),
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
          lastBatteryPct: toIntPercent(getNodeBatteryLevel(node)),
          lastSignalPct: toIntPercent(getNodeSignalLevel(node)),
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
          batteryPct: toIntPercent(getNodeBatteryLevel(node)),
          signalPct: toIntPercent(getNodeSignalLevel(node)),
          alertState,
          rawPayload: { source: "mocreo-public-api-poll", node, sample },
        },
      });

      const shouldAlert = shouldSendAlert(alertState, hubLastAlertAt);
      if (shouldAlert) {
        const recipients = new Set<string>();
        if (hub.assignedMaintenanceUserId) recipients.add(hub.assignedMaintenanceUserId);
        for (const recipient of hub.recipients) recipients.add(recipient.userId);

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
          samplesFetched,
          matchedNodesNoSamples,
          fallbackNodesQueried,
          sampleIdsTried,
          sampleRequestAttempts,
          snapshotFallbackUsed,
          usedFallbackForThisNode,
          ingested,
          skippedDuplicate,
          skippedNoTemp,
          skippedNoTimestamp,
          alerted,
        },
      },
    });

    // Keep requests under Mocreo's documented limit of 5 requests/sec.
    await new Promise((resolve) => setTimeout(resolve, 220));
  }

  return {
    ok: true,
    beginTimeSec,
    endTimeSec,
    minutes,
    hubsActive: hubs.length,
    nodesFound: nodes.length,
    devicesFound: devices.length,
    nodesMatched: targetNodes.length,
    availableThingNamesSample: availableThingNames.slice(0, 8),
    availableDeviceThingNamesSample: availableDeviceThingNames.slice(0, 8),
    ingested,
    samplesFetched,
    matchedNodesNoSamples,
    fallbackNodesQueried,
    sampleIdsTried,
    sampleRequestAttempts,
    snapshotFallbackUsed,
    debugNodeKeysSample,
    debugNodeProbeKeysSample,
    debugNodeDetailKeysSample,
    debugDeviceKeysSample,
    debugDeviceInfoKeysSample,
    skippedDuplicate,
    skippedNoTemp,
    skippedNoTimestamp,
    alerted,
  };
}
