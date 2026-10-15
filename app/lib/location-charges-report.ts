import { InvoiceStatus, Prisma } from "@prisma/client";

export type LocationChargesFilters = {
  locationId?: string;
  from?: string;
  to?: string;
  q?: string;
  status?: string;
};

function parseDate(raw: string, endOfDay: boolean): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
  return Number.isNaN(date.getTime()) || date.getFullYear() !== Number(raw.slice(0, 4)) ||
      date.getMonth() + 1 !== Number(raw.slice(5, 7)) || date.getDate() !== Number(raw.slice(8, 10))
    ? null
    : date;
}

export function locationChargesQuery(input: LocationChargesFilters) {
  const locationId = String(input.locationId ?? "").trim();
  const fromRaw = String(input.from ?? "").trim();
  const toRaw = String(input.to ?? "").trim();
  const from = fromRaw ? parseDate(fromRaw, false) : null;
  const to = toRaw ? parseDate(toRaw, true) : null;
  const q = String(input.q ?? "").trim().slice(0, 200);
  const statusRaw = String(input.status ?? "active");
  const status = ["active", "all", "DRAFT", "ISSUED", "PAID", "VOIDED"].includes(statusRaw) ? statusRaw : "active";
  const dateError = Boolean((fromRaw && !from) || (toRaw && !to) || (from && to && from > to));
  const where: Prisma.InvoiceLineWhereInput = {
    ...(locationId || status !== "all" ? {
      invoice: {
        ...(locationId ? { storeId: locationId } : {}),
        ...(status === "all" ? {} : { status: status === "active" ? { not: InvoiceStatus.VOIDED } : status as InvoiceStatus }),
      },
    } : {}),
    ...(from || to ? { submittedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q ? {
      OR: [
        { sku: { contains: q, mode: "insensitive" } },
        { partNumber: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { invoice: { id: { contains: q, mode: "insensitive" } } },
        { invoice: { storeName: { contains: q, mode: "insensitive" } } },
      ],
    } : {}),
  };
  return { locationId, fromRaw, toRaw, q, status, dateError, where };
}
