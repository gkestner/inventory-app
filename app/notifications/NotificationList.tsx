"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { getNotificationTargetHref, NOTIFICATION_TYPE_LABELS, type InboxFilters, type NOTIFICATION_TYPES } from "@/app/lib/notification-inbox";
import styles from "./notifications.module.css";

type NotificationRow = {
  id: string; title: string; body: string | null; href: string | null;
  type: typeof NOTIFICATION_TYPES[number]; readAt: string | null;
  archivedAt: string | null; createdAt: string; emailedAt: string | null; emailStatus: string | null;
};
type Props = { rows: NotificationRow[]; filters: InboxFilters; action: (formData: FormData) => Promise<void> };

export default function NotificationList(props: Props) {
  return <form action={props.action}><ListContents {...props} /></form>;
}

function ListContents({ rows, filters }: Props) {
  const { pending } = useFormStatus();
  const [selected, setSelected] = useState<string[]>([]);
  const selectedRows = rows.filter((row) => selected.includes(row.id));
  const trash = filters.view === "trash";
  const toggle = (id: string) => setSelected((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]);
  const bulkButton = (operation: string, label: string) => <button className={styles.button} type="submit" name="operation" value={operation} disabled={pending || !selectedRows.length}>{label}</button>;
  return <>
    {Object.entries(filters).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
    <div className={styles.bulkToolbar}>
      <label className={styles.checkboxLabel}><input type="checkbox" checked={rows.length > 0 && selectedRows.length === rows.length} disabled={pending || rows.length === 0} onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.id) : [])} />Select page</label>
      <span className={styles.muted} role="status" aria-live="polite">{pending ? "Updating notifications…" : `${selectedRows.length} selected`}</span>
      {trash ? bulkButton("restore", "Restore selected") : <>{bulkButton("read", "Mark read")}{bulkButton("unread", "Mark unread")}{filters.view === "archived" ? bulkButton("unarchive", "Move to inbox") : bulkButton("archive", "Archive")}{bulkButton("trash", "Move to trash")}</>}
    </div>
    <div aria-busy={pending}>
      {rows.map((row) => <article key={row.id} className={`${styles.notification} ${!row.readAt && !trash ? styles.unread : ""}`}>
        <input type="checkbox" name="notificationIds" value={row.id} checked={selected.includes(row.id)} disabled={pending} onChange={() => toggle(row.id)} aria-label={`Select ${row.title}`} className={styles.rowCheckbox} />
        <div className={styles.notificationContent}>
          <div className={styles.rowHeading}><span className={styles.category}>{NOTIFICATION_TYPE_LABELS[row.type]}</span><span className={styles.muted}>{row.readAt ? "Read" : "Unread"}{row.archivedAt ? " · Archived" : ""}</span><time dateTime={row.createdAt} title={row.createdAt} suppressHydrationWarning>{new Date(row.createdAt).toLocaleString()}</time></div>
          <h2>{row.title}</h2>
          {row.body && <p className={styles.body}>{row.body}</p>}
          <div className={styles.rowActions}>
            {!trash && <>
              {getNotificationTargetHref(row.href) && <button type="submit" className={styles.openButton} name="operation" value={`open:${row.id}`} disabled={pending}>Open details <span aria-hidden="true">→</span></button>}
              <button type="submit" className={styles.textButton} name="operation" value={`${row.readAt ? "unread" : "read"}:${row.id}`} disabled={pending}>{row.readAt ? "Mark unread" : "Mark read"}</button>
              <button type="submit" className={styles.textButton} name="operation" value={`${row.archivedAt ? "unarchive" : "archive"}:${row.id}`} disabled={pending}>{row.archivedAt ? "Move to inbox" : "Archive"}</button>
              <button type="submit" className={styles.textButton} name="operation" value={`trash:${row.id}`} disabled={pending}>Move to trash</button>
            </>}
            {trash && <button type="submit" className={styles.openButton} name="operation" value={`restore:${row.id}`} disabled={pending}>Restore notification</button>}
            <EmailStatus row={row} />
          </div>
        </div>
      </article>)}
      {rows.length === 0 && <div className={styles.empty}><div className={styles.emptyIcon} aria-hidden="true">✓</div><h2>{filters.q || filters.type ? "No matching notifications" : trash ? "Trash is empty" : filters.view === "archived" ? "No archived notifications" : filters.view === "unread" ? "You’re all caught up" : "Your inbox is clear"}</h2><p className={styles.muted}>{filters.q || filters.type ? "Try another search or clear your filters." : "New alerts and updates will appear here."}</p></div>}
    </div>
  </>;
}

function EmailStatus({ row }: { row: NotificationRow }) {
  let label = "";
  if (row.emailedAt || row.emailStatus === "SENT") label = "Email sent";
  else if (row.emailStatus === "PENDING") label = "Email queued";
  else if (row.emailStatus === "SENDING") label = "Email sending";
  else if (row.emailStatus === "FAILED") label = "Email delivery failed";
  else if (row.emailStatus === "SKIPPED") label = "Email copy skipped";
  return label ? <span className={styles.emailStatus} title={row.emailedAt ? `Accepted by email server ${row.emailedAt}` : undefined}>{label}</span> : null;
}
