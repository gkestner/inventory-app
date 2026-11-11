"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { requireReminderManager } from "@/app/lib/notification-reminder-access";
import { lockNotificationReminderList, pauseQueuedReminderEmails } from "@/app/lib/notification-reminders";
import { addReminderMonths, formatReminderDate, parseReminderDate, parseReminderMonths } from "@/app/lib/reminder-dates";
import { savePreventativeMaintenanceEntryWithAudit } from "@/app/lib/preventative-maintenance";
import { submittedComplianceValues } from "@/app/lib/compliance-fields";
import { parsedComplianceSubmission, latestComplianceRecords } from "@/app/lib/compliance-history-fields";
import { ComplianceHistoryInputError, recordComplianceServiceEntry } from "@/app/lib/compliance-history-writer";
import { sameRecipientIds } from "@/app/lib/reminder-recipients";
import { readReminderEmailRecipients, reminderEmailLinkInclude, ReminderEmailInputError, saveReminderEmailLinks, type ReminderEmailLink } from "@/app/lib/reminder-email-contacts";

class ReminderInputError extends Error {}
const routingInclude = { recipients: true, emailRecipients: reminderEmailLinkInclude } as const;
type RecipientLinks = { recipients: { userId: string }[]; emailRecipients: ReminderEmailLink[] };
const links = (row: RecipientLinks) => ({ recipientUserIds: row.recipients.map(({ userId }) => userId), emailContactIds: row.emailRecipients.map(({ contactId }) => contactId) });
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const bool = (form: FormData, key: string) => ["1", "true", "on", "yes"].includes(text(form, key).toLowerCase());
function nameField(form: FormData) {
  const name = text(form, "name").replace(/\s+/g, " ");
  if (!name || name.length > 160) throw new ReminderInputError("Enter a name between 1 and 160 characters.");
  return name;
}
function inputMonths(raw: string, optional = false) {
  if (optional && !raw) return null;
  const months = parseReminderMonths(raw);
  if (!months) throw new ReminderInputError("Reminder intervals must be whole numbers from 1 to 120 months.");
  return months;
}
function firstDue(referenceOn: Date | null, months: number) {
  if (!referenceOn) return null;
  const due = addReminderMonths(referenceOn, months);
  if (due.getUTCFullYear() > 9999) throw new ReminderInputError("Enter an earlier date for this reminder interval.");
  return due;
}
function returnTo(form: FormData, listId: string, feedback: { saved?: string; error?: string }) {
  const query = new URLSearchParams();
  if (listId) query.set("section", listId);
  const year = text(form, "year");
  if (/^\d{4}$/.test(year)) query.set("year", year);
  if (bool(form, "showHidden")) query.set("showHidden", "1");
  if (feedback.saved) query.set("saved", feedback.saved);
  if (feedback.error) query.set("error", feedback.error);
  const locationId = text(form, "locationId");
  if (locationId) query.set("location", locationId);
  const anchor = listId && locationId ? `#location-${encodeURIComponent(listId)}-${encodeURIComponent(locationId)}` : "";
  redirect(`/admin/preventative-maintenance/compliance?${query}${anchor}`);
}
function failure(error: unknown) {
  if (error instanceof ReminderInputError || error instanceof ComplianceHistoryInputError || error instanceof ReminderEmailInputError) return error.message;
  console.error("[notification-reminders] An authenticated update could not be saved.");
  return "The reminder could not be saved. Please try again.";
}
function refresh() {
  revalidatePath("/admin/notification-reminders");
  revalidatePath("/admin/preventative-maintenance/compliance");
  revalidatePath("/maintenance/preventative-maintenance/compliance");
  revalidatePath("/notifications");
  revalidatePath("/admin/reports/compliance-history");
}

