import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import ComplianceDashboard from "@/app/components/compliance/ComplianceDashboard";
import { authOptions } from "@/app/lib/auth";
import { loadComplianceDashboard } from "@/app/lib/compliance-dashboard";
import { prisma } from "@/app/lib/prisma";
import { ADMIN_VIEW_PREVENTATIVE_MAINTENANCE, VIEW_PREVENTATIVE_MAINTENANCE } from "@/app/lib/permission-constants";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { loadMaintenancePrimaryAssignments, normalizePmYear } from "@/app/lib/preventative-maintenance";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const value = (params: Params, key: string) => typeof params[key] === "string" ? params[key] as string : "";

export default async function MaintenanceCompliancePage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, role: true, active: true, email: true } });
  if (!me?.active) redirect("/login");
  const perms = await loadUserPermissions({ user: me });
  if (!perms.allowAll && !hasAnyPermission(perms, [VIEW_PREVENTATIVE_MAINTENANCE])) redirect("/");
  const params = await searchParams;
  const year = normalizePmYear(params.year);
  if (perms.allowAll || hasAnyPermission(perms, [ADMIN_VIEW_PREVENTATIVE_MAINTENANCE])) redirect(`/admin/preventative-maintenance/compliance?year=${year}`);
  const assignments = await loadMaintenancePrimaryAssignments();
  const locationIds = [...new Set(assignments.filter((assignment) => assignment.userId === me.id).map((assignment) => assignment.locationId))];
  const data = await loadComplianceDashboard({ locationIds });
  return <div style={{ padding: 16 }}><ComplianceDashboard
    data={data}
    year={year}
    editable={false}
    filters={{ q: value(params, "q").trim().slice(0, 200), status: ["attention", "missing", "paused"].includes(value(params, "status")) ? value(params, "status") : "all", showHidden: value(params, "showHidden") === "1" }}
  /></div>;
}
