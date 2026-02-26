// app/page.tsx
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SessionShape = {
  user?: {
    role?: Role | null;
  } | null;
} | null;

export default async function HomePage() {
  const session = (await getServerSession(authOptions)) as SessionShape;

  // Not logged in -> go login
  if (!session) {
    redirect("/login");
  }

  const role = session.user?.role ?? null;

  // Admin -> admin area
  if (role === Role.ADMIN) {
    redirect("/admin");
  }

  // Non-admin -> send to main app area (maintenance default)
  redirect("/maintenance/work-orders");
}