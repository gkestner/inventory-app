import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "@prisma/client";
import { runNotificationReminderScan } from "./notification-reminders";
import type { createNotificationForUsers } from "./workflow-foundations";

const date = (value: string) => new Date(`${value}T00:00:00Z`);
type Row = {
  id: string; listId: string; locationId: string; companyId: string | null;
  hidden: boolean; referenceOn: Date | null; nextDueOn: Date | null; intervalMonths: number | null;
  useLocationRecipients: boolean; recipients: { userId: string }[]; emailRecipients: { contactId: string }[];
  list: { name: string; active: boolean; complianceKind: "GREASE_TRAP" | null; defaultIntervalMonths: number; includeCategoryRecipients: boolean; recipients: { userId: string }[]; emailRecipients: { contactId: string }[] };
  location: { name: string; active: boolean; locationNumber: string };
  company: { name: string } | null;
};
type Occurrence = { id: string; reminderLocationId: string; dueOn: Date; referenceOn: Date; intervalMonths: number; companyId: string | null };
type RecipientWhere = { recipients?: unknown; emailRecipients?: unknown };
type Where = RecipientWhere & {
  id?: string | { gt: string }; listId?: string; hidden?: boolean; companyId?: string | null; intervalMonths?: number | null;
  useLocationRecipients?: boolean;
  referenceOn?: Date | { not: null } | null; nextDueOn?: Date | { lte?: Date; gt?: Date } | null;
  AND?: Where[]; OR?: Where[];
  list?: RecipientWhere & { active?: boolean; complianceKind?: "GREASE_TRAP" | null; includeCategoryRecipients?: boolean; OR?: RecipientWhere[] };
  location?: { active?: boolean };
};
function row(id = "row1"): Row {
  return {
    id, listId: "list1", locationId: `location-${id}`, companyId: "company1", hidden: false,
    useLocationRecipients: false, recipients: [], emailRecipients: [],
    referenceOn: date("2025-12-31"), nextDueOn: date("2026-11-30"), intervalMonths: null,
    list: { name: "Inspections", active: true, complianceKind: null, defaultIntervalMonths: 11, includeCategoryRecipients: false, recipients: [{ userId: "user1" }], emailRecipients: [] },
    location: { name: "Main Street", active: true, locationNumber: "12" }, company: { name: "Service Company" },
  };
}
function memory(rows: Row[], initialOccurrences: Occurrence[] = [], options?: { failDelivery?: boolean; appAccountAddresses?: string[] }) {
  const state = {
    rows, occurrences: initialOccurrences, audits: [] as unknown[],
    notifications: [] as Parameters<typeof createNotificationForUsers>[0][],
    emailEvents: [] as (Prisma.ReminderEmailEventCreateManyInput & { id: string })[],
    deliveries: [] as Prisma.NotificationEmailDeliveryCreateManyInput[],
  };
  let tail = Promise.resolve();
  let onRead: (() => void) | undefined;
  function matchesRecipients(item: Pick<Row, "recipients" | "emailRecipients">, where: RecipientWhere) {
    return (!where.recipients || item.recipients.length > 0) && (!where.emailRecipients || item.emailRecipients.length > 0);
  }
  function matches(item: Row, where: Where): boolean {
    if (where.AND && !where.AND.every((part) => matches(item, part))) return false;
    if (where.OR && !where.OR.some((part) => matches(item, part))) return false;
    if (where.id && (typeof where.id === "string" ? item.id !== where.id : item.id <= where.id.gt)) return false;
    if (where.listId && item.listId !== where.listId) return false;
    if (where.hidden !== undefined && item.hidden !== where.hidden) return false;
    if (where.useLocationRecipients !== undefined && item.useLocationRecipients !== where.useLocationRecipients) return false;
    if (!matchesRecipients(item, where)) return false;
    if ("companyId" in where && item.companyId !== where.companyId) return false;
    if ("intervalMonths" in where && item.intervalMonths !== where.intervalMonths) return false;
    if (where.referenceOn instanceof Date && item.referenceOn?.getTime() !== where.referenceOn.getTime()) return false;
    if (where.referenceOn && !(where.referenceOn instanceof Date) && !item.referenceOn) return false;
    if (where.nextDueOn instanceof Date && item.nextDueOn?.getTime() !== where.nextDueOn.getTime()) return false;
    if (where.nextDueOn && !(where.nextDueOn instanceof Date)) {
      if (!item.nextDueOn || (where.nextDueOn.lte && item.nextDueOn > where.nextDueOn.lte) || (where.nextDueOn.gt && item.nextDueOn <= where.nextDueOn.gt)) return false;
    }
    if (where.list?.active !== undefined && item.list.active !== where.list.active) return false;
    if (where.list?.includeCategoryRecipients !== undefined && item.list.includeCategoryRecipients !== where.list.includeCategoryRecipients) return false;
    if (where.list && "complianceKind" in where.list && item.list.complianceKind !== where.list.complianceKind) return false;
    if (where.list && !matchesRecipients(item.list, where.list)) return false;
    if (where.list?.OR && !where.list.OR.some((part) => matchesRecipients(item.list, part))) return false;
    if (where.location?.active !== undefined && item.location.active !== where.location.active) return false;
    return true;
  }
  const db = {
    async $queryRaw(parts: TemplateStringsArray) {
      return parts.join("").includes('FROM "User"') ? (options?.appAccountAddresses ?? []).map((email) => ({ email })) : [];
    },
    notificationReminderLocation: {
      async findMany({ where, take }: { where: Where; take: number }) {
        const found = state.rows.filter((item) => matches(item, where)).sort((a, b) => a.nextDueOn!.getTime() - b.nextDueOn!.getTime() || a.id.localeCompare(b.id)).slice(0, take);
        const result = structuredClone(found);
        onRead?.(); onRead = undefined;
        return result;
      },
      async findFirst({ where }: { where: Where }) { return structuredClone(state.rows.find((item) => matches(item, where)) ?? null); },
      async updateMany({ where, data }: { where: Where; data: Partial<Row> }) {
        const found = state.rows.filter((item) => matches(item, where));
        found.forEach((item) => Object.assign(item, data));
        return { count: found.length };
      },
    },
    notificationReminderOccurrence: {
      async findUnique({ where }: { where: { reminderLocationId_dueOn: { reminderLocationId: string; dueOn: Date } } }) {
        const key = where.reminderLocationId_dueOn;
        return structuredClone(state.occurrences.find((item) => item.reminderLocationId === key.reminderLocationId && item.dueOn.getTime() === key.dueOn.getTime()) ?? null);
      },
      async create({ data }: { data: Omit<Occurrence, "id"> }) {
        const created = { id: `occurrence-${state.occurrences.length + 1}`, ...structuredClone(data) };
        state.occurrences.push(created);
        return created;
      },
    },
    reminderEmailContact: {
      async findMany({ where }: { where: { id: { in: string[] } } }) {
        return where.id.in.map((id) => ({ id, email: `${id}@example.invalid` }));
      },
    },
    reminderEmailEvent: {
      async createManyAndReturn({ data }: { data: Prisma.ReminderEmailEventCreateManyInput[] }) {
        const events = [];
        for (const value of data) {
          if (state.emailEvents.some((event) => event.contactId === value.contactId && event.dedupeKey === value.dedupeKey)) continue;
          const event = { ...value, id: `email-event-${state.emailEvents.length + 1}` };
          state.emailEvents.push(event);
          events.push({ id: event.id });
        }
        return events;
      },
    },
    notificationEmailDelivery: {
      async createMany({ data }: { data: Prisma.NotificationEmailDeliveryCreateManyInput[] }) {
        if (options?.failDelivery) throw new Error("Delivery insert failed");
        state.deliveries.push(...data);
        return { count: data.length };
      },
    },
    auditLog: { async create({ data }: { data: unknown }) { state.audits.push(data); } },
    async $transaction<T>(callback: (tx: unknown) => Promise<T>) {
      let release!: () => void;
      const previous = tail;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const snapshot = structuredClone(state);
      try { return await callback(db); } catch (error) { Object.assign(state, snapshot); throw error; } finally { release(); }
    },
  };
  const client = db as unknown as PrismaClient;
  const notify: typeof createNotificationForUsers = async (args, options) => {
    assert.equal(options?.tx, db);
    assert.equal(options?.scheduleEmails, false);
    state.notifications.push(args);
    return [`notification-${state.notifications.length}`];
  };
  const scheduled: string[][] = [];
  return { state, client, notify, scheduled, setOnRead(callback: () => void) { onRead = callback; }, dependencies: { db: client, notify, schedule: (ids: string[]) => { scheduled.push(ids); }, isDemo: async () => false } };
}

