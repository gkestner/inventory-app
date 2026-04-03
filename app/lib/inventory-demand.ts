import { prisma } from "@/app/lib/prisma";

type ItemInventorySnapshot = {
  id: string;
  sku: string;
  name: string;
  active: boolean;
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
  suggestedMinQty30Day: number;
  suggestedReorderQty30Day: number;
  estimatedLeadTimeDays: number | null;
  daysOfCover: number | null;
  lastCheckoutAt: string | null;
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
    suggestedMinQty30Day: number;
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

function buildRecommendationMap(items: ItemInventorySnapshot[]) {
  return new Map<string, {
    item: ItemInventorySnapshot;
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
        createdAt: { gte: start90 },
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
    const availableQty = item.onHandQty + item.orderedQty;
    const avgDailyUsage30Day = usage30 / 30;
    const suggestedMinQty30Day = Math.max(0, usage30);
    const suggestedReorderQty30Day = Math.max(0, suggestedMinQty30Day - availableQty);
    const estimatedLeadTimeDays =
      bucket.leadTimes.length > 0
        ? roundTo(bucket.leadTimes.reduce((sum, days) => sum + days, 0) / bucket.leadTimes.length, 1)
        : null;
    const daysOfCover = avgDailyUsage30Day > 0 ? roundTo(availableQty / avgDailyUsage30Day, 1) : null;

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
      suggestedMinQty30Day,
      suggestedReorderQty30Day,
      estimatedLeadTimeDays,
      daysOfCover,
      lastCheckoutAt: bucket.lastCheckoutAt ? bucket.lastCheckoutAt.toISOString() : null,
    };
  });
}

export async function recalculateItemMinQuantitiesFrom30DayUsage(
  args: RecommendationArgs = {}
): Promise<RecalculateMinQtyResult> {
  const recommendations = await getInventoryDemandRecommendations(args);
  const changes = recommendations
    .filter((entry) => entry.currentMinQty !== entry.suggestedMinQty30Day)
    .map((entry) => ({
      itemId: entry.itemId,
      sku: entry.sku,
      name: entry.name,
      previousMinQty: entry.currentMinQty,
      suggestedMinQty30Day: entry.suggestedMinQty30Day,
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
          data: { minQty: change.suggestedMinQty30Day },
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