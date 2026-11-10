import { prisma } from "@/app/lib/prisma";
import { scheduleNotificationEmails } from "@/app/lib/notification-email";
import { loadNotificationOversightRecipients } from "@/app/lib/notification-oversight";
import { notificationEmailRecipientPlan } from "@/app/lib/notification-oversight-rules";
import { Prisma, type Permission, type PrismaClient } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import {
  RECEIVE_NOTIFICATION_CYCLE_COUNTS,
  RECEIVE_NOTIFICATION_MAINTENANCE_REQUESTS,
  RECEIVE_NOTIFICATION_TEMPERATURE_ALERTS,
  RECEIVE_NOTIFICATION_WORK_ORDER_SCHEDULES,
} from "@/app/lib/permission-constants";

type AnyRecord = Record<string, unknown>;

type VacationRoutingPreference = {
  enabled: boolean;
  forwardToUserIds: string[];
};

export type CompatDb = {
  pmSchedule?: {
    findMany: (args?: AnyRecord) => Promise<any[]>;
    create: (args: AnyRecord) => Promise<any>;
    update: (args: AnyRecord) => Promise<any>;
    delete: (args: AnyRecord) => Promise<any>;
  };
  auditLog?: {
    findMany: (args?: AnyRecord) => Promise<any[]>;
    create: (args: AnyRecord) => Promise<any>;
  };
  savedView?: {
    findMany: (args?: AnyRecord) => Promise<any[]>;
    create: (args: AnyRecord) => Promise<any>;
    delete: (args: AnyRecord) => Promise<any>;
  };
  notification?: Pick<PrismaClient["notification"], "findMany" | "create" | "updateMany" | "delete" | "deleteMany">;
  user?: {
    findMany: (args?: AnyRecord) => Promise<Array<{ id: string; active: boolean; uiPreferences: unknown }>>;
  };
  workOrderAttachment?: {
    findMany: (args?: AnyRecord) => Promise<any[]>;
    create: (args: AnyRecord) => Promise<any>;
  };
  cycleCountSession?: {
    findMany: (args?: AnyRecord) => Promise<any[]>;
    create: (args: AnyRecord) => Promise<any>;
    update: (args: AnyRecord) => Promise<any>;
  };
  cycleCountItem?: {
    findMany: (args?: AnyRecord) => Promise<any[]>;
    upsert: (args: AnyRecord) => Promise<any>;
  };
};

export function getCompatDb(): CompatDb {
  return prisma as unknown as CompatDb;
}

export async function createAuditLog(args: {
  actorUserId?: string | null;
  module: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  workOrderId?: string | null;
  message?: string | null;
  metadata?: unknown;
}) {
  const db = getCompatDb();
  if (!db.auditLog?.create) return;

  await db.auditLog.create({
    data: {
      actorUserId: args.actorUserId ?? null,
      module: args.module,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId ?? null,
      workOrderId: args.workOrderId ?? null,
      message: args.message ?? null,
      metadata: (args.metadata ?? null) as any,
    },
  });
}

export async function createNotification(args: {
  userId: string;
  title: string;
  body?: string;
  href?: string;
  type?: "WORK_ORDER" | "SCHEDULER" | "CYCLE_COUNT" | "SYSTEM" | "TEMPERATURE_ALERT";
  requiredPermission?: Permission;
}) {
  await createNotificationForUsers({
    userIds: [args.userId],
    title: args.title,
    body: args.body,
    href: args.href,
    type: args.type,
    requiredPermission: args.requiredPermission,
  });
}

export async function createNotificationForUsers(args: {
  userIds: string[];
  title: string;
  body?: string;
  href?: string;
  type?: "WORK_ORDER" | "SCHEDULER" | "CYCLE_COUNT" | "SYSTEM" | "TEMPERATURE_ALERT";
  requiredPermission?: Permission;
  dedupeKey?: string;
  reminderOccurrenceId?: string;
  complianceReminderLocationId?: string;
}, options?: { tx?: Prisma.TransactionClient; scheduleEmails?: boolean }): Promise<string[]> {
  const db = options?.tx ?? prisma;
  if (!db.notification?.create) return [];

  const recipientIds = await resolveNotificationRecipients(args.userIds, args.requiredPermission, db);
  if (recipientIds.length === 0) return [];

  const preferences = await db.user.findMany({
    where: { id: { in: recipientIds } },
    select: { id: true, notificationEmailEnabled: true },
  });
  const emailEnabledById = new Map(preferences.map((user) => [user.id, user.notificationEmailEnabled]));
  const observers = await loadNotificationOversightRecipients(db);
  const notificationIds: string[] = [];
  for (const userId of recipientIds) {
    // Transactional reminder callers hold their section/list lock. Check a
    // previous cycle before inserting so a duplicate does not abort their tx.
    if (options?.tx && args.dedupeKey) {
      const existing = await db.notification.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey: args.dedupeKey } }, select: { id: true } });
      if (existing) continue;
    }
    try {
      const notification = await db.notification.create({
        data: {
          userId,
          title: args.title,
          body: args.body ?? null,
          href: args.href ?? null,
          type: args.type ?? "SYSTEM",
          dedupeKey: args.dedupeKey ?? null,
          reminderOccurrenceId: args.reminderOccurrenceId ?? null,
          complianceReminderLocationId: args.complianceReminderLocationId ?? null,
          // A notification and its outbox job always commit together.
          emailDeliveries: { create: notificationEmailRecipientPlan({ id: userId, notificationEmailEnabled: emailEnabledById.get(userId) !== false }, observers) },
        },
        select: { id: true },
      });
      notificationIds.push(notification.id);
    } catch (error) {
      // Standalone inserts are their own transactions. Do not swallow a unique
      // violation inside a caller's transaction, which PostgreSQL has aborted.
      if (!options?.tx && args.dedupeKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await db.notification.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey: args.dedupeKey } }, select: { id: true } });
        if (existing) continue;
      }
      throw error;
    }
  }

  if (options?.scheduleEmails !== false) scheduleNotificationEmails(notificationIds);
  return notificationIds;
}