export async function recordComplianceEntryAction(form: FormData) {
  const actor = await requireReminderManager();
  const listId = text(form, "listId");
  let error: string | undefined;
  let created = false;
  try {
    const locationId = text(form, "locationId");
    const year = Number(text(form, "year"));
    if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new ReminderInputError("Choose an entry year from 2020 to 2100.");
    const submissionToken = text(form, "submissionToken");
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(submissionToken)) throw new ReminderInputError("Refresh the page before adding a new entry.");
    await prisma.$transaction(async tx => {
      await lockNotificationReminderList(tx, listId);
      const section = await tx.notificationReminderList.findUnique({where: {id: listId}});
      if (!section) throw new ReminderInputError("Choose an existing compliance section.");
      await tx.$queryRaw`SELECT "id" FROM "Location" WHERE "id" = ${locationId} FOR UPDATE`;
      if (!await tx.location.findFirst({where: {id: locationId, active: true}, select: {id: true}})) throw new ReminderInputError("Choose an active location.");
      const parsed = parsedComplianceSubmission(form, section.defaultIntervalMonths);
      if (!parsed.values) throw new ReminderInputError(parsed.error);
      const values = {...parsed.values,
        tankSize: section.complianceKind === "GREASE_TRAP" ? parsed.values.tankSize : null,
        gallons: section.complianceKind === "GREASE_TRAP" ? parsed.values.gallons : null,
        additionalDate: section.complianceKind === "BOILER" ? parsed.values.additionalDate : null,
      };
      const routing = await tx.notificationReminderLocation.upsert({where: {listId_locationId: {listId, locationId}}, create: {listId, locationId}, update: {}});
      const result = await recordComplianceServiceEntry(tx, {section, routing, actorUserId: actor.id, year, submissionToken, values});
      created = result.created;
      if (result.anchorChanged || routing.hidden || !section.active) await pauseQueuedReminderEmails(tx, {listId, reminderLocationId: routing.id});
    }, {maxWait: 10_000, timeout: 30_000});
  } catch (caught) {error = failure(caught);}
  if (error) returnTo(form, listId, {error});
  refresh();
  returnTo(form, listId, {saved: created ? "New compliance entry added. Previous entries remain in history." : "This entry was already saved."});
}

export async function saveComplianceRoutingAction(form: FormData) {
  const actor = await requireReminderManager();
  const listId = text(form, "listId");
  let error: string | undefined;
  try {
    const locationId = text(form, "locationId");
    const expectedId = text(form, "reminderLocationId");
    const enabled = bool(form, "useLocationRecipients");
    const ids = recipientIds(form, "locationRecipientIds");
    const emails = readReminderEmailRecipients(form);
    await prisma.$transaction(async tx => {
      await lockNotificationReminderList(tx, listId);
      const section = await tx.notificationReminderList.findUnique({where: {id: listId}});
      if (!section || !await tx.location.findFirst({where: {id: locationId, active: true}, select: {id: true}})) throw new ReminderInputError("Choose an active section location.");
      const previous = await tx.notificationReminderLocation.findUnique({where: {listId_locationId: {listId, locationId}}, include: routingInclude});
      if (expectedId && previous?.id !== expectedId) throw new ReminderInputError("This location has changed. Refresh and try again.");
      const saved = await tx.notificationReminderLocation.upsert({where: {listId_locationId: {listId, locationId}}, create: {listId, locationId, useLocationRecipients: enabled}, update: {useLocationRecipients: enabled}});
      const routing = await saveLocationRecipients(tx, saved.id, enabled, ids, emails, previous);
      if (routing.changed || saved.hidden || !section.active) await pauseQueuedReminderEmails(tx, {listId, reminderLocationId: saved.id});
      await audit(tx, actor.id, "NotificationReminderLocation", saved.id, "SAVE_COMPLIANCE_RECIPIENTS", {listId, locationId, before: previous ? {useLocationRecipients: previous.useLocationRecipients, ...links(previous)} : null, after: {useLocationRecipients: enabled, recipientUserIds: enabled ? ids : [], emailContactIds: routing.contactIds}});
    });
  } catch (caught) {error = failure(caught);}
  if (error) returnTo(form, listId, {error});
  refresh();
  returnTo(form, listId, {saved: "Location recipients saved."});
}
async function audit(tx: Prisma.TransactionClient, actorUserId: string, entityType: string, entityId: string, action: string, metadata: Prisma.InputJsonValue) {
  return tx.auditLog.create({ data: { actorUserId, module: "NOTIFICATION_REMINDERS", entityType, entityId, action, metadata } });
}

