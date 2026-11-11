import ComplianceDashboard from "@/app/components/compliance/ComplianceDashboard";
import { complianceFilters, complianceParam as value, loadComplianceDashboard, type ComplianceSearchParams } from "@/app/lib/compliance-dashboard";
import { getNotificationEmailConfiguration } from "@/app/lib/notification-email";
import { requireReminderManager } from "@/app/lib/notification-reminder-access";
import { normalizePmYear } from "@/app/lib/preventative-maintenance";

export const dynamic = "force-dynamic";

export default async function AdminCompliancePage({ searchParams }: { searchParams: Promise<ComplianceSearchParams> }) {
  const actor = await requireReminderManager();
  const params = await searchParams;
  const year = normalizePmYear(params.year);
  const filters = complianceFilters(params);
  const data = await loadComplianceDashboard({ editable: true, showHidden: filters.showHidden });
  return <ComplianceDashboard
    data={data}
    year={year}
    editable
    canViewHistory
    actorId={actor.id}
    expanded={(value(params, "saved") || value(params, "error")) ? { sectionId: value(params, "section"), locationId: value(params, "location") } : undefined}
    filters={filters}
    feedback={{ error: value(params, "error").slice(0, 250), saved: value(params, "saved").slice(0, 250) }}
    emailConfigured={getNotificationEmailConfiguration().configured}
  />;
}
