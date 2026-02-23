import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const role = (session.user as { role?: Role | null } | undefined)?.role ?? null;

  if (role === Role.ADMIN) {
    redirect("/admin/users");
  }

  redirect("/maintenance");
}
