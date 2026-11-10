import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { ADMIN_VIEW_PREVENTATIVE_MAINTENANCE, ADMIN_VIEW_REPORT_PM_COMPLIANCE } from "@/app/lib/permission-constants";

/** Reload the user's current role and active status before exposing global history. */
export async function complianceHistoryAccess(): Promise<"allowed" | "unauthenticated" | "forbidden"> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return "unauthenticated";
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, role: true, active: true },
  });
  if (!user?.active) return "unauthenticated";
  const permissions = await loadUserPermissions({ user });
  return permissions.allowAll || hasAnyPermission(permissions, [ADMIN_VIEW_REPORT_PM_COMPLIANCE, ADMIN_VIEW_PREVENTATIVE_MAINTENANCE])
    ? "allowed"
    : "forbidden";
}