test("due reminder uses shared notification pipeline and advances from original month-end anchor", async () => {
  const fixture = memory([row()]);
  const result = await runNotificationReminderScan({ today: date("2026-11-30") }, fixture.dependencies);
  assert.equal(result.occurrences, 1);
  assert.equal(result.notifications, 1);
  assert.equal(fixture.state.rows[0].nextDueOn?.toISOString().slice(0, 10), "2027-10-31");
  const notification = fixture.state.notifications[0];
  assert.equal(notification.reminderOccurrenceId, fixture.state.occurrences[0].id);
  assert.equal(notification.href, "/notifications");
  assert.match(notification.body!, /Service Company/);
  assert.match(notification.body!, /2025-12-31/);
  assert.match(notification.body!, /every 11 months/);
  assert.equal(fixture.state.audits.length, 1);
  assert.deepEqual(fixture.scheduled, [["notification-1"]]);
});

test("all-location category recipients join custom overrides without duplicates, while paused locations stay quiet", async () => {
  const combined = row("combined");
  combined.useLocationRecipients = true;
  combined.list.includeCategoryRecipients = true;
  combined.recipients = [{ userId: "user1" }, { userId: "location-person" }];
  const categoryOnly = row("fallback");
  categoryOnly.useLocationRecipients = true;
  categoryOnly.list.includeCategoryRecipients = true;
  const paused = { ...combined, id: "paused", hidden: true };
  const fixture = memory([combined, categoryOnly, paused]);
  const result = await runNotificationReminderScan({ today: date("2026-11-30") }, fixture.dependencies);
  assert.equal(result.occurrences, 2);
  assert.deepEqual(fixture.state.notifications.map(({ userIds }) => userIds), [["user1", "location-person"], ["user1"]]);
});