async function resolveNotificationRecipients(userIds: string[], requiredPermission?: Permission, db: Pick<PrismaClient, "user"> = prisma): Promise<string[]> {
  const baseIds = Array.from(new Set(userIds.map((x) => String(x ?? "").trim()).filter(Boolean)));
  if (baseIds.length === 0) return [];

  const sourceUsers = db.user?.findMany
    ? await db.user.findMany({
        where: { id: { in: baseIds } },
        select: { id: true, active: true, uiPreferences: true },
      })
    : [];

  const sourceById = new Map(sourceUsers.map((u) => [u.id, u] as const));
  const candidateIds = new Set<string>();

  for (const baseId of baseIds) {
    const source = sourceById.get(baseId);
    if (source && !source.active) continue;

    const vacationRouting = parseVacationRoutingPreference(source?.uiPreferences);
    if (!vacationRouting.enabled || vacationRouting.forwardToUserIds.length === 0) {
      candidateIds.add(baseId);
      continue;
    }

    for (const userId of vacationRouting.forwardToUserIds) {
      if (userId !== baseId) candidateIds.add(userId);
    }
  }

  if (candidateIds.size === 0) return [];
  const candidateList = Array.from(candidateIds);

  const activeCandidates = db.user?.findMany
    ? await db.user.findMany({
        where: { id: { in: candidateList }, active: true },
        select: { id: true, active: true, uiPreferences: true },
      })
    : candidateList.map((id) => ({ id, active: true, uiPreferences: null }));

  const activeCandidateIds = new Set(activeCandidates.map((u) => u.id));
  const permitted: string[] = [];
  for (const userId of candidateList) {
    if (!activeCandidateIds.has(userId)) continue;
    if (await canUserReceiveNotification(userId, requiredPermission)) {
      permitted.push(userId);
    }
  }
  return permitted;
}

function parseVacationRoutingPreference(value: unknown): VacationRoutingPreference {
  const fallback: VacationRoutingPreference = { enabled: false, forwardToUserIds: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;

  const root = value as Record<string, unknown>;
  const notifications = root.notifications;
  if (!notifications || typeof notifications !== "object" || Array.isArray(notifications)) return fallback;

  const routingRaw = (notifications as Record<string, unknown>).vacationRouting;
  if (!routingRaw || typeof routingRaw !== "object" || Array.isArray(routingRaw)) return fallback;

  const routing = routingRaw as Record<string, unknown>;
  const enabled = routing.enabled === true;
  const rawUsers = Array.isArray(routing.forwardToUserIds) ? routing.forwardToUserIds : [];
  const forwardToUserIds = Array.from(
    new Set(
      rawUsers
        .map((x) => String(x ?? "").trim())
        .filter((x) => x.length > 0)
    )
  );

  return { enabled, forwardToUserIds };
}

const NOTIFICATION_GATE_PERMISSIONS: Permission[] = [
  RECEIVE_NOTIFICATION_MAINTENANCE_REQUESTS,
  RECEIVE_NOTIFICATION_TEMPERATURE_ALERTS,
  RECEIVE_NOTIFICATION_WORK_ORDER_SCHEDULES,
  RECEIVE_NOTIFICATION_CYCLE_COUNTS,
];

async function canUserReceiveNotification(userId: string, requiredPermission?: Permission): Promise<boolean> {
  if (!requiredPermission) return true;

  const perms = await loadUserPermissions({ user: { id: userId } });
  if (perms.allowAll) return true;

  // Backward compatibility: if no notification routing permissions are assigned,
  // continue delivering notifications as before.
  const hasAnyRoutingPreference = hasAnyPermission(perms, NOTIFICATION_GATE_PERMISSIONS);
  if (!hasAnyRoutingPreference) return true;

  return hasAnyPermission(perms, [requiredPermission]);
}

export function getGcsConfig() {
  return {
    projectId: process.env.GCS_PROJECT_ID?.trim() || "",
    bucket: process.env.GCS_BUCKET?.trim() || "",
    basePath: process.env.GCS_BASE_PATH?.trim() || "work-order-attachments/",
  };
}
