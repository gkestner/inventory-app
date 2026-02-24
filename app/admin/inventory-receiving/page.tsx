// app/admin/inventory-receiving/page.tsx
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { Permission, Role } from "@prisma/client";

export const dynamic = "force-dynamic";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

async function requireReceivingView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  // Match Order History access (reuses Items Admin permissions)
  const ok = hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) redirect("/");
}

export default async function AdminInventoryReceivingPage() {
  await requireReceivingView();

  // Dedicated “Orders Received” screen = Order History pre-filtered to ARRIVED.
  redirect("/admin/inventory-orders?phase=ARRIVED");
}