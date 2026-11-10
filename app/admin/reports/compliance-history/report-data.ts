import type { ComplianceHistoryRecord } from "@/app/lib/compliance-history-fields";
import type { ReportColumn, ReportWorkbook } from "@/app/lib/report-export";

export type ComplianceHistoryFilters = {
  locationId?: string;
  sectionId?: string;
  year?: number;
  page: number;
};

type Params = { get(name: string): string | null };

/** One filter parser for the report and every export format. */
export function parseComplianceHistoryFilters(params: Params): ComplianceHistoryFilters {
  const identifier = (name: string) => {
    const value = (params.get(name) ?? "").trim();
    return value && value.length <= 200 ? value : undefined;
  };
  const year = Number(params.get("year"));
  const page = Number(params.get("page"));
  return {
    locationId: identifier("locationId"),
    sectionId: identifier("sectionId"),
    year: Number.isInteger(year) && year >= 2020 && year <= 2100 ? year : undefined,
    page: Number.isSafeInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1,
  };
}

export function complianceHistoryQuery(filters: ComplianceHistoryFilters, page?: number) {
  const params = new URLSearchParams();
  if (filters.locationId) params.set("locationId", filters.locationId);
  if (filters.sectionId) params.set("sectionId", filters.sectionId);
  if (filters.year) params.set("year", String(filters.year));
  if (page && page > 1) params.set("page", String(page));
  return params.toString();
}

export const COMPLIANCE_HISTORY_COLUMNS: ReportColumn[] = [
  { key: "locationNumber", header: "Location number", width: 75 },
  { key: "locationName", header: "Location", width: 180 },
  { key: "sectionName", header: "Compliance section", width: 150 },
  { key: "recordYear", header: "Record year", kind: "number", width: 75 },
  { key: "serviceDate", header: "Service date", width: 105 },
  { key: "interval", header: "Reminder interval (months)", width: 100 },
  { key: "companyName", header: "Service company", width: 170 },
  { key: "cost", header: "Service / testing cost", width: 110 },
  { key: "tankSize", header: "Grease trap tank size", width: 100 },
  { key: "gallons", header: "Gallons / PM notes", width: 150 },
  { key: "additionalDate", header: "Additional boiler inspection date", width: 110 },
  { key: "notes", header: "Service notes", width: 200 },
  { key: "recordedAt", header: "Recorded at", kind: "datetime", width: 140 },
  { key: "recordedByName", header: "Recorded by", width: 140 },
  { key: "source", header: "Record source", width: 110 },
  { key: "id", header: "Entry ID", width: 180 },
];

export function complianceHistoryWorkbook(
  records: ComplianceHistoryRecord[],
  filters: ComplianceHistoryFilters,
  context: { location: string; section: string },
): ReportWorkbook {
  return {
    filename: "compliance-history",
    title: "Compliance History",
    columns: COMPLIANCE_HISTORY_COLUMNS,
    metadata: [
      ["Location", context.location],
      ["Section", context.section],
      ["Record year", filters.year ?? "All years"],
      ["Matching entries", records.length],
    ],
    rows: records.map((record) => ({
      ...record,
      interval: record.intervalText || record.intervalMonths,
    })),
  };
}

export function historySourceLabel(source: string) {
  const labels: Record<string, string> = {
    BASELINE: "Existing service record",
    AUDIT: "Recovered change history",
    ANNUAL_EDIT: "PM record update",
    DASHBOARD: "New service entry",
    CUSTOM_EDIT: "Reminder service update",
  };
  return labels[source] ?? source.replaceAll("_", " ").toLowerCase();
}
