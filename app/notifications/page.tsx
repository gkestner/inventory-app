import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { getCompatDb } from "@/app/lib/workflow-foundations";

export const dynamic = "force-dynamic";

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

export default async function NotificationsPage() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");

  const email = (session.user?.email ?? "").trim().toLowerCase();
  if (!email) redirect("/login");

  const user = await (getCompatDb() as any).user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user?.id) redirect("/login");

  async function markAllReadAction() {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    if (!session) redirect("/login");

    const email = (session.user?.email ?? "").trim().toLowerCase();
    const me = await (getCompatDb() as any).user.findUnique({ where: { email }, select: { id: true } });
    if (!me?.id) redirect("/login");

    const db = getCompatDb();
    if (db.notification?.updateMany) {
      await db.notification.updateMany({
        where: { userId: me.id, readAt: null },
        data: { readAt: new Date() },
      });
    }

    redirect("/notifications");
  }

  async function markOneReadAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    if (!session) redirect("/login");

    const email = (session.user?.email ?? "").trim().toLowerCase();
    const me = await (getCompatDb() as any).user.findUnique({ where: { email }, select: { id: true } });
    if (!me?.id) redirect("/login");

    const notificationId = String(formData.get("notificationId") ?? "").trim();
    if (!notificationId) redirect("/notifications");

    const db = getCompatDb();
    if (db.notification?.updateMany) {
      await db.notification.updateMany({
        where: { id: notificationId, userId: me.id, readAt: null },
        data: { readAt: new Date() },
      });
    }

    redirect("/notifications");
  }

  const db = getCompatDb();
  const rows = db.notification?.findMany
    ? await db.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 200,
      })
    : [];

  const unread = rows.filter((r) => !r.readAt).length;

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Notifications</h1>
          <span style={{ opacity: 0.8, fontSize: 13 }}>{unread} unread</span>
          <form action={markAllReadAction}>
            <button
              type="submit"
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Mark all read
            </button>
          </form>
          <Link href="/" style={{ marginLeft: "auto", textDecoration: "none", fontWeight: 800 }}>
            Back
          </Link>
        </div>

        <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)" }}>
          {rows.map((n) => (
            <div
              key={n.id}
              style={{
                borderTop: "1px solid var(--border)",
                padding: 12,
                background: n.readAt ? "transparent" : "color-mix(in srgb, var(--brand) 8%, transparent)",
              }}
            >
              <div style={{ fontWeight: 900 }}>{n.title}</div>
              {n.body ? <div style={{ marginTop: 4, opacity: 0.9 }}>{n.body}</div> : null}
              <div style={{ marginTop: 6, display: "flex", gap: 10, fontSize: 12, opacity: 0.75 }}>
                <span>{new Date(n.createdAt).toLocaleString()}</span>
                {n.href ? (
                  <Link href={n.href} style={{ textDecoration: "underline" }}>
                    Open
                  </Link>
                ) : null}
                {!n.readAt ? (
                  <form action={markOneReadAction}>
                    <input type="hidden" name="notificationId" value={n.id} />
                    <button
                      type="submit"
                      style={{
                        padding: "4px 8px",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--surface)",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Mark as read
                    </button>
                  </form>
                ) : (
                  <span>Read</span>
                )}
              </div>
            </div>
          ))}

          {rows.length === 0 ? (
            <div style={{ padding: 14, opacity: 0.8 }}>No notifications yet.</div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
