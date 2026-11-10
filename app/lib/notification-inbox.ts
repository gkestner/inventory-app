import type { Prisma } from "@prisma/client";
import { unreadNotificationWhere } from "./notification-counts";

export const NOTIFICATION_TYPES = ["WORK_ORDER", "SCHEDULER", "CYCLE_COUNT", "SYSTEM", "TEMPERATURE_ALERT"] as const;
export const NOTIFICATION_VIEWS = ["inbox", "unread", "archived", "trash"] as const;
export type NotificationView = typeof NOTIFICATION_VIEWS[number];
export type InboxFilters = {
  view: NotificationView;
  q: string;
  type: typeof NOTIFICATION_TYPES[number] | "";
  page: number;
};
export const NOTIFICATION_PAGE_SIZE = 25;

export function parseInboxFilters(params: Record<string, string | string[] | undefined>): InboxFilters {
  const scalar = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const rawView = scalar("view");
  const rawType = scalar("type");
  const rawPage = Number(scalar("page"));
  return {
    view: NOTIFICATION_VIEWS.includes(rawView as NotificationView) ? rawView as NotificationView : "inbox",
    q: scalar("q").trim().slice(0, 200),
    type: NOTIFICATION_TYPES.includes(rawType as typeof NOTIFICATION_TYPES[number]) ? rawType as typeof NOTIFICATION_TYPES[number] : "",
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100000) : 1,
  };
}

export function notificationInboxHref(filters: InboxFilters, overrides: Partial<InboxFilters> = {}): string {
  const value = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (value.view !== "inbox") params.set("view", value.view);
  if (value.q) params.set("q", value.q);
  if (value.type) params.set("type", value.type);
  if (value.page > 1) params.set("page", String(value.page));
  return `/notifications${params.size ? `?${params}` : ""}`;
}

export function notificationInboxWhere(userId: string, filters: InboxFilters): Prisma.NotificationWhereInput {
  return {
    userId,
    deletedAt: filters.view === "trash" ? { not: null } : null,
    ...(filters.view === "archived" ? { archivedAt: { not: null } } : {}),
    ...(filters.view === "inbox" || filters.view === "unread" ? { archivedAt: null } : {}),
    ...(filters.view === "unread" ? unreadNotificationWhere(userId) : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.q ? { OR: [
      { title: { contains: filters.q, mode: "insensitive" } },
      { body: { contains: filters.q, mode: "insensitive" } },
    ] } : {}),
  };
}

export type NotificationOperation = "read" | "unread" | "archive" | "unarchive" | "trash" | "restore" | "readAll" | "archiveRead";
const OPERATIONS: NotificationOperation[] = ["read", "unread", "archive", "unarchive", "trash", "restore", "readAll", "archiveRead"];

// All mutations retain ownership in the database predicate, including bulk requests.
export function notificationMutation(userId: string, operation: string, ids: string[], now = new Date()): {
  where: Prisma.NotificationWhereInput;
  data: Prisma.NotificationUpdateManyMutationInput;
} | null {
  if (!OPERATIONS.includes(operation as NotificationOperation)) return null;
  const all = operation === "readAll" || operation === "archiveRead";
  const safeIds = [...new Set(ids.filter((id) => id.length > 0 && id.length <= 128))].slice(0, NOTIFICATION_PAGE_SIZE);
  if (!all && safeIds.length === 0) return null;
  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(all ? { archivedAt: null } : { id: { in: safeIds } }),
    deletedAt: operation === "restore" ? { not: null } : null,
  };
  switch (operation) {
    case "read": case "readAll": return { where: { ...where, readAt: null }, data: { readAt: now } };
    case "unread": return { where, data: { readAt: null } };
    case "archive": return { where, data: { archivedAt: now } };
    case "unarchive": return { where, data: { archivedAt: null } };
    case "trash": return { where, data: { deletedAt: now } };
    // Restoring retains the previous folder and read state.
    case "restore": return { where, data: { deletedAt: null } };
    case "archiveRead": return { where: { ...where, readAt: { not: null } }, data: { archivedAt: now } };
    default: return null;
  }
}

export function getNotificationTargetHref(href: string | null | undefined): string | null {
  if (!href || !href.startsWith("/") || href.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(href)) return null;
  try {
    const decoded = decodeURIComponent(href);
    if (decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded)) return null;
    const url = new URL(href, "https://notification.invalid");
    if (url.origin !== "https://notification.invalid" || url.pathname.startsWith("//")) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export const NOTIFICATION_TYPE_LABELS: Record<typeof NOTIFICATION_TYPES[number], string> = {
  WORK_ORDER: "Work orders",
  SCHEDULER: "Schedules",
  CYCLE_COUNT: "Cycle counts",
  SYSTEM: "System",
  TEMPERATURE_ALERT: "Temperature alerts",
};
