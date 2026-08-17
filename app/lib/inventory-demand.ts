import { prisma } from "@/app/lib/prisma";
import { DEFAULT_APP_CONFIG, loadAppConfig } from "@/app/lib/app-config";

type ItemInventorySnapshot = {
  id: string;
  sku: string;
  name: string;
  active: boolean;
  createdAt: Date;
  onHandQty: number;
  orderedQty: number;
  minQty: number;
};

type CheckoutTicketSnapshot = {
  itemId: string;
  quantity: number;
  status: "OPEN" | "INVOICED" | "VOIDED";
  note: string | null;
  voidNote: string | null;
  createdAt: Date;
};

type OrderSnapshot = {
  itemId: string;
  orderedAt: Date;
  addedToInventoryAt: Date | null;
};

export type InventoryDemandRecommendation = {
  itemId: string;
  sku: string;
  name: string;
  active: boolean;
  currentMinQty: number;
  onHandQty: number;
  orderedQty: number;
  availableQty: number;
  usage30Day: number;
  usage60Day: number;
  usage90Day: number;
  checkoutQty30Day: number;
  returnQty30Day: number;
  avgDailyUsage30Day: number;
  suggestedMinQty90Day: number;
  suggestedReorderQty90Day: number;
  estimatedLeadTimeDays: number | null;
  daysOfCover: number | null;
  lastCheckoutAt: string | null;
  historyDays: number;
  hasOneYearHistory: boolean;
  compareMinQty: boolean;
};

export type RecalculateMinQtyResult = {
  scannedCount: number;
  updatedCount: number;
  unchangedCount: number;
  recommendations: InventoryDemandRecommendation[];
  changes: Array<{
    itemId: string;
    sku: string;
    name: string;
    previousMinQty: number;
    suggestedMinQty90Day: number;
  }>;
};

type RecommendationArgs = {
  itemIds?: string[];
  includeInactive?: boolean;
  now?: Date;
};

function subDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

