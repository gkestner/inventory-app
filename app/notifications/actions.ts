"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { getNotificationTargetHref, notificationInboxHref, notificationMutation, parseInboxFilters } from "@/app/lib/notification-inbox";

export async function requireNotificationUser() {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  const email = session?.user?.email?.trim().toLowerCase();
  if (!id && !email) redirect("/login");
  const user = await prisma.user.findUnique({
    where: id ? { id } : { email: email! },
    select: { id: true, email: true, role: true, active: true, notificationEmailEnabled: true },
  });
  if (!user?.active) redirect("/login");
  return user;
}

function returnHref(formData: FormData) {
  return notificationInboxHref(parseInboxFilters({
    view: String(formData.get("view") ?? ""),
    q: String(formData.get("q") ?? ""),
    type: String(formData.get("type") ?? ""),
    page: String(formData.get("page") ?? ""),
  }));
}

export async function updateNotificationsAction(formData: FormData) {
  const user = await requireNotificationUser();
  const [operation, singleId] = String(formData.get("operation") ?? "").split(":", 2);
  const ids = singleId ? [singleId] : formData.getAll("notificationIds").map(String);
  if (operation === "open" && singleId) {
    const row = await prisma.notification.findFirst({ where: { id: singleId, userId: user.id, deletedAt: null }, select: { href: true } });
    if (row) {
      await prisma.notification.updateMany({ where: { id: singleId, userId: user.id, readAt: null, deletedAt: null }, data: { readAt: new Date() } });
      revalidatePath("/", "layout");
      redirect(getNotificationTargetHref(row.href) ?? returnHref(formData));
    }
  } else {
    const mutation = notificationMutation(user.id, operation, ids);
    if (mutation) await prisma.notification.updateMany(mutation);
  }
  revalidatePath("/", "layout");
  redirect(returnHref(formData));
}

export async function saveNotificationEmailPreference(formData: FormData) {
  const user = await requireNotificationUser();
  await prisma.user.update({ where: { id: user.id }, data: { notificationEmailEnabled: formData.get("emailEnabled") === "on" } });
  revalidatePath("/notifications");
  redirect(`${returnHref(formData)}${returnHref(formData).includes("?") ? "&" : "?"}saved=1`);
}
