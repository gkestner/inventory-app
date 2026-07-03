import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import {
  ADMIN_VIEW_MAINTENANCE_REQUESTS,
  ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
  ADMIN_VIEW_REPORT_FLEET_TCO,
  ADMIN_VIEW_REPORT_NOTIFICATION_EFFECTIVENESS,
  ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS,
  ADMIN_VIEW_REPORT_PERMISSION_COVERAGE,
  ADMIN_VIEW_REPORT_PM_COMPLIANCE,
  ADMIN_VIEW_REPORT_SLA_BREACHES,
  ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD,
  ADMIN_VIEW_REPORT_TEMPERATURE_INCIDENTS,
} from "@/app/lib/permission-constants";
import { Permission, Role } from "@prisma/client";
import CustomReportBuilder from "./CustomReportBuilder";

export const dynamic = "force-dynamic";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

async function requireReportBuilderView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  const ok = hasAnyPermission(perms, [
    Permission.ADMIN_VIEW_ITEMS,
    Permission.ADMIN_EDIT_ITEMS,
    ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
    ADMIN_VIEW_MAINTENANCE_REQUESTS,
    ADMIN_VIEW_REPORT_SLA_BREACHES,
    ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD,
    ADMIN_VIEW_REPORT_TEMPERATURE_INCIDENTS,
    ADMIN_VIEW_REPORT_PM_COMPLIANCE,
    ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS,
    ADMIN_VIEW_REPORT_FLEET_TCO,
    ADMIN_VIEW_REPORT_PERMISSION_COVERAGE,
    ADMIN_VIEW_REPORT_NOTIFICATION_EFFECTIVENESS,
  ]);
  if (!ok) redirect("/");
}

export default async function CreateReportPage() {
  await requireReportBuilderView();
  return <CustomReportBuilder />;
}
