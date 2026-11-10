import { lookup } from "node:dns";
import { createConnection, type Socket, type LookupFunction } from "node:net";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { notificationEmailRecipient, type NotificationEmailConfig } from "@/app/lib/notification-email-content";

export const NOTIFICATION_EMAIL_SEND_DEADLINE_MS = 25_000;

function timeoutError() {
  return Object.assign(new Error("Email attempt deadline exceeded."), { code: "ETIMEDOUT" });
}

// Cancel the physical connection before rejecting. A bare Promise.race would
// allow SMTP to keep sending after the queue has recorded a retryable failure.
export function withNotificationEmailDeadline<T>(operation: () => Promise<T>, cancel: () => void, timeoutMs = NOTIFICATION_EMAIL_SEND_DEADLINE_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cancel();
      reject(timeoutError());
    }, timeoutMs);
    void Promise.resolve().then(operation).then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

const timedLookup: LookupFunction = (hostname, options, callback) => {
  let finished = false;
  const timer = setTimeout(() => {
    if (finished) return;
    finished = true;
    callback(Object.assign(new Error("SMTP hostname lookup timed out."), { code: "EDNS" }), "", 4);
  }, 5_000);
  lookup(hostname, options, (error, address, family) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    callback(error, address, family);
  });
};

export async function sendNotificationEmailOverSmtp(config: NotificationEmailConfig, recipient: string, message: { subject: string; text: string; html: string; messageId: string }) {
  const address = notificationEmailRecipient(recipient);
  let socket: Socket | undefined;
  let cancelled = false;
  const transport = nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.port === 465,
    requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.pass },
    dnsTimeout: 5_000, connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 12_000,
    disableFileAccess: true, disableUrlAccess: true,
    getSocket(_options, callback) {
      if (cancelled) { callback(timeoutError(), {}); return; }
      // Own the underlying socket so the absolute deadline can stop both plain
      // SMTP and the TLS wrapper Nodemailer creates on top of it.
      socket = createConnection({ host: config.host, port: config.port, lookup: timedLookup });
      let handedOff = false;
      socket.once("connect", () => {
        if (cancelled) { socket?.destroy(); return; }
        handedOff = true;
        callback(null, { connection: socket });
      });
      socket.on("error", (error) => {
        if (!handedOff && !cancelled) { handedOff = true; callback(error, {}); }
      });
    },
  } satisfies SMTPTransport.Options);
  try {
    const sent = await withNotificationEmailDeadline(() => transport.sendMail({
      from: config.from,
      to: { name: "", address },
      ...message,
    }), () => {
      cancelled = true;
      socket?.destroy(timeoutError());
    });
    if (!sent.accepted.length) throw Object.assign(new Error("SMTP did not accept the recipient."), { code: "ERECIPIENT" });
    return { messageId: sent.messageId };
  } finally {
    cancelled = true;
    socket?.destroy();
    transport.close();
  }
}
