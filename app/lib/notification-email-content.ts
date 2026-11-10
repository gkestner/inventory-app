import { getNotificationTargetHref } from "@/app/lib/notification-inbox";

export type NotificationEmailConfig = {
  configured: boolean;
  from: string;
  appUrl: string;
  host: string;
  port: number;
  user: string;
  pass: string;
};

export function readNotificationEmailConfig(env: Record<string, string | undefined> = process.env): NotificationEmailConfig {
  const host = env.SMTP_HOST?.trim() ?? "";
  const portRaw = env.SMTP_PORT?.trim() ?? "";
  const port = Number(portRaw);
  const user = env.SMTP_USER?.trim() ?? "";
  const pass = env.SMTP_PASS ?? "";
  const from = env.SMTP_FROM?.trim() ?? "";
  let appUrl = "";
  try {
    const parsed = new URL(env.APP_URL?.trim() || env.NEXTAUTH_URL?.trim() || "");
    const localHttp = env.NODE_ENV !== "production" && parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if ((parsed.protocol === "https:" || localHttp) && !parsed.username && !parsed.password) {
      appUrl = parsed.origin;
    }
  } catch {
    // An explicit trusted app origin is required; never build links from request headers.
  }
  const configured = Boolean(host && /^\d+$/.test(portRaw) && port >= 1 && port <= 65535 && user && pass &&
    from.includes("@") && !/[\r\n]/.test(from) && appUrl);
  return { configured, from, appUrl, host, port, user, pass };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function notificationEmailRecipient(value: string): string {
  const address = value.trim();
  // Legacy user creation did not validate mailbox syntax. Never allow an address
  // list or header-shaped string to turn one private copy into multiple copies.
  if (!/^[^\s<>,;:"()\[\]\\@]+@[^\s<>,;:"()\[\]\\@]+$/u.test(address)) {
    throw Object.assign(new Error("A single recipient mailbox is required."), { code: "ERECIPIENT" });
  }
  return address;
}

export function buildNotificationEmail(args: {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  appUrl: string;
  deliveryId?: string;
  oversight?: { recipientName: string; recipientEmail: string; type: string; createdAt: Date };
}) {
  const inboxUrl = new URL("/notifications", args.appUrl).href;
  const target = getNotificationTargetHref(args.href);
  const detailsUrl = target ? new URL(target, args.appUrl).href : inboxUrl;
  const body = args.body ?? "";
  const context = args.oversight ? [
    "Administrative oversight copy of a notification delivered to another user.",
    `Original recipient: ${args.oversight.recipientName} <${args.oversight.recipientEmail}>`,
    `Notification type: ${args.oversight.type}`,
    `Created (America/New_York): ${args.oversight.createdAt.toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}`,
    `Notification ID: ${args.id}`,
  ].join("\n") : "";
  return {
    subject: `${args.oversight ? "[Oversight] " : ""}${args.title.replace(/[\r\n]+/g, " ")}`,
    text: `${args.title}\n\n${context ? `${context}\n\n` : ""}${body}\n\nView details: ${detailsUrl}\n\nManage notifications and email preferences: ${inboxUrl}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#17202a"><p style="font-size:13px;color:#596673">Success Plus · ${args.oversight ? "Notification oversight" : "Notification"}</p><h1 style="font-size:24px">${escapeHtml(args.title)}</h1>${context ? `<p style="white-space:pre-wrap;line-height:1.6">${escapeHtml(context)}</p>` : ""}<div style="white-space:pre-wrap;line-height:1.6">${escapeHtml(body)}</div><p><a href="${escapeHtml(detailsUrl)}">View details</a></p><hr><p style="font-size:12px"><a href="${escapeHtml(inboxUrl)}">Manage notifications and email preferences</a></p></div>`,
    // A stable identifier helps downstream mail systems recognize a retried job.
    messageId: `<notification-${(args.deliveryId ?? args.id).replace(/[^a-zA-Z0-9_-]/g, "")}@${new URL(args.appUrl).hostname}>`,
  };
}