test("email-only reminders advance on the anchor and queue one durable delivery for each contact", async () => {
  const standalone = row();
  standalone.list.recipients = [];
  standalone.list.emailRecipients = [{ contactId: "category" }];
  standalone.list.includeCategoryRecipients = true;
  standalone.useLocationRecipients = true;
  standalone.emailRecipients = [{ contactId: "category" }, { contactId: "local" }];
  const fixture = memory([standalone]);

  const result = await runNotificationReminderScan({ today: date("2026-11-30") }, fixture.dependencies);
  assert.equal(result.occurrences, 1);
  assert.equal(result.notifications, 0);
  assert.equal(result.emailDeliveries, 2);
  assert.equal(fixture.state.rows[0].nextDueOn?.toISOString().slice(0, 10), "2027-10-31");
  assert.deepEqual(fixture.state.emailEvents.map(({ contactId }) => contactId), ["category", "local"]);
  assert.ok(fixture.state.emailEvents.every(({ reminderOccurrenceId }) => reminderOccurrenceId === fixture.state.occurrences[0].id));
  assert.match(fixture.state.emailEvents[0].body, /Reminder due: 2026-11-30/);
  assert.deepEqual(fixture.state.deliveries, fixture.state.emailEvents.map(({ id }) => ({ reminderEmailEventId: id, kind: "PRIMARY" })));
  assert.deepEqual(fixture.scheduled, [[]]);

  await runNotificationReminderScan({ today: date("2026-11-30") }, fixture.dependencies);
  assert.equal(fixture.state.deliveries.length, 2);
});

test("an email-only reminder restores its due date and occurrence if the outbox insert fails", async () => {
  const standalone = row();
  standalone.list.recipients = [];
  standalone.list.emailRecipients = [{ contactId: "category" }];
  const fixture = memory([standalone], [], { failDelivery: true });
  await assert.rejects(runNotificationReminderScan({ today: date("2026-11-30") }, fixture.dependencies), /Delivery insert failed/);
  assert.equal(fixture.state.rows[0].nextDueOn?.toISOString().slice(0, 10), "2026-11-30");
  assert.equal(fixture.state.occurrences.length, 0);
  assert.equal(fixture.state.emailEvents.length, 0);
  assert.equal(fixture.state.deliveries.length, 0);
});

test("an email-only schedule remains due when its sole contact now has an app account", async () => {
  const standalone = row();
  standalone.list.recipients = [];
  standalone.list.emailRecipients = [{ contactId: "new-account" }];
  const fixture = memory([standalone], [], { appAccountAddresses: ["new-account@example.invalid"] });
  const result = await runNotificationReminderScan({ today: date("2026-11-30") }, fixture.dependencies);
  assert.equal(result.skipped, 1);
  assert.equal(result.emailDeliveries, 0);
  assert.equal(fixture.state.rows[0].nextDueOn?.toISOString().slice(0, 10), "2026-11-30");
  assert.equal(fixture.state.occurrences.length, 0);
  assert.equal(fixture.state.emailEvents.length, 0);
  assert.equal(fixture.state.deliveries.length, 0);
});

test("many overdue cycles produce one catch-up and one next future anchored date", async () => {
  const overdue = row(); Object.assign(overdue, { referenceOn: date("2020-01-31"), nextDueOn: date("2020-02-29"), intervalMonths: 1 });
  const fixture = memory([overdue]);
  await runNotificationReminderScan({ today: date("2026-11-09") }, fixture.dependencies);
  assert.equal(fixture.state.occurrences.length, 1);
  assert.equal(fixture.state.rows[0].nextDueOn?.toISOString().slice(0, 10), "2026-11-30");
});

