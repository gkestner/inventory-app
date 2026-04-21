import { prisma } from "@/app/lib/prisma";
import type { Permission } from "@prisma/client";
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
  notification?: {
    findMany: (args?: AnyRecord) => Promise<any[]>;
    create: (args: AnyRecord) => Promise<any>;
    updateMany: (args: AnyRecord) => Promise<any>;
    delete: (args: AnyRecord) => Promise<any>;
    deleteMany: (args: AnyRecord) => Promise<any>;
  };
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
}) {
  const db = getCompatDb();
  if (!db.notification?.create) return;

  const recipientIds = await resolveNotificationRecipients(args.userIds, args.requiredPermission);
  if (recipientIds.length === 0) return;

  for (const userId of recipientIds) {
    await db.notification.create({
      data: {
        userId,
        title: args.title,
        body: args.body ?? null,
        href: args.href ?? null,
        type: args.type ?? "SYSTEM",
      },
    });
  }

  await maybeSendEmail(args).catch(() => {
    // Keep notification creation resilient even if SMTP config is missing.
  });
}

async function resolveNotificationRecipients(userIds: string[], requiredPermission?: Permission): Promise<string[]> {
  const db = getCompatDb();
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

async function maybeSendEmail(args: { title: string; body?: string }) {
  const host = process.env.SMTP_HOST?.trim();
  const port = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim() || "Maintenance@PizzaPlusInc.com";

  if (!host || !port || !user || !pass) {
    return;
  }

  // Placeholder integration point. SMTP credentials are accepted and reserved;
  // transport wiring can be switched to any provider without changing callers.
  console.log(`[notify-email] from=${from} host=${host}:${port} subject=${args.title} body=${args.body ?? ""}`);
}

export function getGcsConfig() {
  return {
    projectId: process.env.GCS_PROJECT_ID?.trim() || "",
    bucket: process.env.GCS_BUCKET?.trim() || "",
    basePath: process.env.GCS_BASE_PATH?.trim() || "work-order-attachments/",
  };
}
