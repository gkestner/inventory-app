import { prisma } from "@/app/lib/prisma";

type AnyRecord = Record<string, unknown>;

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
  type?: "WORK_ORDER" | "SCHEDULER" | "CYCLE_COUNT" | "SYSTEM";
}) {
  const db = getCompatDb();
  if (!db.notification?.create) return;

  await db.notification.create({
    data: {
      userId: args.userId,
      title: args.title,
      body: args.body ?? null,
      href: args.href ?? null,
      type: args.type ?? "SYSTEM",
    },
  });

  await maybeSendEmail(args).catch(() => {
    // Keep notification creation resilient even if SMTP config is missing.
  });
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