function recipientIds(form: FormData, key: string) {
  return [...new Set(form.getAll(key).map(String).map((id) => id.trim()).filter(Boolean))];
}
async function validateRecipients(tx: Pick<Prisma.TransactionClient, "user">, ids: string[]) {
  if (ids.length && await tx.user.count({ where: { id: { in: ids }, active: true } }) !== ids.length) {
    throw new ReminderInputError("Choose active users from the recipient list.");
  }
}
async function saveLocationRecipients(tx: Prisma.TransactionClient, id: string, enabled: boolean, ids: string[], emails: string[] | undefined, previous: (RecipientLinks & { useLocationRecipients: boolean }) | null) {
  if (enabled && !ids.length && !(emails?.length ?? previous?.emailRecipients.length)) throw new ReminderInputError("Choose a user or add an email address, or use the category recipients.");
  const next = enabled ? ids : [];
  await validateRecipients(tx, next);
  const linksChanged = !sameRecipientIds(previous?.recipients.map(({ userId }) => userId) ?? [], next);
  if (linksChanged) {
    await tx.notificationReminderLocationRecipient.deleteMany({ where: { reminderLocationId: id } });
    if (next.length) await tx.notificationReminderLocationRecipient.createMany({ data: next.map((userId) => ({ reminderLocationId: id, userId })) });
  }
  const email = await saveReminderEmailLinks(tx, { reminderLocationId: id }, enabled ? emails : [], previous?.emailRecipients);
  return { contactIds: email.contactIds, changed: linksChanged || email.changed || (previous?.useLocationRecipients ?? false) !== enabled };
}

async function saveCategoryRecipientLinks(tx: Prisma.TransactionClient, listId: string, before: string[], after: string[]) {
  await validateRecipients(tx, after);
  if (sameRecipientIds(before, after)) return false;
  await tx.notificationReminderRecipient.deleteMany({ where: { listId } });
  if (after.length) await tx.notificationReminderRecipient.createMany({ data: after.map((userId) => ({ listId, userId })) });
  return true;
}

export async function saveCategoryRecipientsAction(form: FormData) {
  const actor = await requireReminderManager();
  const listId = text(form, "listId");
  const ids = recipientIds(form, "recipientIds");
  const includeCategoryRecipients = bool(form, "includeCategoryRecipients");
  let error: string | undefined;
  try {
    const emails = readReminderEmailRecipients(form);
    await prisma.$transaction(async (tx) => {
      await lockNotificationReminderList(tx, listId);
      const previous = await tx.notificationReminderList.findUnique({ where: { id: listId }, include: routingInclude });
      if (!previous) throw new ReminderInputError("Choose an existing compliance category.");
      if (!previous.complianceKind && !ids.length && !(emails?.length ?? previous.emailRecipients.length)) throw new ReminderInputError("Choose an app user or add an email address for this category.");
      const before = links(previous);
      const changed = await saveCategoryRecipientLinks(tx, listId, before.recipientUserIds, ids);
      const email = await saveReminderEmailLinks(tx, { listId }, emails, previous.emailRecipients);
      if (changed || email.changed || previous.includeCategoryRecipients !== includeCategoryRecipients) {
        await tx.notificationReminderList.update({ where: { id: listId }, data: { includeCategoryRecipients } });
        await pauseQueuedReminderEmails(tx, { listId });
        await audit(tx, actor.id, "NotificationReminderList", listId, "SAVE_CATEGORY_RECIPIENTS", {
          listId, before: { ...before, includeCategoryRecipients: previous.includeCategoryRecipients },
          after: { recipientUserIds: ids, emailContactIds: email.contactIds, includeCategoryRecipients },
        });
      }
    }, { maxWait: 10_000, timeout: 30_000 });
  } catch (caught) { error = failure(caught); }
  if (error) returnTo(form, listId, { error });
  refresh();
  returnTo(form, listId, { saved: "Category recipients saved." });
}

