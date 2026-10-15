import { Prisma } from "@prisma/client";
import { reportDateRange } from "@/app/lib/report-date-range";

export type PartsConsumptionFilters = { from?: string | null; to?: string | null; itemId?: string | null; includeVoided?: string | null };

export function partsConsumptionQuery(input: PartsConsumptionFilters) {
  const from = String(input.from ?? "").trim();
  const to = String(input.to ?? "").trim();
  const itemId = String(input.itemId ?? "").trim();
  const includeVoided = ["1", "true", "yes", "on"].includes(String(input.includeVoided ?? "").toLowerCase());
  const dateRange = reportDateRange(from, to);
  const where: Prisma.PartsCheckoutTicketWhereInput = {
    ...(includeVoided ? {} : { status: { not: "VOIDED" } }),
    ...(itemId ? { itemId } : {}),
    ...(dateRange.from || dateRange.toExclusive ? { createdAt: {
      ...(dateRange.from ? { gte: dateRange.from } : {}),
      ...(dateRange.toExclusive ? { lt: dateRange.toExclusive } : {}),
    } } : {}),
  };
  return { from, to, itemId, includeVoided, dateError: dateRange.error, where };
}
