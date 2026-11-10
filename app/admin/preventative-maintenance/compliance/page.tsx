import ComplianceDashboard from "@/app/components/compliance/ComplianceDashboard";
import { loadComplianceDashboard } from "@/app/lib/compliance-dashboard";
import { getNotificationEmailConfiguration } from "@/app/lib/notification-email";
import { requireReminderManager } from "@/app/lib/notification-reminder-access";
import { normalizePmYear } from "@/app/lib/preventative-maintenance";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const value = (params: Params, key: string) => typeof params[key] === "string" ? params[key] as string : "";

export default async function AdminCompliancePage({ searchParams }: { searchParams: Promise<Params> }) {
  const actor = await requireReminderManager();
  const params = await searchParams;
  const year = normalizePmYear(params.year);
  const data = await loadComplianceDashboard(year);
  return <ComplianceDashboard
    data={data}
    year={year}
    editable
    actorId={actor.id}
    filters={{ q: value(params, "q").trim().slice(0, 200), status: ["attention", "missing", "paused"].includes(value(params, "status")) ? value(params, "status") : "all", showHidden: value(params, "showHidden") === "1" }}
    feedback={{ error: value(params, "error").slice(0, 250), saved: value(params, "saved").slice(0, 250) }}
    emailConfigured={getNotificationEmailConfiguration().configured}
  />;
}