export async function saveReminderListAction(form: FormData) {
  const actor = await requireReminderManager();
  let listId = text(form, "listId");
  let error: string | undefined;
  try {
    const name = nameField(form);
    const description = text(form, "description");
    if (description.length > 2000) throw new ReminderInputError("Use a section description of at most 2000 characters.");
    const rawOrder = text(form, "sortOrder");
    const sortOrder = rawOrder ? Number(rawOrder) : 1000;
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10_000) throw new ReminderInputError("Display order must be a whole number from 0 to 10000.");
    const defaultIntervalMonths = inputMonths(text(form, "defaultIntervalMonths"))!;
    const submittedActive = bool(form, "active");
    const submittedRecipients = recipientIds(form, "recipientIds");
    const emails = readReminderEmailRecipients(form);
    listId = await prisma.$transaction(async (tx) => {
      if (listId) await lockNotificationReminderList(tx, listId);
      const previous = listId ? await tx.notificationReminderList.findUnique({ where: { id: listId }, include: routingInclude }) : null;
      if (listId && !previous) throw new ReminderInputError("This reminder list no longer exists.");
      const previousIds = previous?.recipients.map(({ userId }) => userId) ?? [];
      const keepRecipients = previous && bool(form, "keepCategoryRecipients");
      const selectedRecipients = keepRecipients ? previousIds : submittedRecipients;
      if (!keepRecipients && !previous?.complianceKind && !selectedRecipients.length && !(emails?.length ?? previous?.emailRecipients.length)) throw new ReminderInputError("Choose an app user or add an email address for this category.");
      // Pausing/resuming is an explicit action; a stale settings form cannot
      // silently undo another manager's pause.
      const active = previous?.active ?? submittedActive;
      const includeCategoryRecipients = previous?.includeCategoryRecipients ?? bool(form, "includeCategoryRecipients");
      const saved = previous ? await tx.notificationReminderList.update({
        where: { id: previous.id }, data: { name, description: description || null, sortOrder, defaultIntervalMonths, active },
      }) : await tx.notificationReminderList.create({ data: { name, description: description || null, sortOrder, defaultIntervalMonths, includeCategoryRecipients, active, createdByUserId: actor.id } });
      const recipientsChanged = !keepRecipients && await saveCategoryRecipientLinks(tx, saved.id, previousIds, selectedRecipients);
      const email = await saveReminderEmailLinks(tx, { listId: saved.id }, keepRecipients ? undefined : emails, previous?.emailRecipients);
      if (!previous) {
        const locations = await tx.location.findMany({ where: { active: true }, select: { id: true } });
        await tx.notificationReminderLocation.createMany({ data: locations.map((location) => ({ listId: saved.id, locationId: location.id })), skipDuplicates: true });
      }
      const recomputed: Prisma.InputJsonValue[] = [];
      const intervalChanged = previous && previous.defaultIntervalMonths !== defaultIntervalMonths;
      if (previous && !previous.complianceKind && intervalChanged) {
        const inherited = await tx.notificationReminderLocation.findMany({ where: { listId: saved.id, intervalMonths: null, referenceOn: { not: null } } });
        for (const row of inherited) {
          const nextDueOn = firstDue(row.referenceOn, defaultIntervalMonths);
          await tx.notificationReminderLocation.update({ where: { id: row.id }, data: { nextDueOn } });
          recomputed.push({ reminderLocationId: row.id, locationId: row.locationId, referenceOn: formatReminderDate(row.referenceOn!), previousDueOn: row.nextDueOn ? formatReminderDate(row.nextDueOn) : null, nextDueOn: nextDueOn ? formatReminderDate(nextDueOn) : null });
        }
      }
      if (previous && (!active || recipientsChanged || email.changed || intervalChanged)) await pauseQueuedReminderEmails(tx, { listId: saved.id });
      await audit(tx, actor.id, "NotificationReminderList", saved.id, previous ? "UPDATE_LIST" : "CREATE_LIST", {
        listId: saved.id,
        before: previous ? { name: previous.name, description: previous.description, sortOrder: previous.sortOrder, defaultIntervalMonths: previous.defaultIntervalMonths, active: previous.active, includeCategoryRecipients: previous.includeCategoryRecipients, ...links(previous) } : null,
        after: { name, description: description || null, sortOrder, defaultIntervalMonths, active, recipientUserIds: selectedRecipients, emailContactIds: email.contactIds, includeCategoryRecipients },
        recomputed,
      });
      return saved.id;
    }, { maxWait: 10_000, timeout: 30_000 });
  } catch (caught) { error = failure(caught); }
  if (error) returnTo(form, listId, { error });
  refresh();
  returnTo(form, listId, { saved: "Compliance section saved." });
}

