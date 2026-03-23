import { Prisma } from "@prisma/client";

type UnknownRecord = Record<string, unknown>;

export type LiveOrderWaiterUser = {
  id: string;
  name: string;
  uiPreferences: unknown;
};

export type LiveOrderWaiterSummary = {
  id: string;
  name: string;
};

export type LiveOrderNotificationStage = "ARRIVED" | "ADDED_TO_INVENTORY";

function toObject(value: unknown): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as UnknownRecord) };
}

export function getLiveOrderNotificationOrderIds(uiPreferences: unknown): string[] {
  const root = toObject(uiPreferences);
  const notifications = toObject(root.notifications);
  const raw = notifications.liveOrderOrderIds;
  if (!Array.isArray(raw)) return [];

  return Array.from(
    new Set(
      raw
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
}

export function isUserWaitingForLiveOrder(uiPreferences: unknown, orderId: string): boolean {
  const normalizedOrderId = String(orderId ?? "").trim();
  if (!normalizedOrderId) return false;
  return getLiveOrderNotificationOrderIds(uiPreferences).includes(normalizedOrderId);
}

export function setLiveOrderNotificationPreference(
  uiPreferences: unknown,
  orderId: string,
  enabled: boolean,
): Prisma.InputJsonValue {
  const normalizedOrderId = String(orderId ?? "").trim();
  const root = toObject(uiPreferences);
  const notifications = toObject(root.notifications);
  const nextIds = new Set(getLiveOrderNotificationOrderIds(uiPreferences));

  if (normalizedOrderId) {
    if (enabled) nextIds.add(normalizedOrderId);
    else nextIds.delete(normalizedOrderId);
  }

  notifications.liveOrderOrderIds = Array.from(nextIds);
  root.notifications = notifications;
  return root as Prisma.InputJsonValue;
}

export function buildLiveOrderWaiterMap(
  users: LiveOrderWaiterUser[],
  orderIds: string[],
): Record<string, LiveOrderWaiterSummary[]> {
  const relevantOrderIds = new Set(orderIds.map((orderId) => String(orderId ?? "").trim()).filter(Boolean));
  const out: Record<string, LiveOrderWaiterSummary[]> = {};

  for (const orderId of relevantOrderIds) out[orderId] = [];

  for (const user of users) {
    const subscriptions = getLiveOrderNotificationOrderIds(user.uiPreferences);
    for (const orderId of subscriptions) {
      if (!relevantOrderIds.has(orderId)) continue;
      out[orderId].push({ id: user.id, name: user.name });
    }
  }

  for (const orderId of Object.keys(out)) {
    out[orderId].sort((a, b) => a.name.localeCompare(b.name));
  }

  return out;
}

export function getLiveOrderWaitersForOrder(users: LiveOrderWaiterUser[], orderId: string): LiveOrderWaiterSummary[] {
  const targetOrderId = String(orderId ?? "").trim();
  if (!targetOrderId) return [];

  return users
    .filter((user) => isUserWaitingForLiveOrder(user.uiPreferences, targetOrderId))
    .map((user) => ({ id: user.id, name: user.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getLiveOrderNotificationStageLabel(stage: LiveOrderNotificationStage): string {
  return stage === "ARRIVED" ? "arrived" : "added to stock";
}