function isReturnRecord(note: string | null | undefined, voidNote: string | null | undefined): boolean {
  const combined = `${note ?? ""} ${voidNote ?? ""}`.toUpperCase();
  return combined.includes("[RETURN]") || combined.includes("LINKEDTOCHECKOUT=");
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function daysBetween(start: Date, end: Date): number {
  const diffMs = end.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 1;
  return Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

const RAMP_DOWN_MULTIPLIER = 1.5;
const RAMP_DOWN_MIN_STOCK_UNITS = 20;
const SUGGESTED_MIN_FORECAST_DAYS = 90;
const DEFAULT_MAX_REDUCTION_PER_30_DAYS = DEFAULT_APP_CONFIG.minQtyRampDownMaxReductionPer30DaysPct / 100;

function buildRecommendationMap(items: ItemInventorySnapshot[]) {
  return new Map<string, {
    item: ItemInventorySnapshot;
    usageLifetime: number;
    checkout30: number;
    returns30: number;
    usage30: number;
    usage60: number;
    usage90: number;
    leadTimes: number[];
    lastCheckoutAt: Date | null;
  }>(
    items.map((item) => [
      item.id,
      {
        item,
        usageLifetime: 0,
        checkout30: 0,
        returns30: 0,
        usage30: 0,
        usage60: 0,
        usage90: 0,
        leadTimes: [],
        lastCheckoutAt: null,
      },
    ])
  );
}

export async function getInventoryDemandRecommendations(
  args: RecommendationArgs = {}
): Promise<InventoryDemandRecommendation[]> {
  const now = args.now ?? new Date();
  const { config: appConfig } = await loadAppConfig();
  const configuredMaxReductionPer30Days = Math.max(
    0,
    Math.min(1, appConfig.minQtyRampDownMaxReductionPer30DaysPct / 100)
  );
  const maxReductionPer30Days = Number.isFinite(configuredMaxReductionPer30Days)
    ? configuredMaxReductionPer30Days
    : DEFAULT_MAX_REDUCTION_PER_30_DAYS;
  const start30 = subDays(now, 30);
  const start60 = subDays(now, 60);
  const start90 = subDays(now, 90);
  const leadTimeStart = subDays(now, 365);

  const itemWhere = {
    ...(args.itemIds?.length ? { id: { in: args.itemIds } } : {}),
    ...(args.includeInactive ? {} : { active: true }),
  };

  const items = await prisma.item.findMany({
    where: itemWhere,
    select: {
      id: true,
      sku: true,
      name: true,
      active: true,
      createdAt: true,
      onHandQty: true,
      orderedQty: true,
      minQty: true,
    },
    orderBy: { name: "asc" },
  });

  if (items.length === 0) return [];

  const itemIds = items.map((item) => item.id);

  const [tickets, orders] = await Promise.all([
    prisma.partsCheckoutTicket.findMany({
      where: {
        itemId: { in: itemIds },
      },
      select: {
        itemId: true,
        quantity: true,
        status: true,
        note: true,
        voidNote: true,
        createdAt: true,
      },
    }),
    prisma.inventoryOrder.findMany({
      where: {
        itemId: { in: itemIds },
        orderedAt: { gte: leadTimeStart },
        addedToInventoryAt: { not: null },
      },
      select: {
        itemId: true,
        orderedAt: true,
        addedToInventoryAt: true,
      },
    }),
  ]);

  const byItem = buildRecommendationMap(items);

  for (const ticket of tickets as CheckoutTicketSnapshot[]) {
    const bucket = byItem.get(ticket.itemId);
    if (!bucket) continue;

    const isReturn = isReturnRecord(ticket.note, ticket.voidNote);
    const isVoidedRegularTicket = ticket.status === "VOIDED" && !isReturn;
    if (isVoidedRegularTicket) continue;

    const quantity = Math.max(0, Math.trunc(ticket.quantity));
    if (quantity === 0) continue;

    const sign = isReturn ? -1 : 1;
    const createdAtMs = ticket.createdAt.getTime();

    bucket.usageLifetime += sign * quantity;

    if (!isReturn && (!bucket.lastCheckoutAt || bucket.lastCheckoutAt < ticket.createdAt)) {
      bucket.lastCheckoutAt = ticket.createdAt;
    }

    if (createdAtMs >= start90.getTime()) bucket.usage90 += sign * quantity;
    if (createdAtMs >= start60.getTime()) bucket.usage60 += sign * quantity;
    if (createdAtMs >= start30.getTime()) {
      bucket.usage30 += sign * quantity;
      if (isReturn) bucket.returns30 += quantity;
      else bucket.checkout30 += quantity;
    }
  }

  for (const order of orders as OrderSnapshot[]) {
    if (!order.addedToInventoryAt) continue;
    const bucket = byItem.get(order.itemId);
    if (!bucket) continue;
    const diffMs = order.addedToInventoryAt.getTime() - order.orderedAt.getTime();
    if (diffMs < 0) continue;
    bucket.leadTimes.push(diffMs / (24 * 60 * 60 * 1000));
  }

  return items.map((item) => {
    const bucket = byItem.get(item.id)!;
    const usage30 = Math.max(0, bucket.usage30);
    const usage60 = Math.max(0, bucket.usage60);
    const usage90 = Math.max(0, bucket.usage90);
    const usageLifetime = Math.max(0, bucket.usageLifetime);
    const historyStart = item.createdAt;
    const historyDays = daysBetween(historyStart, now);
    const hasOneYearHistory = historyDays >= 365;
    const historyProgress = clamp01(historyDays / 365);
    const conservativeHistoryProgress = historyProgress ** 2;
    const elapsed30DayPeriods = historyDays / 30;
    const availableQty = item.onHandQty + item.orderedQty;
    const avgDailyUsage30Day = usage30 / 30;
    const avgDailyUsageLifetime = usageLifetime / historyDays;
    const baseSuggestedMinQty90Day = Math.max(
      0,
      Math.ceil(avgDailyUsageLifetime * SUGGESTED_MIN_FORECAST_DAYS)
    );

    // If history is still short and current stock is high, phase down large min-qty drops over the first year.
    // This reduces abrupt reductions that could cause parts to run out while history is still maturing.
    const hasLargeOnHand = availableQty >= Math.max(RAMP_DOWN_MIN_STOCK_UNITS, Math.ceil(baseSuggestedMinQty90Day * RAMP_DOWN_MULTIPLIER));
    const shouldRampDown = !hasOneYearHistory && hasLargeOnHand && item.minQty > baseSuggestedMinQty90Day;
    const rampedMinQtyRaw = shouldRampDown
      ? Math.ceil(item.minQty - (item.minQty - baseSuggestedMinQty90Day) * conservativeHistoryProgress)
      : baseSuggestedMinQty90Day;

    // Additional hard safety cap: min qty can only decline by 10% per 30 days of history.
    const maxAllowedReductionFraction = clamp01(elapsed30DayPeriods * maxReductionPer30Days);
    const minAllowedByRateCap = Math.max(
      baseSuggestedMinQty90Day,
      Math.ceil(item.minQty * (1 - maxAllowedReductionFraction))
    );

    const rampedMinQty = shouldRampDown ? Math.max(rampedMinQtyRaw, minAllowedByRateCap) : rampedMinQtyRaw;

    const suggestedMinQty90Day = Math.max(baseSuggestedMinQty90Day, rampedMinQty);
    const suggestedReorderQty90Day = Math.max(0, suggestedMinQty90Day - availableQty);
    const estimatedLeadTimeDays =
      bucket.leadTimes.length > 0
        ? roundTo(bucket.leadTimes.reduce((sum, days) => sum + days, 0) / bucket.leadTimes.length, 1)
        : null;
    const daysOfCover = avgDailyUsage30Day > 0 ? roundTo(availableQty / avgDailyUsage30Day, 1) : null;
    const compareMinQty = suggestedMinQty90Day > 0 || hasOneYearHistory;

    return {
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      active: item.active,
      currentMinQty: item.minQty,
      onHandQty: item.onHandQty,
      orderedQty: item.orderedQty,
      availableQty,
      usage30Day: usage30,
      usage60Day: usage60,
      usage90Day: usage90,
      checkoutQty30Day: bucket.checkout30,
      returnQty30Day: bucket.returns30,
      avgDailyUsage30Day: roundTo(avgDailyUsage30Day, 2),
      suggestedMinQty90Day,
      suggestedReorderQty90Day,
      estimatedLeadTimeDays,
      daysOfCover,
      lastCheckoutAt: bucket.lastCheckoutAt ? bucket.lastCheckoutAt.toISOString() : null,
      historyDays,
      hasOneYearHistory,
      compareMinQty,
    };
  });
}

export async function recalculateItemMinQuantitiesFromFullHistory(
  args: RecommendationArgs = {}
): Promise<RecalculateMinQtyResult> {
  const recommendations = await getInventoryDemandRecommendations(args);
  const changes = recommendations
    .filter((entry) => entry.compareMinQty)
    .filter((entry) => entry.currentMinQty !== entry.suggestedMinQty90Day)
    .map((entry) => ({
      itemId: entry.itemId,
      sku: entry.sku,
      name: entry.name,
      previousMinQty: entry.currentMinQty,
      suggestedMinQty90Day: entry.suggestedMinQty90Day,
    }));

  if (changes.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const change of changes) {
        const current = await tx.item.findUnique({
          where: { id: change.itemId },
          select: {
            id: true,
            sku: true,
            partNumber: true,
            vendor: true,
            name: true,
            description: true,
            category: true,
            cost: true,
            price: true,
            taxable: true,
            active: true,
            manufacturer: true,
            orderFrom: true,
            webUrl: true,
            onHandQty: true,
            orderedQty: true,
            usedQty: true,
            minQty: true,
          },
        });

        if (!current) continue;

        const latest = await tx.itemVersion.findFirst({
          where: { itemId: current.id },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        const nextVersion = (latest?.version ?? 0) + 1;

        await tx.itemVersion.create({
          data: {
            itemId: current.id,
            version: nextVersion,
            sku: current.sku,
            partNumber: current.partNumber,
            vendor: current.vendor,
            name: current.name,
            description: current.description,
            category: current.category,
            cost: current.cost,
            price: current.price,
            taxable: current.taxable,
            active: current.active,
            manufacturer: current.manufacturer,
            orderFrom: current.orderFrom,
            webUrl: current.webUrl,
            onHandQty: current.onHandQty,
            orderedQty: current.orderedQty,
            usedQty: current.usedQty,
            minQty: current.minQty,
          },
        });

        await tx.item.update({
          where: { id: current.id },
          data: { minQty: change.suggestedMinQty90Day },
        });
      }
    });
  }

  return {
    scannedCount: recommendations.length,
    updatedCount: changes.length,
    unchangedCount: recommendations.length - changes.length,
    recommendations,
    changes,
  };
}
