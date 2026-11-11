import type { Prisma } from "@prisma/client";
import { reminderEmailAccountAddresses } from "@/app/lib/reminder-email-contacts";
import { reminderRecipientIds } from "@/app/lib/reminder-recipients";

export const reminderRecipientSelection = {
  recipients: { select: { userId: true } },
  emailRecipients: { select: { contactId: true } },
} as const;

type RecipientAssignments = {
  recipients: readonly { userId: string }[];
  emailRecipients: readonly { contactId: string }[];
};

export function reminderDeliveryRecipients(
  category: RecipientAssignments & { includeCategoryRecipients: boolean },
  location: RecipientAssignments & { useLocationRecipients: boolean },
  fallbackUserIds?: string[],
) {
  const inheritance = {
    useLocationRecipients: location.useLocationRecipients,
    includeCategoryRecipients: category.includeCategoryRecipients,
  };
  return {
    userIds: reminderRecipientIds({
      ...inheritance,
      sectionIds: category.recipients.map(({ userId }) => userId),
      locationIds: location.recipients.map(({ userId }) => userId),
      fallbackIds: fallbackUserIds,
    }),
    contactIds: reminderRecipientIds({
      ...inheritance,
      sectionIds: category.emailRecipients.map(({ contactId }) => contactId),
      locationIds: location.emailRecipients.map(({ contactId }) => contactId),
    }),
  };
}

type ReminderSource =
  | { reminderOccurrenceId: string; complianceServiceEntryId?: never }
  | { complianceServiceEntryId: string; reminderOccurrenceId?: never };

/** Call inside the scanner transaction so scheduling and delivery commit together. */
export async function queueReminderEmailEvents(
  tx: Pick<Prisma.TransactionClient, "$queryRaw" | "reminderEmailContact" | "reminderEmailEvent" | "notificationEmailDelivery">,
  input: ReminderSource & {
    contactIds: readonly string[];
    reminderLocationId: string;
    dedupeKey: string;
    title: string;
    body: string;
    referenceOn: Date;
    intervalMonths: number;
  },
): Promise<string[]> {
  const { contactIds, ...event } = input;
  if (!contactIds.length) return [];

  const contacts = await tx.reminderEmailContact.findMany({
    where: { id: { in: [...contactIds] } }, select: { id: true, email: true },
  });
  const accountEmails = new Set(await reminderEmailAccountAddresses(tx, contacts.map(({ email }) => email)));
  const eligibleIds = new Set(contacts.filter(({ email }) => !accountEmails.has(email)).map(({ id }) => id));
  const recipients = contactIds.filter((id) => eligibleIds.has(id));
  if (!recipients.length) return [];

  const created = await tx.reminderEmailEvent.createManyAndReturn({
    data: recipients.map((contactId) => ({ ...event, contactId })),
    skipDuplicates: true,
    select: { id: true },
  });
  if (created.length) await tx.notificationEmailDelivery.createMany({
    data: created.map(({ id }) => ({ reminderEmailEventId: id, kind: "PRIMARY" })),
  });
  return created.map(({ id }) => id);
}
