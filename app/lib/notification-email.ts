import { after } from "next/server";
import { isDemoModeActiveForRequest, prisma } from "@/app/lib/prisma";
import { buildNotificationEmail, readNotificationEmailConfig } from "@/app/lib/notification-email-content";
import { runNotificationEmailQueue } from "@/app/lib/notification-email-queue";
import { sendNotificationEmailOverSmtp } from "@/app/lib/notification-email-smtp";

export function getNotificationEmailConfiguration(): { configured: boolean } {
  return { configured: readNotificationEmailConfig().configured };
}

export async function processNotificationEmails(options: { notificationIds?: string[]; limit?: number } = {}) {
  const config = readNotificationEmailConfig();
  if (!config.configured || await isDemoModeActiveForRequest()) {
    return { configured: config.configured, sent: 0, failed: 0, skipped: 0, claimed: 0 };
  }
  const result = await runNotificationEmailQueue({
    db: prisma,
    ...options,
    send: async ({ id, kind, notification, recipient }) => {
      const message = buildNotificationEmail({
        ...notification, appUrl: config.appUrl, deliveryId: id,
        ...(kind === "OVERSIGHT" ? { oversight: {
          recipientName: notification.user.name, recipientEmail: notification.user.email,
          type: notification.type, createdAt: notification.createdAt,
        } } : {}),
      });
      return sendNotificationEmailOverSmtp(config, recipient.email, message);
    },
  });
  return { configured: true, ...result };
}

export function scheduleNotificationEmails(notificationIds: string[]) {
  if (!notificationIds.length) return;
  try {
    after(async () => {
      try {
        await processNotificationEmails({ notificationIds });
      } catch {
        // Durable jobs remain recoverable by the protected scheduled worker.
        console.error("[notification-email] Background processing failed; queued delivery will retry.");
      }
    });
  } catch {
    // Calls outside a Next request still persist the job for scheduled delivery.
    console.warn("[notification-email] Queued for scheduled delivery outside a request.");
  }
}
