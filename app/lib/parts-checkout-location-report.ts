import { Prisma } from "@prisma/client";
import { parseItemLabelNumberSearchTerm } from "@/app/lib/item-label-number";
import { prisma } from "@/app/lib/prisma";
import { reportDateRange } from "@/app/lib/report-date-range";

export type PartsLocationFilters = { itemId?: string; q?: string; category?: string; from?: string; to?: string };

export function partsLocationSearchParams(filters: PartsLocationFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ["itemId", "q", "category", "from", "to"] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  return params;
}

const ticketSelect = {
  id: true,
  storeId: true,
  store: { select: { name: true, locationNumber: true } },
  itemId: true,
  item: { select: { labelNumber: true, sku: true, partNumber: true, name: true, category: true } },
  skuSnapshot: true, partNumberSnapshot: true, nameSnapshot: true,
  quantity: true, costSnapshot: true, createdAt: true, createdByName: true,
  invoice: { select: { id: true, vendorNumber: true } },
  invoiceLine: { select: { invoice: { select: { id: true, vendorNumber: true } } } },
} satisfies Prisma.PartsCheckoutTicketSelect;

type CheckoutTicket = Prisma.PartsCheckoutTicketGetPayload<{ select: typeof ticketSelect }>;

function filtersAndWhere(raw: PartsLocationFilters, locationId?: string) {
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
    ...(locationId ? { storeId: locationId } : {}),
    ...(itemId ? { itemId } : {}),
    ...(category ? { item: { category: { contains: category, mode: "insensitive" } } } : {}),
    ...(searchFilters.length ? { AND: searchFilters } : {}),
    ...(dateRange.from || dateRange.toExclusive ? { createdAt: {
      ...(dateRange.from ? { gte: dateRange.from } : {}),
      ...(dateRange.toExclusive ? { lt: dateRange.toExclusive } : {}),
    } } : {}),
  };
  return { filters: { itemId, q, category, from, to }, dateError, where };
}

async function loadTickets(raw: PartsLocationFilters, locationId?: string) {
  const query = filtersAndWhere(raw, locationId);
  const tickets = query.dateError ? [] : await prisma.partsCheckoutTicket.findMany({
    where: query.where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: ticketSelect,
  });
  return { ...query, tickets };
}

function ticketCostCents(ticket: CheckoutTicket): number | null {
  return ticket.costSnapshot === null ? null : Math.round(Number(ticket.costSnapshot) * ticket.quantity * 100);
}

function easternDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export async function partsCheckoutLocationReport(raw: PartsLocationFilters) {
  const { filters, dateError, tickets } = await loadTickets(raw);
  const grouped = new Map<string, {
    locationId: string; location: string; locationNumber: string | null;
    itemId: string; labelNumber: number | null; sku: string; partNumber: string | null;
    item: string; category: string | null; quantity: number; tickets: number;
    costCents: number; missingCostTickets: number;
  }>();
  for (const ticket of tickets) {
    const key = `${ticket.storeId}:${ticket.itemId}`;
    const row = grouped.get(key) ?? {
      locationId: ticket.storeId, location: ticket.store.name, locationNumber: ticket.store.locationNumber,
      itemId: ticket.itemId, labelNumber: ticket.item.labelNumber,
      sku: ticket.item.sku || ticket.skuSnapshot,
      partNumber: ticket.item.partNumber ?? ticket.partNumberSnapshot,
      item: ticket.item.name || ticket.nameSnapshot, category: ticket.item.category,
      quantity: 0, tickets: 0, costCents: 0, missingCostTickets: 0,
    };
    row.quantity += ticket.quantity;
    row.tickets += 1;
    const cost = ticketCostCents(ticket);
    if (cost === null) row.missingCostTickets += 1;
    else row.costCents += cost;
    grouped.set(key, row);
  }

  const rows = [...grouped.values()].sort((a, b) => a.location.localeCompare(b.location) || a.item.localeCompare(b.item));
  const locationTotals = new Map<string, {
    locationId: string; location: string; locationNumber: string | null;
    quantity: number; tickets: number; costCents: number; missingCostTickets: number;
  }>();
  for (const row of rows) {
    const total = locationTotals.get(row.locationId) ?? {
      locationId: row.locationId, location: row.location, locationNumber: row.locationNumber,
      quantity: 0, tickets: 0, costCents: 0, missingCostTickets: 0,
    };
    total.quantity += row.quantity;
    total.tickets += row.tickets;
    total.costCents += row.costCents;
    total.missingCostTickets += row.missingCostTickets;
    locationTotals.set(row.locationId, total);
  }

  return {
    filters, dateError, rows, locationTotals: [...locationTotals.values()],
    totalQuantity: tickets.reduce((sum, ticket) => sum + ticket.quantity, 0),
    totalTickets: tickets.length,
    totalCostCents: rows.reduce((sum, row) => sum + row.costCents, 0),
    missingCostTickets: rows.reduce((sum, row) => sum + row.missingCostTickets, 0),
  };
}

export async function partsCheckoutLocationDetails(raw: PartsLocationFilters, locationId: string) {
  const { filters, dateError, tickets } = await loadTickets(raw, locationId);
  const days = new Map<string, {
    date: string; quantity: number; tickets: number; costCents: number; missingCostTickets: number;
    rows: Array<{
      id: string; checkedOutAt: Date; item: string; sku: string; partNumber: string | null;
      checkedOutBy: string; invoiceNumber: string | null;
      quantity: number; costCents: number | null;
    }>;
  }>();
  for (const ticket of tickets) {
    const date = easternDateKey(ticket.createdAt);
    const day = days.get(date) ?? { date, quantity: 0, tickets: 0, costCents: 0, missingCostTickets: 0, rows: [] };
    const invoice = ticket.invoiceLine?.invoice ?? ticket.invoice;
    const cost = ticketCostCents(ticket);
    day.rows.push({
      id: ticket.id, checkedOutAt: ticket.createdAt,
      item: ticket.nameSnapshot || ticket.item.name,
      sku: ticket.skuSnapshot || ticket.item.sku,
      partNumber: ticket.partNumberSnapshot ?? ticket.item.partNumber,
      checkedOutBy: ticket.createdByName,
      invoiceNumber: invoice ? invoice.vendorNumber || invoice.id : null,
      quantity: ticket.quantity, costCents: cost,
    });
    day.quantity += ticket.quantity;
    day.tickets += 1;
    if (cost === null) day.missingCostTickets += 1;
    else day.costCents += cost;
    days.set(date, day);
  }
  const groups = [...days.values()];
  return {
    filters, dateError, days: groups,
    totalQuantity: groups.reduce((sum, day) => sum + day.quantity, 0),
    totalTickets: tickets.length,
    totalCostCents: groups.reduce((sum, day) => sum + day.costCents, 0),
    missingCostTickets: groups.reduce((sum, day) => sum + day.missingCostTickets, 0),
  };
}
