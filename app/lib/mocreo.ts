import { createAuditLog, createNotification } from "@/app/lib/workflow-foundations";
import { RECEIVE_NOTIFICATION_TEMPERATURE_ALERTS } from "@/app/lib/permission-constants";

export type MocreoAlertState = "NORMAL" | "HIGH" | "LOW" | "UNKNOWN";

export type MocreoWebhookReading = {
  externalHubId: string;
  hubName: string;
  externalDeviceId: string;
  deviceName: string;
  externalReadingId: string | null;
  recordedAt: Date;
  temperatureF: number | null;
  batteryPct: number | null;
  signalPct: number | null;
  rawPayload: unknown;
};

export type MocreoHubThresholds = {
  minTempF: number | null;
  maxTempF: number | null;
};

export function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toIntOrNull(value: unknown): number | null {
  const n = toNumberOrNull(value);
  if (n === null) return null;
  return Math.max(0, Math.min(100, Math.trunc(n)));
}

function toDateOrNow(value: unknown): Date {
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function cToF(c: number): number {
  return c * (9 / 5) + 32;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function firstNonEmptyString(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function extractTemperatureF(candidate: Record<string, unknown>): number | null {
  const tempF = toNumberOrNull(
    candidate.temperatureF ??
      candidate.tempF ??
      candidate.fahrenheit ??
      candidate.temperature_f ??
      candidate.temp_f ??
      candidate.currentTempF ??
      candidate.lastTempF
  );
  if (tempF !== null) return tempF;

  const tempC = toNumberOrNull(
    candidate.temperatureC ??
      candidate.tempC ??
      candidate.celsius ??
      candidate.temperature_c ??
      candidate.temp_c ??
      candidate.currentTempC ??
      candidate.lastTempC
  );
  if (tempC !== null) return cToF(tempC);

  const nestedTemp = asObject(candidate.temperature);
  if (nestedTemp) {
    const nestedF = toNumberOrNull(
      nestedTemp.f ?? nestedTemp.fahrenheit ?? nestedTemp.valueF ?? nestedTemp.tempF ?? nestedTemp.currentF
    );
    if (nestedF !== null) return nestedF;
    const nestedC = toNumberOrNull(
      nestedTemp.c ?? nestedTemp.celsius ?? nestedTemp.valueC ?? nestedTemp.tempC ?? nestedTemp.currentC ?? nestedTemp.value
    );
    if (nestedC !== null) return cToF(nestedC);
  }

  const nestedData = asObject(candidate.data);
  if (nestedData) {
    const dataTemp = extractTemperatureF(nestedData);
    if (dataTemp !== null) return dataTemp;
  }

  const nestedReading = asObject(candidate.reading);
  if (nestedReading) {
    const readingTemp = extractTemperatureF(nestedReading);
    if (readingTemp !== null) return readingTemp;
  }

  return null;
}

export function parseMocreoWebhookPayload(raw: unknown): MocreoWebhookReading | null {
  const root = asObject(raw);
  if (!root) return null;

  const event = asObject(root.event) ?? root;
  const hub = asObject(root.hub) ?? asObject(event.hub) ?? event;
  const device = asObject(root.device) ?? asObject(event.device) ?? event;

  const externalHubId = firstNonEmptyString(
    hub.externalHubId,
    hub.hubId,
    hub.gatewayId,
    event.externalHubId,
    event.hubId,
    root.externalHubId,
    root.hubId
  );

  const externalDeviceId = firstNonEmptyString(
    device.externalDeviceId,
    device.deviceId,
    device.sensorId,
    event.externalDeviceId,
    event.deviceId,
    root.externalDeviceId,
    root.deviceId,
    root.sensorId
  );

  if (!externalHubId || !externalDeviceId) return null;

  const hubName = firstNonEmptyString(hub.name, event.hubName, root.hubName) || `Hub ${externalHubId}`;
  const deviceName =
    firstNonEmptyString(device.name, event.deviceName, root.deviceName, device.alias) || `Device ${externalDeviceId}`;

  const recordedAt = toDateOrNow(event.recordedAt ?? event.timestamp ?? root.recordedAt ?? root.timestamp);
  const temperatureF =
    extractTemperatureF(event) ??
    extractTemperatureF(device) ??
    extractTemperatureF(hub) ??
    extractTemperatureF(root);
  const batteryPct = toIntOrNull(event.batteryPct ?? event.battery ?? root.batteryPct ?? root.battery);
  const signalPct = toIntOrNull(event.signalPct ?? event.signal ?? root.signalPct ?? root.signal);

  const externalReadingId =
    firstNonEmptyString(event.readingId, event.eventId, root.readingId, root.eventId, root.id) || null;

  return {
    externalHubId,
    hubName,
    externalDeviceId,
    deviceName,
    externalReadingId,
    recordedAt,
    temperatureF,
    batteryPct,
    signalPct,
    rawPayload: raw,
  };
}

export function evaluateTemperatureAlertState(
  temperatureF: number | null,
  thresholds: MocreoHubThresholds
): MocreoAlertState {
  if (temperatureF === null) return "UNKNOWN";
  if (thresholds.minTempF !== null && temperatureF < thresholds.minTempF) return "LOW";
  if (thresholds.maxTempF !== null && temperatureF > thresholds.maxTempF) return "HIGH";
  return "NORMAL";
}

export function shouldSendAlert(
  alertState: MocreoAlertState,
  lastAlertAt: Date | null,
  cooldownMinutes = 30
): boolean {
  if (alertState !== "LOW" && alertState !== "HIGH") return false;
  if (!lastAlertAt) return true;
  return Date.now() - lastAlertAt.getTime() >= cooldownMinutes * 60 * 1000;
}

export async function notifyTemperatureAlert(args: {
  userIds: string[];
  hubName: string;
  locationName: string | null;
  temperatureF: number | null;
  alertState: MocreoAlertState;
  href?: string;
}) {
  const uniqueUserIds = Array.from(new Set(args.userIds.filter(Boolean)));
  if (uniqueUserIds.length === 0) return;

  const tempLabel = args.temperatureF === null ? "unknown temperature" : `${args.temperatureF.toFixed(1)}F`;
  const stateText = args.alertState === "HIGH" ? "HIGH" : args.alertState === "LOW" ? "LOW" : "UNKNOWN";
  const locationText = args.locationName ? ` at ${args.locationName}` : "";

  for (const userId of uniqueUserIds) {
    await createNotification({
      userId,
      type: "TEMPERATURE_ALERT",
      title: `Temperature Alert: ${args.hubName}`,
      body: `${stateText} reading ${tempLabel}${locationText}.`,
      href: args.href ?? "/maintenance/temperature-dashboard",
      requiredPermission: RECEIVE_NOTIFICATION_TEMPERATURE_ALERTS,
    });
  }

  await createAuditLog({
    module: "MOCREO_TEMPERATURE",
    action: "ALERT_SENT",
    entityType: "MocreoHub",
    message: `Temperature ${stateText} alert sent for hub ${args.hubName}.`,
    metadata: {
      userIds: uniqueUserIds,
      alertState: args.alertState,
      temperatureF: args.temperatureF,
      locationName: args.locationName,
    },
  });
}
