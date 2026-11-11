import { Prisma } from "@prisma/client";
import { notificationEmailRecipient } from "@/app/lib/notification-email-content";
import { REMINDER_EMAIL_INPUT_LIMIT, REMINDER_EMAIL_LIMIT, sameRecipientIds } from "@/app/lib/reminder-recipients";

export class ReminderEmailInputError extends Error {}
export type ReminderEmailLink = { contactId: string; contact: { email: string } };
export const reminderEmailLinkInclude = { include: { contact: { select: { email: true } } } } as const;

export function readReminderEmailRecipients(form: FormData) {
  if (!form.has("emailRecipients")) return undefined; // Keep existing links on older forms.
  const value = form.get("emailRecipients");
  if (typeof value !== "string" || value.length > REMINDER_EMAIL_INPUT_LIMIT) throw new ReminderEmailInputError("The email list is too long.");
  const addresses = [...new Set(value.split(/[\n,;]/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (addresses.length > REMINDER_EMAIL_LIMIT) throw new ReminderEmailInputError(`Choose at most ${REMINDER_EMAIL_LIMIT} email-only recipients.`);
  for (const address of addresses) {
    try {
      notificationEmailRecipient(address);
      if (address.length > 254 || /[\x00-\x1F\x7F]/.test(address)) throw new Error("Invalid mailbox");
    } catch { throw new ReminderEmailInputError("Enter valid email addresses, one per line or separated by commas."); }
  }
  return addresses;
}

export async function reminderEmailAccountAddresses(db: Pick<Prisma.TransactionClient, "$queryRaw">, addresses: string[]) {
  if (!addresses.length) return [];
  const accounts = await db.$queryRaw<{ email: string }[]>`SELECT DISTINCT lower(email) AS email FROM "User" WHERE lower(email) IN (${Prisma.join(addresses)})`;
  return accounts.map(({ email }) => email);
}

export async function reminderEmailAccountExists(db: Pick<Prisma.TransactionClient, "$queryRaw">, addresses: string[]) {
  return (await reminderEmailAccountAddresses(db, addresses)).length > 0;
}

export async function saveReminderEmailLinks(tx: Prisma.TransactionClient, scope: { listId: string } | { reminderLocationId: string },
  addresses: string[] | undefined, before: ReminderEmailLink[] = []) {
  const beforeIds = before.map(({ contactId }) => contactId);
  if (!addresses || sameRecipientIds(before.map(({ contact }) => contact.email), addresses)) return { changed: false, contactIds: beforeIds };
  if (addresses.length) {
    if (await reminderEmailAccountExists(tx, addresses)) throw new ReminderEmailInputError("One of these addresses belongs to an app account. Choose that person from the user list instead.");
    await tx.reminderEmailContact.createMany({ data: addresses.map((email) => ({ email })), skipDuplicates: true });
  }
  const contacts = addresses.length ? await tx.reminderEmailContact.findMany({ where: { email: { in: addresses } }, select: { id: true } }) : [];
  const contactIds = contacts.map(({ id }) => id);
  if (contactIds.length !== addresses.length) throw new Error("Reminder email addresses could not be saved.");
  if ("listId" in scope) {
    await tx.notificationReminderListEmailRecipient.deleteMany({ where: scope });
    if (contacts.length) await tx.notificationReminderListEmailRecipient.createMany({ data: contactIds.map((contactId) => ({ ...scope, contactId })) });
  } else {
    await tx.notificationReminderLocationEmailRecipient.deleteMany({ where: scope });
    if (contacts.length) await tx.notificationReminderLocationEmailRecipient.createMany({ data: contactIds.map((contactId) => ({ ...scope, contactId })) });
  }
  return { changed: true, contactIds };
}
