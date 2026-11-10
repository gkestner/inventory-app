# Global notification email oversight

An enabled full administrator can receive a private email copy of every **new in-app notification delivered to another user**. The migration enrolls the single active, privileged account matching `gkestner@pizzaplusinc.com` once, storing its stable User ID. Runtime routing uses that relational subscription, never a hard-coded email lookup. Ambiguous, inactive or non-administrator matches are not enrolled.

## What the copy contains

The email includes the complete original title and body, actual recipient's name and email, notification type, creation time in America/New_York, stable notification ID and a link to the relevant application page. Subjects begin with `[Oversight]` so they are distinguishable from the administrator's own notifications. Each recipient receives a separate private message; recipients are never combined into a To/CC/BCC list.

The original notification still belongs to its routed user. Vacation forwarding and notification permissions are resolved first, and the oversight context identifies the person who actually received that in-app event. If the subscriber is that recipient, only their normal primary email job is created; no second oversight copy is added.

## Preferences and authority

Only an active legacy `ADMIN` or a user assigned the system dynamic `ADMIN` role can enable oversight. Access to an individual admin module or PM management permission does not grant global oversight. Every update reloads current database roles, and the worker rechecks current active status, subscription and full administrator authority before sending.

The administrator's **own email-copy preference applies to both their primary and oversight mail**. Pausing that preference suppresses both kinds. An original recipient's preference has no effect on the administrator's copy. Disabling oversight skips its pending jobs and stops future copies. Removing the subscription or administrator authority also suppresses unsent copies. Re-enabling applies to future events; skipped or historical events are not replayed.

An oversight copy describes an event already delivered in-app. Reading, archiving or trashing the original notification, disabling that user's email, deactivating that user, or later changing/pausing its reminder schedule does not erase the administrator's independent event copy. Hiding a location or pausing a list still prevents **future** reminder events, so there is no new oversight copy until a future event is generated. An email already transmitting cannot be recalled.

## Durable delivery and history

The existing outbox and worker now support one job per `(notificationId, recipientUserId)`, with explicit `PRIMARY` or `OVERSIGHT` kind. Each job has its own stable ID, state, retry count, lease, SMTP Message-ID and acceptance date. The source notification and all recipient jobs are created atomically; one recipient's failure does not change another recipient's result.

The legacy `Notification.emailedAt` records **primary acceptance only**. An accepted oversight copy cannot make a failed original email appear sent. The inbox displays primary delivery status, and its delivery refresh cursor is scoped to the viewer's actual recipient ID.

Existing primary jobs retain their previous ID (the old notification ID), status, attempts, leases, errors, provider IDs and timestamps. The migration does not create oversight jobs for old notifications. Subscription changes are audited with explicit User IDs, and delivery/notification relationships are enforced by foreign keys and uniqueness constraints.

## Coordinated rollout

Review and back up the database before applying `20261110121000_notification_oversight`, after the compliance-section migration. This changes the Prisma outbox relationship from one job to many recipient jobs, so **pause scheduled delivery and drain existing workers before migrating and promoting the matching application build**. Old application clients must not process the new queue or create notifications against its changed schema. Resume workers only after the new client is active. No production migration or delivery is performed by the development tests.

Mail delivery continues to use the existing authenticated SMTP settings, protected retry route, encrypted connection, per-message deadline, bounded retries and demo-mode safeguards described in [notification-email-setup.md](notification-email-setup.md). Tests cover private recipient planning, actual vacation routing, duplicate prevention, concurrent jobs for one event, primary/oversight failure independence, role/subscription revocation and complete contextual email content.