export async function saveReminderLocationAction(form: FormData) {
  const actor = await requireReminderManager();
  const listId = text(form, "listId");
  let error: string | undefined;
  try {
    const locationId = text(form, "locationId");
    const reminderLocationId = text(form, "reminderLocationId");
    const companyId = text(form, "companyId") || null;
    const intervalMonths = inputMonths(text(form, "intervalMonths"), true);
    const rawDate = text(form, "referenceOn");
    const referenceOn = rawDate ? parseReminderDate(rawDate) : null;
    if (rawDate && (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || !referenceOn)) throw new ReminderInputError("Enter a valid date or leave the date blank to pause this location.");
    const submittedHidden = bool(form, "hidden");
    const useLocationRecipients = bool(form, "useLocationRecipients");
    const selectedRecipients = recipientIds(form, "locationRecipientIds");
    const emails = readReminderEmailRecipients(form);
    await prisma.$transaction(async (tx) => {
      await lockNotificationReminderList(tx, listId);
      const list = await tx.notificationReminderList.findUnique({ where: { id: listId } });
      if (!list) throw new ReminderInputError("This reminder list no longer exists.");
      if (list.complianceKind) throw new ReminderInputError("Use the compliance service form for this section.");
      const location = await tx.location.findFirst({ where: { id: locationId, active: true }, select: { id: true } });
      if (!location) throw new ReminderInputError("Choose an active location.");
      if (companyId && !await tx.reminderCompany.findFirst({ where: { id: companyId, active: true }, select: { id: true } })) throw new ReminderInputError("Choose an active company.");
      const previous = await tx.notificationReminderLocation.findUnique({ where: { listId_locationId: { listId, locationId } }, include: routingInclude });
      if (reminderLocationId && previous?.id !== reminderLocationId) throw new ReminderInputError("This row no longer matches the selected list and location. Refresh and try again.");
      // Visibility has its own action. Saving a stale row must not unpause it.
      const hidden = previous?.hidden ?? submittedHidden;
      const changedSchedule = !previous || previous.referenceOn?.getTime() !== referenceOn?.getTime() || previous.intervalMonths !== intervalMonths;
      const nextDueOn = changedSchedule ? firstDue(referenceOn, intervalMonths ?? list.defaultIntervalMonths) : previous.nextDueOn;
      const saved = await tx.notificationReminderLocation.upsert({
        where: { listId_locationId: { listId, locationId } },
        create: { listId, locationId, companyId, referenceOn, nextDueOn, intervalMonths, hidden, useLocationRecipients },
        update: { companyId, referenceOn, nextDueOn, intervalMonths, hidden, useLocationRecipients },
      });
      const routing = await saveLocationRecipients(tx, saved.id, useLocationRecipients, selectedRecipients, emails, previous);
      if (saved.hidden || !referenceOn || !list.active || changedSchedule || routing.changed) await pauseQueuedReminderEmails(tx, { listId, reminderLocationId: saved.id });
      const snapshot = (row: typeof saved) => ({ companyId: row.companyId, referenceOn: row.referenceOn ? formatReminderDate(row.referenceOn) : null, nextDueOn: row.nextDueOn ? formatReminderDate(row.nextDueOn) : null, intervalMonths: row.intervalMonths, hidden: row.hidden, useLocationRecipients: row.useLocationRecipients });
      const locationAudit = await audit(tx, actor.id, "NotificationReminderLocation", saved.id, "SAVE_LOCATION", { listId, locationId, before: previous ? { ...snapshot(previous), ...links(previous) } : null, after: { ...snapshot(saved), recipientUserIds: useLocationRecipients ? selectedRecipients : [], emailContactIds: routing.contactIds } });
      // Compatibility writer: recipient/visibility-only changes are not service events.
      if (changedSchedule || previous?.companyId !== companyId) {
        const candidates = await tx.complianceServiceEntry.findMany({where: {reminderLocationId: saved.id, supersededBy: null}});
        const prior = latestComplianceRecords(candidates)[0];
        const company = companyId ? await tx.reminderCompany.findUnique({where: {id: companyId}, select: {name: true}}) : null;
        if (referenceOn || prior) await tx.complianceServiceEntry.create({data: {
          reminderLocationId: saved.id, sourceAuditLogId: locationAudit.id, supersedesEntryId: prior?.id,
          recordedByUserId: actor.id, companyId, companyName: company?.name ?? null,
          serviceDate: referenceOn ? formatReminderDate(referenceOn) : "", recordYear: referenceOn?.getUTCFullYear() ?? new Date().getFullYear(),
          intervalMonths: intervalMonths ?? list.defaultIntervalMonths, intervalOverrideMonths: intervalMonths,
          intervalText: intervalMonths?.toString() ?? null, source: "CUSTOM_EDIT",
          cost: prior?.cost ?? null, notes: prior?.notes ?? null,
        }});
      }
    }, { maxWait: 10_000, timeout: 30_000 });
  } catch (caught) { error = failure(caught); }
  if (error) returnTo(form, listId, { error });
  refresh();
  returnTo(form, listId, { saved: "Location reminder saved." });
}

