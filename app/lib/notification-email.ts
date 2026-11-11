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
    send: async ({ id, kind, notification, recipient, reminderEmailEvent }) => {
      const source = notification ?? reminderEmailEvent;
      const emailOnly = kind === "PRIMARY" && Boolean(reminderEmailEvent);
      const address = emailOnly ? reminderEmailEvent?.contact.email : recipient?.email;
      const originalAddress = notification?.user.email ?? reminderEmailEvent?.contact.email ?? "";
      if (!source || !address) throw Object.assign(new Error("The email source or recipient is missing."), { code: "ERECIPIENT" });
      const message = buildNotificationEmail({
        id: source.id, title: source.title, body: source.body,
        href: notification?.href ?? (reminderEmailEvent ? "/admin/preventative-maintenance/compliance" : null),
        appUrl: config.appUrl, deliveryId: id, emailOnly,
        ...(kind === "OVERSIGHT" ? { oversight: {
          recipientName: notification?.user.name ?? "", recipientEmail: originalAddress,
          type: notification?.type ?? "SCHEDULER", createdAt: source.createdAt, emailOnly: Boolean(reminderEmailEvent),
        } } : {}),
      });
      return sendNotificationEmailOverSmtp(config, address, message);
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
