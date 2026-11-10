import type { NotificationEmailKind, NotificationEmailStatus } from "@prisma/client";
import { isSystemAdminRoleName } from "@/app/lib/system-admin-role";

export type NotificationObserverIdentity = {
  id: string;
  active: boolean;
  role: string;
  notificationEmailEnabled: boolean;
  roles: { role: { name: string; isSystem: boolean } }[];
};

export function isNotificationOversightAdministrator(user: NotificationObserverIdentity): boolean {
  return user.active && (user.role === "ADMIN" || user.roles.some((assignment) => assignment.role.isSystem && isSystemAdminRoleName(assignment.role.name)));
}

export function notificationEmailRecipientPlan(primary: { id: string; notificationEmailEnabled: boolean }, observers: NotificationObserverIdentity[]) {
  const plan: Array<{ recipientUserId: string; kind: NotificationEmailKind; status: NotificationEmailStatus }> = [
    { recipientUserId: primary.id, kind: "PRIMARY", status: primary.notificationEmailEnabled ? "PENDING" : "SKIPPED" },
  ];
  const ids = new Set([primary.id]);
  for (const observer of observers) {
    if (ids.has(observer.id) || !isNotificationOversightAdministrator(observer)) continue;
    ids.add(observer.id);
    plan.push({ recipientUserId: observer.id, kind: "OVERSIGHT", status: observer.notificationEmailEnabled ? "PENDING" : "SKIPPED" });
  }
  return plan;
}
