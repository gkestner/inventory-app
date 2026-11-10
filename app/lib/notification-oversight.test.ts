import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { isNotificationOversightAdministrator, notificationEmailRecipientPlan, type NotificationObserverIdentity } from "./notification-oversight-rules";
import { createNotificationForUsers } from "./workflow-foundations";

const observer = (overrides: Partial<NotificationObserverIdentity> = {}): NotificationObserverIdentity => ({
  id: "owner-id", active: true, role: "ADMIN", notificationEmailEnabled: true, roles: [], ...overrides,
});

test("global oversight requires current full administrator identity, not module access", () => {
  assert.equal(isNotificationOversightAdministrator(observer()), true);
  assert.equal(isNotificationOversightAdministrator(observer({ role: "MANAGER" })), false);
  assert.equal(isNotificationOversightAdministrator(observer({ role: "ADMIN", active: false })), false);
  assert.equal(isNotificationOversightAdministrator(observer({ role: "EMPLOYEE", roles: [{ role: { name: " admin ", isSystem: true } }] })), true);
  assert.equal(isNotificationOversightAdministrator(observer({ role: "EMPLOYEE", roles: [{ role: { name: "ADMIN", isSystem: false } }] })), false);
});

test("one private job per recipient, no self-copy or duplicate subscriber", () => {
  const plan = notificationEmailRecipientPlan({ id: "employee-id", notificationEmailEnabled: true }, [observer(), observer()]);
  assert.deepEqual(plan, [
    { recipientUserId: "employee-id", kind: "PRIMARY", status: "PENDING" },
    { recipientUserId: "owner-id", kind: "OVERSIGHT", status: "PENDING" },
  ]);
  assert.deepEqual(notificationEmailRecipientPlan({ id: "owner-id", notificationEmailEnabled: true }, [observer()]), [
    { recipientUserId: "owner-id", kind: "PRIMARY", status: "PENDING" },
  ]);
});

test("primary opt-out does not suppress observer; each observer respects their own preference", () => {
  const plan = notificationEmailRecipientPlan({ id: "employee-id", notificationEmailEnabled: false }, [observer(), observer({ id: "other-admin", notificationEmailEnabled: false })]);
  assert.deepEqual(plan.map((item) => [item.recipientUserId, item.status]), [["employee-id", "SKIPPED"], ["owner-id", "PENDING"], ["other-admin", "SKIPPED"]]);
});

test("ineligible subscribers never create an oversight delivery", () => {
  const plan = notificationEmailRecipientPlan({ id: "employee-id", notificationEmailEnabled: true }, [observer({ active: false }), observer({ id: "manager", role: "MANAGER" })]);
  assert.equal(plan.length, 1);
});

function transactionalDb(actualId = "employee-id", primaryEnabled = false) {
  const created: Array<{ userId: string; emailDeliveries: { create: unknown[] }; complianceReminderLocationId?: string | null }> = [];
  const db = {
    user: { async findMany(args: { where?: { id?: { in: string[] } }; select: { notificationEmailEnabled?: boolean } }) {
      if (args.select.notificationEmailEnabled) return [{ id: actualId, notificationEmailEnabled: primaryEnabled }];
      return (args.where?.id?.in ?? [actualId]).map((id) => ({
        id, active: true,
        uiPreferences: id === "vacation-source" ? { notifications: { vacationRouting: { enabled: true, forwardToUserIds: [actualId] } } } : null,
      }));
    } },
    notificationOversightSubscriber: { async findMany(args: { where: { enabled: boolean } }) {
      assert.equal(args.where.enabled, true);
      return [{ user: observer() }];
    } },
    notification: {
      async findUnique() { return null; },
      async create(args: { data: typeof created[number] }) { created.push(args.data); return { id: `notification-${created.length}` }; },
    },
  };
  return { db: db as unknown as Prisma.TransactionClient, created };
}

test("shared transactional creation saves primary and oversight jobs with one notification", async () => {
  const fixture = transactionalDb();
  const ids = await createNotificationForUsers({ userIds: ["employee-id", "employee-id"], title: "Complete details", body: "Location, task, date and company", complianceReminderLocationId: "builtin-location" }, { tx: fixture.db, scheduleEmails: false });
  assert.deepEqual(ids, ["notification-1"]);
  assert.equal(fixture.created[0].userId, "employee-id");
  assert.equal(fixture.created[0].complianceReminderLocationId, "builtin-location");
  assert.deepEqual(fixture.created[0].emailDeliveries.create, [
    { recipientUserId: "employee-id", kind: "PRIMARY", status: "SKIPPED" },
    { recipientUserId: "owner-id", kind: "OVERSIGHT", status: "PENDING" },
  ]);
});

test("owner's own event creates a primary job only, not a second oversight copy", async () => {
  const fixture = transactionalDb("owner-id", true);
  await createNotificationForUsers({ userIds: ["owner-id"], title: "Own notification" }, { tx: fixture.db, scheduleEmails: false });
  assert.deepEqual(fixture.created[0].emailDeliveries.create, [{ recipientUserId: "owner-id", kind: "PRIMARY", status: "PENDING" }]);
});

test("oversight follows the actual vacation-routed recipient, without recreating the source user's event", async () => {
  const fixture = transactionalDb();
  await createNotificationForUsers({ userIds: ["vacation-source", "employee-id"], title: "Routed task" }, { tx: fixture.db, scheduleEmails: false });
  assert.equal(fixture.created.length, 1);
  assert.equal(fixture.created[0].userId, "employee-id");
  assert.deepEqual(fixture.created[0].emailDeliveries.create.map((item) => (item as { recipientUserId: string }).recipientUserId), ["employee-id", "owner-id"]);
});
