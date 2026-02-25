// app/work-orders/page.tsx
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Role } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SessionUser = {
  role?: Role | null;
};

export default async function WorkOrdersRootPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const user = session.user as SessionUser;

  // Route everyone to the canonical work orders module.
  // Employees use the same module, maintenance users also land here.
  // (If later you split views, you can branch here.)
  if (user?.role === Role.ADMIN) {
    // admins have an admin module; keep them out of employee work views if desired
    redirect("/admin/work-orders");
  }

  // Default: existing work orders module lives under /maintenance/work-orders
  redirect("/maintenance/work-orders");
}