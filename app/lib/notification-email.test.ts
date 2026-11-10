import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { buildNotificationEmail, notificationEmailRecipient, readNotificationEmailConfig } from "./notification-email-content";
import { notificationEmailRetryAt, runNotificationEmailQueue } from "./notification-email-queue";
import { withNotificationEmailDeadline } from "./notification-email-smtp";

type FakeJob = {
  id: string;
  notificationId: string;
  recipientUserId: string;
  kind: "PRIMARY" | "OVERSIGHT";
  recipient: {
    id: string; active: boolean; notificationEmailEnabled: boolean; role: string;
    roles: { role: { name: string; isSystem: boolean } }[];
    notificationOversightSubscription?: { enabled: boolean } | null;
  };
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  leaseExpiresAt: Date | null;
  claimToken: string | null;
  lastError?: string | null;
  sentAt?: Date | null;
  messageId?: string | null;
  notification: {
    id: string; userId: string; emailedAt: Date | null; deletedAt: Date | null; user: { active: boolean; notificationEmailEnabled: boolean };
    complianceReminderLocation?: { hidden: boolean; list: { active: boolean }; location: { active: boolean } } | null;
    reminderOccurrence?: { referenceOn: Date; intervalMonths: number; reminderLocation: {
      hidden: boolean; referenceOn: Date | null; intervalMonths: number | null;
      list: { active: boolean; defaultIntervalMonths: number }; location: { active: boolean };
    } };
  };
};
function job(id = "n1", overrides: Partial<FakeJob> = {}): FakeJob {
  const user = { id: `user-${id}`, active: true, notificationEmailEnabled: true, role: "EMPLOYEE", roles: [] };
  return {
    id: `delivery-${id}`, notificationId: id, recipientUserId: user.id, kind: "PRIMARY", recipient: user,
    status: "PENDING", attempts: 0, nextAttemptAt: new Date(0), leaseExpiresAt: null, claimToken: null,
    notification: { id, userId: user.id, emailedAt: null, deletedAt: null, user },
    ...overrides,
  };
}
function database(jobs: FakeJob[]) {
  type Where = { id?: string; notificationId?: string | { in: string[] }; status?: string; claimToken?: string; attempts?: { lt?: number; gte?: number }; leaseExpiresAt?: { lte: Date }; nextAttemptAt?: { lte: Date }; OR?: Where[] };
  function matches(row: FakeJob, where: Where): boolean {
    return (!where.id || row.id === where.id) && (!where.notificationId || (typeof where.notificationId === "string" ? row.notificationId === where.notificationId : where.notificationId.in.includes(row.notificationId))) &&
      (!where.status || row.status === where.status) && (!where.claimToken || row.claimToken === where.claimToken) &&
      (!where.attempts || ((where.attempts.lt === undefined || row.attempts < where.attempts.lt) && (where.attempts.gte === undefined || row.attempts >= where.attempts.gte))) &&
      (!where.leaseExpiresAt || Boolean(row.leaseExpiresAt && row.leaseExpiresAt <= where.leaseExpiresAt.lte)) &&
      (!where.nextAttemptAt || row.nextAttemptAt <= where.nextAttemptAt.lte) &&
      (!where.OR || where.OR.some((part) => matches(row, part)));
  }
  const db = {
    notificationEmailDelivery: {
      async findMany({ where, take }: { where: Where; take: number }) {
        return jobs.filter((row) => matches(row, where)).slice(0, take).map(({ id }) => ({ id }));
      },
      async findFirst({ where }: { where: Where }) { return jobs.find((row) => matches(row, where)) ?? null; },
      async updateMany({ where, data }: { where: Where; data: Record<string, unknown> }) {
        const found = jobs.filter((row) => matches(row, where));
        for (const row of found) {
          const increment = data.attempts as { increment: number } | undefined;
          const attempts = row.attempts + (increment?.increment ?? 0);
          Object.assign(row, data, { attempts });
        }
        return { count: found.length };
      },
    },
    notification: { async update({ where, data }: { where: { id: string }; data: { emailedAt: Date } }) {
      Object.assign(jobs.find((row) => row.notificationId === where.id)!.notification, data);
    } },
    async $transaction(callback: (tx: unknown) => unknown) { return callback(db); },
  };
  return db as unknown as Pick<PrismaClient, "notificationEmailDelivery" | "$transaction">;
}