test("hidden, paused, inactive, undated and future rows do not trigger reminders", async () => {
  const hidden = row("hidden"); hidden.hidden = true;
  const paused = row("paused"); paused.list.active = false;
  const inactive = row("inactive"); inactive.location.active = false;
  const undated = row("undated"); undated.referenceOn = null; undated.nextDueOn = null;
  const future = row("future"); future.nextDueOn = date("2027-12-01");
  const fixture = memory([hidden, paused, inactive, undated, future]);
  const result = await runNotificationReminderScan({ today: date("2026-11-30") }, fixture.dependencies);
  assert.equal(result.scanned, 0);
  assert.equal(fixture.state.occurrences.length, 0);
});

test("no routed recipients rolls back occurrence and date advance", async () => {
  const fixture = memory([row()]);
  const result = await runNotificationReminderScan({ today: date("2026-11-30") }, { ...fixture.dependencies, notify: async () => [] });
  assert.equal(result.skipped, 1);
  assert.equal(fixture.state.occurrences.length, 0);
  assert.equal(fixture.state.rows[0].nextDueOn?.toISOString().slice(0, 10), "2026-11-30");
});

test("overlapping scans dedupe and recheck due state inside transaction", async () => {
  const fixture = memory([row()]);
  await Promise.all([
    runNotificationReminderScan({ today: date("2026-11-30") }, fixture.dependencies),
    runNotificationReminderScan({ today: date("2026-11-30") }, fixture.dependencies),
  ]);
  assert.equal(fixture.state.occurrences.length, 1);
  assert.equal(fixture.state.notifications.length, 1);
});

test("pagination reaches later due rows even when earlier recipients are unreachable", async () => {
  const fixture = memory(Array.from({ length: 205 }, (_, index) => row(`row-${String(index).padStart(3, "0")}`)));
  const result = await runNotificationReminderScan({ today: date("2026-11-30") }, { ...fixture.dependencies, notify: async () => [] });
  assert.equal(result.scanned, 205);
  assert.equal(result.skipped, 205);
  assert.equal(result.incomplete, false);
});

test("bounded scan reports incomplete instead of silently claiming all work finished", async () => {
  const fixture = memory([row("a"), row("b")]);
  const result = await runNotificationReminderScan({ today: date("2026-11-30"), limit: 1 }, fixture.dependencies);
  assert.equal(result.occurrences, 1);
  assert.equal(result.incomplete, true);
});

test("existing occurrence cannot be replayed by resetting the same due date", async () => {
  const reminder = row();
  const fixture = memory([reminder], [{ id: "old", reminderLocationId: reminder.id, dueOn: reminder.nextDueOn!, referenceOn: reminder.referenceOn!, intervalMonths: 11, companyId: reminder.companyId }]);
  await runNotificationReminderScan({ today: date("2026-11-30") }, fixture.dependencies);
  assert.equal(fixture.state.occurrences.length, 1);
  assert.equal(fixture.state.notifications.length, 0);
  assert.equal(fixture.state.rows[0].nextDueOn?.toISOString().slice(0, 10), "2027-10-31");
});

test("a location hidden after selection is rechecked and cannot trigger", async () => {
  const fixture = memory([row()]);
  fixture.setOnRead(() => { fixture.state.rows[0].hidden = true; });
  await runNotificationReminderScan({ today: date("2026-11-30") }, fixture.dependencies);
  assert.equal(fixture.state.occurrences.length, 0);
});

test("demo mode does not read, advance or notify", async () => {
  const fixture = memory([row()]);
  const result = await runNotificationReminderScan({ today: date("2026-11-30") }, { ...fixture.dependencies, isDemo: async () => true });
  assert.equal(result.demo, true);
  assert.equal(result.scanned, 0);
  assert.equal(fixture.state.occurrences.length, 0);
});

test("custom scan excludes builtin compliance sections", async () => {
  const builtin = row(); builtin.list.complianceKind = "GREASE_TRAP";
  const fixture = memory([builtin]);
  await runNotificationReminderScan({ today: date("2026-11-30") }, fixture.dependencies);
  assert.equal(fixture.state.notifications.length, 0);
});

test("location recipient override replaces section recipients and supports multiple people", async () => {
  const override = row(); override.useLocationRecipients = true;
  override.recipients = [{ userId: "local1" }, { userId: "local2" }];
  override.list.recipients = [];
  const fixture = memory([override]);
  await runNotificationReminderScan({ today: date("2026-11-30") }, fixture.dependencies);
  assert.deepEqual(fixture.state.notifications[0].userIds, ["local1", "local2"]);
});
