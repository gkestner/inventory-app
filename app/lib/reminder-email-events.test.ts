import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { queueReminderEmailEvents, reminderDeliveryRecipients } from "./reminder-email-events";

test("adding email-only category recipients keeps the builtin maintenance fallback", () => {
  const category = { recipients: [], emailRecipients: [{ contactId: "inspector" }], includeCategoryRecipients: true };
  const location = { recipients: [], emailRecipients: [], useLocationRecipients: false };
  assert.deepEqual(reminderDeliveryRecipients(category, location, ["maintenance"]), {
    userIds: ["maintenance"], contactIds: ["inspector"],
  });
});

test("a repeated built-in scan creates a new delivery only for a newly selected contact", async () => {
  const events = new Map<string, string>();
  const deliveries: Prisma.NotificationEmailDeliveryCreateManyInput[] = [];
  const tx = {
    async $queryRaw() { return []; },
    reminderEmailContact: {
      async findMany({ where }: { where: { id: { in: string[] } } }) {
        return where.id.in.map((id) => ({ id, email: `${id}@example.invalid` }));
      },
    },
    reminderEmailEvent: {
      async createManyAndReturn({ data }: { data: Prisma.ReminderEmailEventCreateManyInput[] }) {
        return data.flatMap((event) => {
          const key = `${event.contactId}:${event.dedupeKey}`;
          if (events.has(key)) return [];
          const id = `event-${events.size + 1}`;
          events.set(key, id);
          assert.equal(event.complianceServiceEntryId, "service-entry");
          return [{ id }];
        });
      },
    },
    notificationEmailDelivery: {
      async createMany({ data }: { data: Prisma.NotificationEmailDeliveryCreateManyInput[] }) {
        deliveries.push(...data);
        return { count: data.length };
      },
    },
  } as unknown as Parameters<typeof queueReminderEmailEvents>[0];

  const reminder = {
    reminderLocationId: "route", complianceServiceEntryId: "service-entry", dedupeKey: "daily-reminder",
    title: "Due soon", body: "Service is due", referenceOn: new Date("2026-01-31"), intervalMonths: 11,
  };
  assert.deepEqual(await queueReminderEmailEvents(tx, { ...reminder, contactIds: ["first"] }), ["event-1"]);
  assert.deepEqual(await queueReminderEmailEvents(tx, { ...reminder, contactIds: ["first", "second"] }), ["event-2"]);
  assert.deepEqual(deliveries, [
    { reminderEmailEventId: "event-1", kind: "PRIMARY" },
    { reminderEmailEventId: "event-2", kind: "PRIMARY" },
  ]);
});
