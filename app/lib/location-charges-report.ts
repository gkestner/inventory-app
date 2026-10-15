import { InvoiceStatus, Prisma } from "@prisma/client";
import { reportDateRange } from "@/app/lib/report-date-range";

export type LocationChargesFilters = {
  locationId?: string;
  from?: string;
  to?: string;
  q?: string;
  status?: string;
};

export function locationChargesQuery(input: LocationChargesFilters) {
  const locationId = String(input.locationId ?? "").trim();
  const fromRaw = String(input.from ?? "").trim();
  const toRaw = String(input.to ?? "").trim();
  const { from, toExclusive, error: dateError } = reportDateRange(fromRaw, toRaw);
  const q = String(input.q ?? "").trim().slice(0, 200);
  const statusRaw = String(input.status ?? "active");
  const status = ["active", "all", "DRAFT", "ISSUED", "PAID", "VOIDED"].includes(statusRaw) ? statusRaw : "active";
  const where: Prisma.InvoiceLineWhereInput = {
    ...(locationId || status !== "all" ? {
      invoice: {
        ...(locationId ? { storeId: locationId } : {}),
        ...(status === "all" ? {} : { status: status === "active" ? { not: InvoiceStatus.VOIDED } : status as InvoiceStatus }),
      },
    } : {}),
    ...(from || toExclusive ? { submittedAt: { ...(from ? { gte: from } : {}), ...(toExclusive ? { lt: toExclusive } : {}) } } : {}),
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