export async function setReminderLocationHiddenAction(form: FormData) {
  const actor = await requireReminderManager();
  const listId = text(form, "listId");
  const id = text(form, "reminderLocationId");
  const hidden = bool(form, "hidden");
  let error: string | undefined;
  try {
    await prisma.$transaction(async (tx) => {
      await lockNotificationReminderList(tx, listId);
      let row = id ? await tx.notificationReminderLocation.findFirst({ where: { id, listId } }) : null;
      if (!row && !id) {
        const locationId = text(form, "locationId");
        const [list, location] = await Promise.all([
          tx.notificationReminderList.findUnique({ where: { id: listId }, select: { id: true } }),
          tx.location.findFirst({ where: { id: locationId, active: true }, select: { id: true } }),
        ]);
        if (!list || !location) throw new ReminderInputError("Choose an active section location.");
        row = await tx.notificationReminderLocation.upsert({ where: { listId_locationId: { listId, locationId } }, create: { listId, locationId }, update: {} });
      }
      if (!row) throw new ReminderInputError("This reminder row no longer exists.");
      await tx.notificationReminderLocation.update({ where: { id: row.id }, data: { hidden } });
      if (hidden) await pauseQueuedReminderEmails(tx, { listId, reminderLocationId: row.id });
      await audit(tx, actor.id, "NotificationReminderLocation", row.id, hidden ? "HIDE_LOCATION" : "SHOW_LOCATION", { listId, locationId: row.locationId, before: { hidden: row.hidden }, after: { hidden } });
    });
  } catch (caught) { error = failure(caught); }
  if (error) returnTo(form, listId, { error });
  refresh();
  returnTo(form, listId, { saved: hidden ? "Location hidden and reminders paused." : "Location shown and reminders resumed." });
}