test("configuration requires authenticated SMTP, trusted origin, and valid ports and headers", () => {
  const env = { SMTP_HOST: "mail.example.com", SMTP_PORT: "587", SMTP_USER: "user", SMTP_PASS: "secret", SMTP_FROM: "Success Plus <notice@example.com>", APP_URL: "https://inventory.example.com" };
  assert.equal(readNotificationEmailConfig(env).configured, true);
  assert.equal(readNotificationEmailConfig({ ...env, SMTP_PASS: "" }).configured, false);
  assert.equal(readNotificationEmailConfig({ ...env, SMTP_PORT: "587invalid" }).configured, false);
  assert.equal(readNotificationEmailConfig({ ...env, SMTP_FROM: "a@example.com\r\nBCC: x@example.com" }).configured, false);
  assert.equal(readNotificationEmailConfig({ ...env, APP_URL: "javascript:alert(1)" }).configured, false);
  assert.equal(readNotificationEmailConfig({ ...env, APP_URL: "https://name:pass@example.com" }).configured, false);
});

test("email preserves complete details, escapes HTML, and blocks external links", () => {
  const message = buildNotificationEmail({ id: "n1", title: "<alert>\r\nnew", body: "Full details\nA & B <script>bad</script>", href: "//evil.example", appUrl: "https://inventory.example.com" });
  assert.equal(message.subject, "<alert> new");
  assert.match(message.text, /Full details\nA & B <script>bad<\/script>/);
  assert.match(message.html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(message.html, /evil\.example|<script>/);
  assert.equal(message.messageId, "<notification-n1@inventory.example.com>");
});

test("overlapping workers atomically claim one job and record SMTP acceptance", async () => {
  const row = job();
  const db = database([row]);
  let deliveries = 0;
  const send = async () => { deliveries++; await Promise.resolve(); return { messageId: "provider-id" }; };
  await Promise.all([runNotificationEmailQueue({ db, send }), runNotificationEmailQueue({ db, send })]);
  assert.equal(deliveries, 1);
  assert.equal(row.status, "SENT");
  assert.equal(row.attempts, 1);
  assert.equal(row.messageId, "provider-id");
  assert.ok(row.notification.emailedAt);
  assert.equal(row.claimToken, null);
});

test("SMTP failure stays queued with a future retry and sanitized error", async () => {
  const row = job();
  await runNotificationEmailQueue({ db: database([row]), send: async () => { throw Object.assign(new Error("sensitive server response"), { code: "EAUTH" }); } });
  assert.equal(row.status, "PENDING");
  assert.equal(row.attempts, 1);
  assert.equal(row.notification.emailedAt, null);
  assert.ok(row.nextAttemptAt > new Date());
  assert.doesNotMatch(row.lastError!, /sensitive/);
  assert.match(row.lastError!, /EAUTH/);
});

test("fifth failure is terminal and abandoned fifth lease is recoverable", async () => {
  const failed = job("failed", { attempts: 4 });
  const abandoned = job("abandoned", { status: "SENDING", attempts: 5, leaseExpiresAt: new Date(0), claimToken: "lost" });
  await runNotificationEmailQueue({ db: database([failed, abandoned]), send: async () => { throw new Error("no"); } });
  assert.equal(failed.status, "FAILED");
  assert.equal(abandoned.status, "FAILED");
  assert.equal(failed.attempts, 5);
  assert.equal(abandoned.attempts, 5);
  assert.equal(abandoned.claimToken, null);
});

test("expired lease is reclaimed but unexpired lease is left alone", async () => {
  const stale = job("stale", { status: "SENDING", attempts: 1, leaseExpiresAt: new Date(0), claimToken: "old" });
  const current = job("current", { status: "SENDING", attempts: 1, leaseExpiresAt: new Date(Date.now() + 60_000), claimToken: "current" });
  let deliveries = 0;
  await runNotificationEmailQueue({ db: database([stale, current]), send: async () => { deliveries++; return { messageId: "ok" }; } });
  assert.equal(deliveries, 1);
  assert.equal(stale.status, "SENT");
  assert.equal(stale.attempts, 2);
  assert.equal(current.status, "SENDING");
});

test("inactive, opted-out, and trashed recipients do not reach SMTP", async () => {
  const inactive = job("inactive"); inactive.notification.user.active = false;
  const optedOut = job("opted-out"); optedOut.notification.user.notificationEmailEnabled = false;
  const trashed = job("trashed"); trashed.notification.deletedAt = new Date();
  const jobs = [inactive, optedOut, trashed];
  await runNotificationEmailQueue({ db: database(jobs), send: async () => { assert.fail("SMTP must not be reached"); } });
  assert.ok(jobs.every((row) => row.status === "SKIPPED" && !row.notification.emailedAt));
});

test("targeted dispatch leaves other jobs and future retries alone", async () => {
  const selected = job("selected");
  const other = job("other");
  const future = job("future", { nextAttemptAt: new Date(Date.now() + 60_000) });
  await runNotificationEmailQueue({ db: database([selected, other, future]), notificationIds: ["selected", "future"], send: async () => ({ messageId: "ok" }) });
  assert.equal(selected.status, "SENT");
  assert.equal(other.status, "PENDING");
  assert.equal(future.attempts, 0);
});

test("retry backoff grows and caps at one hour", () => {
  assert.equal(notificationEmailRetryAt(1, new Date(0)).getTime(), 60_000);
  assert.equal(notificationEmailRetryAt(5, new Date(0)).getTime(), 960_000);
  assert.equal(notificationEmailRetryAt(30, new Date(0)).getTime(), 3_600_000);
});

test("one mailbox is required before SMTP can receive a recipient", () => {
  assert.equal(notificationEmailRecipient(" person@example.com "), "person@example.com");
  for (const address of ["a@example.com,b@example.com", "a@example.com; b@example.com", "a@example.com\r\nBCC: b@example.com", "Name <a@example.com>", "a@@example.com"]) {
    assert.throws(() => notificationEmailRecipient(address), { code: "ERECIPIENT" });
  }
});

test("absolute deadline cancels the connection before recording failure", async () => {
  let cancelled = false;
  let complete!: (value: string) => void;
  const pending = withNotificationEmailDeadline(() => new Promise<string>((resolve) => { complete = resolve; }), () => { cancelled = true; }, 10);
  await assert.rejects(pending, (error: unknown) => {
    assert.equal(cancelled, true);
    return error instanceof Error && "code" in error && error.code === "ETIMEDOUT";
  });
  // A late provider completion cannot turn the already timed-out attempt into success.
  complete("late acceptance");
  await assert.rejects(pending, { code: "ETIMEDOUT" });
});

test("a completed send clears its deadline and does not cancel the connection", async () => {
  let cancelled = false;
  const result = await withNotificationEmailDeadline(async () => "accepted", () => { cancelled = true; }, 10);
  assert.equal(result, "accepted");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(cancelled, false);
});

function reminderJob(id: string) {
  const row = job(id);
  row.notification.reminderOccurrence = {
    referenceOn: new Date("2025-12-01T00:00:00Z"), intervalMonths: 11,
    reminderLocation: { hidden: false, referenceOn: new Date("2025-12-01T00:00:00Z"), intervalMonths: null, list: { active: true, defaultIntervalMonths: 11 }, location: { active: true } },
  };
  return row;
}

test("hidden, paused, cleared, inactive and revised reminder schedules suppress queued email", async () => {
  const hidden = reminderJob("hidden"); hidden.notification.reminderOccurrence!.reminderLocation.hidden = true;
  const paused = reminderJob("paused"); paused.notification.reminderOccurrence!.reminderLocation.list.active = false;
  const inactive = reminderJob("inactive-location"); inactive.notification.reminderOccurrence!.reminderLocation.location.active = false;
  const cleared = reminderJob("cleared"); cleared.notification.reminderOccurrence!.reminderLocation.referenceOn = null;
  const revised = reminderJob("revised-date"); revised.notification.reminderOccurrence!.reminderLocation.referenceOn = new Date("2026-01-01T00:00:00Z");
  const inherited = reminderJob("revised-default"); inherited.notification.reminderOccurrence!.reminderLocation.list.defaultIntervalMonths = 12;
  const override = reminderJob("revised-override"); override.notification.reminderOccurrence!.reminderLocation.intervalMonths = 6;
  const jobs = [hidden, paused, inactive, cleared, revised, inherited, override];
  await runNotificationEmailQueue({ db: database(jobs), send: async () => { assert.fail("Paused or superseded reminder must not reach SMTP"); } });
  assert.ok(jobs.every((row) => row.status === "SKIPPED"));
});

test("valid custom occurrence still sends after next due date has advanced", async () => {
  const row = reminderJob("valid-reminder");
  await runNotificationEmailQueue({ db: database([row]), send: async () => ({ messageId: "accepted" }) });
  assert.equal(row.status, "SENT");
});

function oversightJob(source: FakeJob, observerId = "owner-id"): FakeJob {
  return job(`${source.notificationId}-oversight`, {
    notificationId: source.notificationId, notification: source.notification,
    kind: "OVERSIGHT", recipientUserId: observerId,
    recipient: { id: observerId, active: true, role: "ADMIN", roles: [], notificationEmailEnabled: true, notificationOversightSubscription: { enabled: true } },
  });
}

test("jobs sharing a notification are independently claimed under overlapping workers", async () => {
  const primary = job("multi-recipient");
  const oversight = oversightJob(primary);
  const db = database([primary, oversight]);
  const sentIds: string[] = [];
  const send = async (delivery: { id: string }) => { sentIds.push(delivery.id); await Promise.resolve(); return { messageId: delivery.id }; };
  await Promise.all([runNotificationEmailQueue({ db, send }), runNotificationEmailQueue({ db, send })]);
  assert.deepEqual(sentIds.sort(), [primary.id, oversight.id].sort());
  assert.equal(primary.status, "SENT");
  assert.equal(oversight.status, "SENT");
});

test("oversight acceptance cannot mark original recipient email sent after primary fails", async () => {
  const primary = job("failed-primary");
  const oversight = oversightJob(primary);
  await runNotificationEmailQueue({ db: database([primary, oversight]), send: async (delivery) => {
    if (delivery.kind === "PRIMARY") throw Object.assign(new Error("temporary failure"), { code: "ETIMEDOUT" });
    return { messageId: "oversight-accepted" };
  } });
  assert.equal(primary.status, "PENDING");
  assert.equal(oversight.status, "SENT");
  assert.equal(primary.notification.emailedAt, null);
});

test("oversight copies survive original opt-out, trash, inactivity and later schedule pause", async () => {
  const primary = reminderJob("historical-event");
  primary.notification.user.active = false;
  primary.notification.user.notificationEmailEnabled = false;
  primary.notification.deletedAt = new Date();
  primary.notification.reminderOccurrence!.reminderLocation.hidden = true;
  const oversight = oversightJob(primary);
  await runNotificationEmailQueue({ db: database([primary, oversight]), send: async (delivery) => {
    assert.equal(delivery.kind, "OVERSIGHT");
    return { messageId: "event-copy" };
  } });
  assert.equal(primary.status, "SKIPPED");
  assert.equal(oversight.status, "SENT");
  assert.equal(primary.notification.emailedAt, null);
});

test("oversight rechecks subscription, active admin authority, self-copy and own preferences", async () => {
  const source = job("source");
  const disabled = oversightJob(source, "disabled"); disabled.recipient.notificationOversightSubscription!.enabled = false;
  const removed = oversightJob(source, "removed"); removed.recipient.notificationOversightSubscription = null;
  const inactive = oversightJob(source, "inactive"); inactive.recipient.active = false;
  const downgraded = oversightJob(source, "downgraded"); downgraded.recipient.role = "MANAGER";
  const optedOut = oversightJob(source, "optedout"); optedOut.recipient.notificationEmailEnabled = false;
  const self = oversightJob(source, source.recipientUserId);
  const jobs = [disabled, removed, inactive, downgraded, optedOut, self];
  // Use unique delivery IDs like the normalized outbox does.
  jobs.forEach((delivery, index) => { delivery.id += `-${index}`; });
  await runNotificationEmailQueue({ db: database(jobs), send: async () => { assert.fail("Ineligible oversight recipient must not reach SMTP"); } });
  assert.ok(jobs.every((delivery) => delivery.status === "SKIPPED"));
});

test("oversight mail includes full original details, actual recipient, type, time and event context", () => {
  const message = buildNotificationEmail({
    id: "source-event", deliveryId: "private-delivery", title: "Inspection due", body: "Location 42\nCompany A & B\nDue 2026-11-10\nFull task details.",
    href: "/admin/work-orders?location=42", appUrl: "https://inventory.example.com",
    oversight: { recipientName: "Pat <Tech>", recipientEmail: "pat@example.com", type: "WORK_ORDER", createdAt: new Date("2026-11-10T14:30:00Z") },
  });
  assert.equal(message.subject, "[Oversight] Inspection due");
  assert.match(message.text, /Original recipient: Pat <Tech> <pat@example.com>/);
  assert.match(message.text, /Location 42\nCompany A & B\nDue 2026-11-10\nFull task details\./);
  assert.match(message.text, /WORK_ORDER/);
  assert.match(message.text, /America\/New_York/);
  assert.match(message.text, /source-event/);
  assert.match(message.html, /Pat &lt;Tech&gt;/);
  assert.match(message.text, /https:\/\/inventory\.example\.com\/admin\/work-orders\?location=42/);
  assert.equal(message.messageId, "<notification-private-delivery@inventory.example.com>");
});

test("built-in compliance pause suppresses primary mail while preserving delivered-event oversight", async () => {
  const primary = job("builtin-compliance");
  primary.notification.complianceReminderLocation = { hidden: true, list: { active: true }, location: { active: true } };
  const oversight = oversightJob(primary);
  await runNotificationEmailQueue({ db: database([primary, oversight]), send: async (delivery) => {
    assert.equal(delivery.kind, "OVERSIGHT");
    return { messageId: "builtin-event-copy" };
  } });
  assert.equal(primary.status, "SKIPPED");
  assert.equal(oversight.status, "SENT");
});
