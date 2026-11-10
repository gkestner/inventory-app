import Link from "next/link";
import { prisma } from "@/app/lib/prisma";
import { getNotificationEmailConfiguration } from "@/app/lib/notification-email";
import { unreadNotificationWhere } from "@/app/lib/notification-counts";
import { loadUserPermissions, hasAnyPermission } from "@/app/lib/permissions";
import { ADMIN_VIEW_PREVENTATIVE_MAINTENANCE } from "@/app/lib/permission-constants";
import { getNotificationOversightState } from "@/app/lib/notification-oversight";
import { saveNotificationOversightPreference } from "./oversight-actions";
import { NOTIFICATION_PAGE_SIZE, NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABELS, notificationInboxHref, notificationInboxWhere, parseInboxFilters } from "@/app/lib/notification-inbox";
import { requireNotificationUser, saveNotificationEmailPreference, updateNotificationsAction } from "./actions";
import NotificationList from "./NotificationList";
import styles from "./notifications.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireNotificationUser();
  const permissions = await loadUserPermissions({ user });
  const canManageReminders = permissions.allowAll || hasAnyPermission(permissions, [ADMIN_VIEW_PREVENTATIVE_MAINTENANCE]);
  const params = await searchParams;
  const filters = parseInboxFilters(params);
  const where = notificationInboxWhere(user.id, filters);
  const [inbox, unread, archived, trash, total] = await Promise.all([
    prisma.notification.count({ where: { userId: user.id, archivedAt: null, deletedAt: null } }),
    prisma.notification.count({ where: unreadNotificationWhere(user.id) }),
    prisma.notification.count({ where: { userId: user.id, archivedAt: { not: null }, deletedAt: null } }),
    prisma.notification.count({ where: { userId: user.id, deletedAt: { not: null } } }),
    prisma.notification.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / NOTIFICATION_PAGE_SIZE));
  filters.page = Math.min(filters.page, pages);
  const rows = await prisma.notification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (filters.page - 1) * NOTIFICATION_PAGE_SIZE, take: NOTIFICATION_PAGE_SIZE, include: { emailDeliveries: { where: { kind: "PRIMARY" }, take: 1, select: { status: true } } } });
  const oversight = await getNotificationOversightState(user.id);
  const emailConfigured = getNotificationEmailConfiguration().configured;
  const tabs = [
    { view: "inbox", label: "Inbox", count: inbox },
    { view: "unread", label: "Unread", count: unread },
    { view: "archived", label: "Archive", count: archived },
    { view: "trash", label: "Trash", count: trash },
  ] as const;
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>YOUR WORKSPACE</p>
            <h1>Notifications <span className={styles.unreadBadge}>{unread} unread</span></h1>
            <p className={styles.muted}>Keep track of alerts, assignments, and workflow updates.</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {canManageReminders && <Link href="/admin/preventative-maintenance/compliance" className={styles.button}>Compliance &amp; Testing</Link>}
            <Link href="/dashboard" className={styles.button}>Back to dashboard</Link>
          </div>
        </header>
        <details className={styles.preferences}>
          <summary>Email preferences <span className={styles.muted}>{!emailConfigured ? "Email setup pending" : user.notificationEmailEnabled ? "Email copies enabled" : "Email copies paused"}</span></summary>
          <form action={saveNotificationEmailPreference} className={styles.preferenceForm}>
            <FilterFields filters={filters} />
            <label className={styles.checkboxLabel}><input type="checkbox" name="emailEnabled" defaultChecked={user.notificationEmailEnabled} /><span>Email me a copy of each new notification</span></label>
            <p className={styles.muted}>Copies include the same title, details, and a link to the related item. Sent to <strong>{user.email}</strong>.</p>
            {!emailConfigured && <p className={styles.notice}>Email delivery is awaiting administrator setup. Your in-app notifications will continue to arrive.</p>}
            <button type="submit" className={styles.button}>Save preferences</button>
          </form>
        </details>
        {oversight.eligible && <details className={styles.preferences}>
          <summary>Copies of other users’ notifications <span className={styles.muted}>{oversight.enabled && oversight.emailEnabled ? "Enabled" : "Paused"}</span></summary>
          <form action={saveNotificationOversightPreference} className={styles.preferenceForm}>
            <label className={styles.checkboxLabel}><input type="checkbox" name="oversightEnabled" defaultChecked={oversight.enabled} /><span>Email me the details of notifications sent to other users</span></label>
            <p className={styles.muted}>Private copies go to <strong>{user.email}</strong> and include the actual recipient, notification title, and full details. You receive one copy for each recipient, without duplicate copies of your own notifications.</p>
            {!oversight.emailEnabled && <p className={styles.notice}>Your personal email copies are paused. Enable them in Email preferences to receive these copies.</p>}
            <button type="submit" className={styles.button}>Save notification copy settings</button>
          </form>
        </details>}
        {params.oversightSaved === "1" && <p role="status" className={styles.notice}>Notification copy settings saved.</p>}
        {params.saved === "1" && <p role="status" className={styles.notice}>Email preferences saved.</p>}
        <section className={styles.panel} aria-label="Notification inbox">
          <nav className={styles.tabs} aria-label="Notification folders">
            {tabs.map((tab) => <Link key={tab.view} href={notificationInboxHref(filters, { view: tab.view, page: 1 })} className={`${styles.tab} ${filters.view === tab.view ? styles.activeTab : ""}`} aria-current={filters.view === tab.view ? "page" : undefined}>{tab.label} <span>{tab.count}</span></Link>)}
          </nav>
          <form key={`${filters.view}:${filters.q}:${filters.type}`} method="get" className={styles.filters}>
            <input type="hidden" name="view" value={filters.view} />
            <label className={styles.searchLabel}>Search notifications<input name="q" type="search" maxLength={200} defaultValue={filters.q} placeholder="Search titles and details…" /></label>
            <label>Category<select name="type" defaultValue={filters.type}><option value="">All categories</option>{NOTIFICATION_TYPES.map((type) => <option key={type} value={type}>{NOTIFICATION_TYPE_LABELS[type]}</option>)}</select></label>
            <button type="submit" className={styles.button}>Apply</button>
            {(filters.q || filters.type) && <Link href={notificationInboxHref({ ...filters, q: "", type: "", page: 1 })} className={styles.textButton}>Clear filters</Link>}
          </form>
          {(filters.view === "inbox" || filters.view === "unread") && <form action={updateNotificationsAction} className={styles.inboxActions}>
            <FilterFields filters={filters} />
            <button type="submit" name="operation" value="readAll" disabled={unread === 0} className={styles.textButton}>Mark entire inbox as read</button>
            <button type="submit" name="operation" value="archiveRead" disabled={inbox <= unread} className={styles.textButton}>Archive all read</button>
            <span className={styles.muted}>Applies to the entire inbox.</span>
          </form>}
          <NotificationList key={notificationInboxHref(filters)} filters={filters} action={updateNotificationsAction} rows={rows.map((row) => ({ id: row.id, title: row.title, body: row.body, href: row.href, type: row.type, readAt: row.readAt?.toISOString() ?? null, archivedAt: row.archivedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), emailedAt: row.emailedAt?.toISOString() ?? null, emailStatus: row.emailDeliveries[0]?.status ?? null }))} />
          <footer className={styles.pagination}>
            <span className={styles.muted}>{total === 0 ? "0 notifications" : `${(filters.page - 1) * NOTIFICATION_PAGE_SIZE + 1}–${Math.min(filters.page * NOTIFICATION_PAGE_SIZE, total)} of ${total} notifications`}</span>
            <div>{filters.page > 1 && <Link href={notificationInboxHref(filters, { page: filters.page - 1 })} className={styles.button}>Previous</Link>}<span>Page {filters.page} of {pages}</span>{filters.page < pages && <Link href={notificationInboxHref(filters, { page: filters.page + 1 })} className={styles.button}>Next</Link>}</div>
          </footer>
        </section>
        <p className={styles.footnote}>Archive keeps notifications for later. Trash is recoverable; restoring returns a notification to its previous folder. Email delivery and in-app read status are tracked separately.</p>
      </div>
    </main>
  );
}

function FilterFields({ filters }: { filters: ReturnType<typeof parseInboxFilters> }) {
  return <>{Object.entries(filters).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}</>;
}
