import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { unreadNotificationWhere } from "@/app/lib/notification-counts";

export const dynamic = "force-dynamic";

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
  const email = String(session.user?.email ?? "").trim().toLowerCase();
  if (!userId && !email) return null;

  const user = await prisma.user.findUnique({
    where: userId ? { id: userId } : { email },
    select: { id: true, active: true },
  });
  return user?.active ? user.id : null;
}

export async function GET() {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [unreadCount, latestNotification, latestUnreadNotification, emailDeliveryRevision] = await Promise.all([
    prisma.notification.count({ where: unreadNotificationWhere(userId) }),
    // Include archived/deleted rows so restoring old items never appears newly created.
    prisma.notification.findFirst({
      where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, createdAt: true },
    }),
    prisma.notification.findFirst({
      where: unreadNotificationWhere(userId), orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, createdAt: true },
    }),
    prisma.notificationEmailDelivery.aggregate({
      where: { recipientUserId: userId },
      _max: { updatedAt: true },
    }),
  ]);

  return NextResponse.json(
    {
      userId, unreadCount, latestNotification, latestUnreadNotification,
      emailDeliveryRevision: emailDeliveryRevision._max.updatedAt,
    },
    { status: 200, headers: { "Cache-Control": "private, no-store" } },
  );
}
