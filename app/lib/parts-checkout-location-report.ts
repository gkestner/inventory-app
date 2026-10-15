import { Prisma } from "@prisma/client";

import { parseItemLabelNumberSearchTerm } from "@/app/lib/item-label-number";
import { prisma } from "@/app/lib/prisma";
import { reportDateRange } from "@/app/lib/report-date-range";

export type PartsLocationFilters = {
  itemId?: string;
  q?: string;
  category?: string;
  from?: string;
  to?: string;
};

export async function partsCheckoutLocationReport(raw: PartsLocationFilters) {
  const itemId = String(raw.itemId ?? "").trim();
  const q = String(raw.q ?? "").trim().slice(0, 200);
  const category = String(raw.category ?? "").trim().slice(0, 200);
  const from = String(raw.from ?? "").trim();
  const to = String(raw.to ?? "").trim();
  const dateRange = reportDateRange(from, to);
  const dateError = dateRange.error ? "Enter a valid date range with From on or before To." : null;

  const tokens = itemId ? [] : q.split(/\s+/).filter(Boolean).slice(0, 12);
  const searchFilters: Prisma.PartsCheckoutTicketWhereInput[] = [];
  for (const token of tokens) {
    const match = { contains: token, mode: "insensitive" as const };
    const labelNumber = parseItemLabelNumberSearchTerm(token);
    searchFilters.push({ OR: [
      { skuSnapshot: match }, { partNumberSnapshot: match }, { nameSnapshot: match },
      { item: { OR: [
        { id: match }, { sku: match }, { partNumber: match }, { name: match },
        { category: match }, { description: match }, { manufacturer: match },
        { orderFrom: match }, { webUrl: match },
        ...(labelNumber === null ? [] : [{ labelNumber }]),
      ] } },
    ] });
  }

  const where: Prisma.PartsCheckoutTicketWhereInput = {
    status: { not: "VOIDED" },
    ...(itemId ? { itemId } : {}),
    ...(category ? { item: { category: { contains: category, mode: "insensitive" } } } : {}),
    ...(searchFilters.length ? { AND: searchFilters } : {}),
    ...(dateRange.from || dateRange.toExclusive ? { createdAt: {
      ...(dateRange.from ? { gte: dateRange.from } : {}),
      ...(dateRange.toExclusive ? { lt: dateRange.toExclusive } : {}),
    } } : {}),
  };

  const grouped = dateError ? [] : await prisma.partsCheckoutTicket.groupBy({
    by: ["storeId", "itemId"],
    where,
    _sum: { quantity: true },
    _count: { _all: true },
  });
  const [locations, items] = await Promise.all([
    prisma.location.findMany({
      where: { id: { in: [...new Set(grouped.map((row) => row.storeId))] } },
      select: { id: true, name: true, locationNumber: true },
    }),
    prisma.item.findMany({
      where: { id: { in: [...new Set(grouped.map((row) => row.itemId))] } },
      select: { id: true, labelNumber: true, sku: true, partNumber: true, name: true, category: true },
    }),
  ]);
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const rows = grouped.map((group) => ({
    locationId: group.storeId,
    location: locationById.get(group.storeId)?.name ?? "Unknown location",
    locationNumber: locationById.get(group.storeId)?.locationNumber ?? null,
    itemId: group.itemId,
    labelNumber: itemById.get(group.itemId)?.labelNumber ?? null,
    sku: itemById.get(group.itemId)?.sku ?? "",
    partNumber: itemById.get(group.itemId)?.partNumber ?? null,
    item: itemById.get(group.itemId)?.name ?? "Unknown item",
    category: itemById.get(group.itemId)?.category ?? null,
    quantity: group._sum.quantity ?? 0,
    tickets: group._count._all,
  })).sort((a, b) => a.location.localeCompare(b.location) || a.item.localeCompare(b.item));

  const locationTotals = new Map<string, { locationId: string; location: string; locationNumber: string | null; quantity: number; tickets: number }>();
  for (const row of rows) {
    const total = locationTotals.get(row.locationId) ?? {
      locationId: row.locationId, location: row.location, locationNumber: row.locationNumber, quantity: 0, tickets: 0,
    };
    total.quantity += row.quantity;
    total.tickets += row.tickets;
    locationTotals.set(row.locationId, total);
  }
  return {
    filters: { itemId, q, category, from, to }, dateError,
    rows, locationTotals: [...locationTotals.values()],
    totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    totalTickets: rows.reduce((sum, row) => sum + row.tickets, 0),
  };
}