export async function saveComplianceLocationAction(form: FormData) {
  const actor = await requireReminderManager();
  const listId = text(form, "listId");
  let error: string | undefined;
  try {
    const locationId = text(form, "locationId");
    const expectedId = text(form, "reminderLocationId");
    const year = Number(text(form, "year"));
    if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new ReminderInputError("Choose a compliance year from 2020 to 2100.");
    const useLocationRecipients = bool(form, "useLocationRecipients");
    const selectedRecipients = recipientIds(form, "locationRecipientIds");
    const emails = readReminderEmailRecipients(form);
    await prisma.$transaction(async (tx) => {
      await lockNotificationReminderList(tx, listId);
      const list = await tx.notificationReminderList.findUnique({ where: { id: listId } });
      if (!list?.complianceKind) throw new ReminderInputError("Choose an existing compliance service section.");
      if (!await tx.location.findFirst({ where: { id: locationId, active: true }, select: { id: true } })) throw new ReminderInputError("Choose an active location.");
      const previous = await tx.notificationReminderLocation.findUnique({ where: { listId_locationId: { listId, locationId } }, include: routingInclude });
      if (expectedId && previous?.id !== expectedId) throw new ReminderInputError("This compliance row has changed. Refresh and try again.");
      const parsed = submittedComplianceValues(form, list.complianceKind);
      if (parsed.error) throw new ReminderInputError(parsed.error);
      const companyField = list.complianceKind === "GREASE_TRAP" ? "greaseTrapCompany" : list.complianceKind === "BACKFLOW" ? "backflowCompany" : "boilerInspectionCompany";
      const companyLinkField = list.complianceKind === "GREASE_TRAP" ? "greaseTrapCompanyId" : list.complianceKind === "BACKFLOW" ? "backflowCompanyId" : "boilerInspectionCompanyId";
      const companyIds: Partial<Record<typeof companyLinkField, string | null>> = {};
      if (form.has(companyField)) {
        const name = parsed.values[companyField]?.replace(/\s+/g, " ").trim() ?? "";
        if (name.length > 160) throw new ReminderInputError("Use a company name of at most 160 characters.");
        const company = name ? await tx.reminderCompany.upsert({
          where: { normalizedName: name.normalize("NFKC").toLocaleLowerCase("en-US") },
          create: { name, normalizedName: name.normalize("NFKC").toLocaleLowerCase("en-US") }, update: {},
        }) : null;
        companyIds[companyLinkField] = company?.id ?? null;
      }
      const saved = await tx.notificationReminderLocation.upsert({
        where: { listId_locationId: { listId, locationId } },
        create: { listId, locationId, useLocationRecipients }, update: { useLocationRecipients },
      });
      const routing = await saveLocationRecipients(tx, saved.id, useLocationRecipients, selectedRecipients, emails, previous);
      const service = await savePreventativeMaintenanceEntryWithAudit({ locationId, year, values: parsed.values, actorUserId: actor.id, source: "ADMIN" }, { tx, companyIds });
      if (service.hadChanges || routing.changed || saved.hidden || !list.active) await pauseQueuedReminderEmails(tx, { listId, reminderLocationId: saved.id });
      await audit(tx, actor.id, "NotificationReminderLocation", saved.id, "SAVE_COMPLIANCE_LOCATION", {
        listId, locationId, year, preventativeMaintenanceEntryId: service.saved.id,
        before: previous ? { useLocationRecipients: previous.useLocationRecipients, ...links(previous) } : null,
        after: { useLocationRecipients, recipientUserIds: useLocationRecipients ? selectedRecipients : [], emailContactIds: routing.contactIds, hidden: saved.hidden },
      });
    }, { maxWait: 10_000, timeout: 30_000 });
  } catch (caught) { error = failure(caught); }
  if (error) returnTo(form, listId, { error });
  refresh();
  returnTo(form, listId, { saved: "Compliance service and recipients saved." });
}

export async function setReminderListActiveAction(form: FormData) {
  const actor = await requireReminderManager();
  const listId = text(form, "listId");
  const active = bool(form, "active");
  let error: string | undefined;
  try {
    await prisma.$transaction(async (tx) => {
      await lockNotificationReminderList(tx, listId);
      const previous = await tx.notificationReminderList.findUnique({ where: { id: listId } });
      if (!previous) throw new ReminderInputError("This reminder list no longer exists.");
      await tx.notificationReminderList.update({ where: { id: listId }, data: { active } });
      if (!active) await pauseQueuedReminderEmails(tx, { listId });
      await audit(tx, actor.id, "NotificationReminderList", listId, active ? "RESUME_LIST" : "PAUSE_LIST", { listId, before: { active: previous.active }, after: { active } });
    });
  } catch (caught) { error = failure(caught); }
  if (error) returnTo(form, listId, { error });
  refresh();
  returnTo(form, listId, { saved: active ? "Reminder list resumed." : "Reminder list paused." });
}

export async function saveReminderCompanyAction(form: FormData) {
  const actor = await requireReminderManager();
  const listId = text(form, "listId");
  let error: string | undefined;
  try {
    const name = nameField(form);
    const normalizedName = name.normalize("NFKC").toLocaleLowerCase("en-US");
    await prisma.$transaction(async (tx) => {
      const company = await tx.reminderCompany.upsert({ where: { normalizedName }, create: { name, normalizedName }, update: {} });
      await audit(tx, actor.id, "ReminderCompany", company.id, "ENSURE_COMPANY", { companyId: company.id, name: company.name, normalizedName });
    });
  } catch (caught) { error = failure(caught); }
  if (error) returnTo(form, listId, { error });
  refresh();
  returnTo(form, listId, { saved: "Company added to the company selector." });
}
