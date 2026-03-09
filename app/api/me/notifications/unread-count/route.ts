import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

type AppSession = {
  user?: {
    id?: string | null;
    email?: string | null;
  } | null;
} | null;

async function requireSessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions)) as AppSession;
  if (!session) return null;

  const userId = String(session.user?.id ?? "").trim();
  if (userId) return userId;

  const email = String(session.user?.email ?? "").trim().toLowerCase();
  if (!email) return null;

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return user?.id ?? null;
}

export async function GET() {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const unreadCount = await prisma.notification.count({
    where: {
      userId,
      readAt: null,
    },
  });

  return NextResponse.json({ unreadCount }, { status: 200 });
}
