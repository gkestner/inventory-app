/** The authoritative unread badge rule: only unread notifications in the inbox. */
export function unreadNotificationWhere(userId: string) {
  return { userId, readAt: null, archivedAt: null, deletedAt: null };
}

export type NotificationCursor = { id: string; createdAt: string } | null;

/** Compare creation cursors, never read/archive timestamps, to avoid false sounds. */
export function isNewerNotification(next: NotificationCursor, previous: NotificationCursor): boolean {
  if (!next) return false;
  const nextTime = Date.parse(next.createdAt);
  if (!Number.isFinite(nextTime)) return false;
  if (!previous) return true;
  const previousTime = Date.parse(previous.createdAt);
  if (!Number.isFinite(previousTime)) return false;
  return nextTime > previousTime || (nextTime === previousTime && next.id > previous.id);
}

export const NOTIFICATION_COUNT_EVENT = "notification-count-updated";
export type NotificationCountUpdate = { userId: string; unreadCount: number };
