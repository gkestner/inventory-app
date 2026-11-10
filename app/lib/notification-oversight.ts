import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { isNotificationOversightAdministrator } from "@/app/lib/notification-oversight-rules";

export const NOTIFICATION_OBSERVER_SELECT = {
  id: true, active: true, role: true, notificationEmailEnabled: true,
  roles: { select: { role: { select: { name: true, isSystem: true } } } },
} as const satisfies Prisma.UserSelect;

export async function loadNotificationOversightRecipients(db: Pick<PrismaClient, "notificationOversightSubscriber"> = prisma) {
  const subscriptions = await db.notificationOversightSubscriber.findMany({
    where: { enabled: true, user: { active: true } },
    select: { user: { select: NOTIFICATION_OBSERVER_SELECT } },
  });
  return subscriptions.map(({ user }) => user).filter(isNotificationOversightAdministrator);
}

export async function getNotificationOversightState(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...NOTIFICATION_OBSERVER_SELECT, notificationOversightSubscription: { select: { enabled: true } } },
  });
  return {
    eligible: Boolean(user && isNotificationOversightAdministrator(user)),
    enabled: Boolean(user?.notificationOversightSubscription?.enabled),
    emailEnabled: user?.notificationEmailEnabled ?? false,
  };
}

export async function setNotificationOversightEnabled(userId: string, enabled: boolean) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: NOTIFICATION_OBSERVER_SELECT });
    if (!user || !isNotificationOversightAdministrator(user)) throw new Error("NOTIFICATION_OVERSIGHT_FORBIDDEN");
    const previous = await tx.notificationOversightSubscriber.findUnique({ where: { userId } });
    await tx.notificationOversightSubscriber.upsert({
      where: { userId },
      create: { userId, enabled, createdByUserId: userId },
      update: { enabled },
    });
    if (!enabled) await tx.notificationEmailDelivery.updateMany({
      where: { recipientUserId: userId, kind: "OVERSIGHT", status: "PENDING" },
      data: { status: "SKIPPED", claimToken: null, leaseExpiresAt: null, lastError: null },
    });
    await tx.auditLog.create({ data: {
      actorUserId: userId, module: "NOTIFICATIONS", action: enabled ? "ENABLE_OVERSIGHT_EMAIL" : "DISABLE_OVERSIGHT_EMAIL",
      entityType: "NotificationOversightSubscriber", entityId: userId,
      message: enabled ? "Enabled private email copies of future notifications to other users." : "Disabled private oversight email copies.",
      metadata: { subscriberUserId: userId, before: previous?.enabled ?? false, after: enabled },
    } });
    return { enabled };
  });
}
