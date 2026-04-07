import { prisma } from "@/app/lib/prisma";

export const ORDER_HISTORY_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;
export type OrderHistoryPerPage = (typeof ORDER_HISTORY_PER_PAGE_OPTIONS)[number];

export type AppConfig = {
  liveOrdersAddedRetentionDays: number;
  orderHistoryPerPage: OrderHistoryPerPage;
};

export const DEFAULT_APP_CONFIG: AppConfig = {
  liveOrdersAddedRetentionDays: 14,
  orderHistoryPerPage: 25,
};

const APP_CONFIG_SINGLETON_ID = "default";

type AppConfigDelegate = {
  findUnique: (args: unknown) => Promise<unknown>;
  upsert: (args: unknown) => Promise<unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRetentionDays(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_APP_CONFIG.liveOrdersAddedRetentionDays;
  return Math.max(1, Math.min(365, Math.floor(n)));
}

function toOrderHistoryPerPage(value: unknown): OrderHistoryPerPage {
  const n = Number(value);
  return ORDER_HISTORY_PER_PAGE_OPTIONS.includes(n as OrderHistoryPerPage)
    ? (n as OrderHistoryPerPage)
    : DEFAULT_APP_CONFIG.orderHistoryPerPage;
}

export function normalizeAppConfig(raw: unknown): AppConfig {
  const obj = isRecord(raw) ? raw : {};
  return {
    liveOrdersAddedRetentionDays: toRetentionDays(obj.liveOrdersAddedRetentionDays),
    orderHistoryPerPage: toOrderHistoryPerPage(obj.orderHistoryPerPage),
  };
}

function getAppConfigClient(): AppConfigDelegate | null {
  const p = prisma as unknown as { appConfig?: unknown };
  const model = p.appConfig;
  if (!model || !isRecord(model)) return null;

  const findUnique = model.findUnique;
  const upsert = model.upsert;

  if (typeof findUnique !== "function" || typeof upsert !== "function") return null;

  return {
    findUnique: findUnique as (args: unknown) => Promise<unknown>,
    upsert: upsert as (args: unknown) => Promise<unknown>,
  };
}

export async function loadAppConfig(): Promise<{ config: AppConfig; isAvailable: boolean }> {
  const client = getAppConfigClient();
  if (!client) return { config: DEFAULT_APP_CONFIG, isAvailable: false };

  try {
    const row = await client.findUnique({
      where: { id: APP_CONFIG_SINGLETON_ID },
      select: {
        liveOrdersAddedRetentionDays: true,
        orderHistoryPerPage: true,
      },
    });

    return {
      config: normalizeAppConfig(row ?? DEFAULT_APP_CONFIG),
      isAvailable: true,
    };
  } catch {
    return { config: DEFAULT_APP_CONFIG, isAvailable: false };
  }
}

export async function saveAppConfig(raw: unknown): Promise<{ config: AppConfig; saved: boolean }> {
  const next = normalizeAppConfig(raw);
  const client = getAppConfigClient();
  if (!client) return { config: next, saved: false };

  try {
    await client.upsert({
      where: { id: APP_CONFIG_SINGLETON_ID },
      create: {
        id: APP_CONFIG_SINGLETON_ID,
        liveOrdersAddedRetentionDays: next.liveOrdersAddedRetentionDays,
        orderHistoryPerPage: next.orderHistoryPerPage,
      },
      update: {
        liveOrdersAddedRetentionDays: next.liveOrdersAddedRetentionDays,
        orderHistoryPerPage: next.orderHistoryPerPage,
      },
    });

    return { config: next, saved: true };
  } catch {
    return { config: next, saved: false };
  }
}