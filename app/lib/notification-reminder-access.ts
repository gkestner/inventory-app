import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { canAccessAdmin } from "@/app/lib/admin-access";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { ADMIN_VIEW_PREVENTATIVE_MAINTENANCE } from "@/app/lib/permission-constants";

export async function requireReminderManager() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, email: true, active: true, role: true } });
  if (!user?.active) redirect("/login");
  const liveSession = { user };
  const [allowed, permissions] = await Promise.all([canAccessAdmin(liveSession), loadUserPermissions(liveSession)]);
  if (!allowed || (!permissions.allowAll && !hasAnyPermission(permissions, [ADMIN_VIEW_PREVENTATIVE_MAINTENANCE]))) redirect("/");
  return user;
}
