import { prisma } from "@/app/lib/prisma";
import { loadComplianceHistory } from "@/app/lib/compliance-history";
import { renderReportExport } from "@/app/lib/report-export";
import { complianceHistoryAccess } from "@/app/admin/reports/compliance-history/access";
import { complianceHistoryWorkbook, parseComplianceHistoryFilters } from "@/app/admin/reports/compliance-history/report-data";
import { complianceHistoryPdfResponse } from "@/app/admin/reports/compliance-history/history-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await complianceHistoryAccess();
  if (access !== "allowed") return Response.json({ error: access === "unauthenticated" ? "Sign in to view compliance history." : "You do not have permission to view compliance history." }, { status: access === "unauthenticated" ? 401 : 403 });
  const params = new URL(request.url).searchParams;
  const filters = parseComplianceHistoryFilters(params);
  const format = params.get("format") ?? "excel";
  if (!["excel", "csv", "pdf"].includes(format)) return Response.json({ error: "Choose Excel, CSV, or PDF." }, { status: 400 });
  const recordedBefore = new Date();
  const first = await loadComplianceHistory({ ...filters, page: 1, pageSize: 1000, recordedBefore });
  const records = [...first.records];
  const pages = Math.ceil(first.total / first.pageSize);
  for (let page = 2; page <= pages; page++) {
    const batch = await loadComplianceHistory({ ...filters, page, pageSize: first.pageSize, recordedBefore });
    records.push(...batch.records);
  }
  const [location, section] = await Promise.all([
    filters.locationId ? prisma.location.findUnique({ where: { id: filters.locationId }, select: { name: true } }) : null,
    filters.sectionId ? prisma.notificationReminderList.findUnique({ where: { id: filters.sectionId }, select: { name: true } }) : null,
  ]);
  const context = {
    location: filters.locationId ? location?.name ?? "Selected location" : "All locations",
    section: filters.sectionId ? section?.name ?? "Selected section" : "All sections",
  };
  return format === "pdf"
    ? complianceHistoryPdfResponse(records, filters, context)
    : renderReportExport(complianceHistoryWorkbook(records, filters, context), format);
}
