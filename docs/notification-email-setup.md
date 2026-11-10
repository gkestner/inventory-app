# Notification email and inbox setup

New notifications use the existing recipient routing, permissions, active-user checks, and vacation forwarding. Each resolved recipient receives a private email with the same title and full details as their inbox notification, plus an authenticated link back to the application. Recipients are never put together in a To/CC list. Users can turn email copies off in Notifications without losing in-app alerts.

## Required server configuration

Set these values in the deployment's environment settings. Never put credentials in browser code or version control.

| Variable | Value |
| --- | --- |
| `SMTP_HOST` | Your authenticated SMTP provider's server name |
| `SMTP_PORT` | Provider port, normally `465` or `587` |
| `SMTP_USER` | SMTP account or provider username |
| `SMTP_PASS` | SMTP password or provider app password |
| `SMTP_FROM` | An address authorized by your provider, optionally `Success Plus <notifications@example.com>` |
| `APP_URL` or `NEXTAUTH_URL` | Trusted public HTTPS application origin, e.g. `https://inventory.example.com` |
| `CRON_SECRET` | A long random secret for the scheduled retry endpoint |

Port 465 uses implicit TLS; other ports require STARTTLS. Certificate verification remains enabled. Only local development permits an HTTP localhost application origin. Email is marked unconfigured unless every SMTP value and a trusted application origin are valid. Configure your sender domain and authentication records according to your mail provider's instructions.

`vercel.json` invokes `/api/cron/notification-emails` every five minutes. This cadence requires a Vercel plan that supports it. On another host, configure a scheduler to make the same request with `Authorization: Bearer <CRON_SECRET>` every five minutes. The route refuses requests when the secret is missing or incorrect. Browser login is not required for this endpoint; the bearer secret is required.

## Database rollout

1. Take the usual database backup and review `prisma/migrations/20261109120000_notification_inbox_email/migration.sql`.
2. Apply with `npm run migrate:deploy`, then build and deploy the application. The existing Vercel build command already deploys reviewed migrations before building.
3. Verify existing notification IDs and read dates remain intact, and inspect the new foreign key and check constraints. This migration adds tables/columns only and intentionally does **not** enqueue historical notifications.
4. After configuration, generate a new notification through an authorized application workflow for a designated test account and confirm both the inbox details and SMTP acceptance. No live messages are sent by the automated tests.

## Delivery behavior

The notification and its relational email job are saved atomically. A background task attempts delivery after the application response; the scheduled worker recovers unsent jobs and temporary failures. Missing configuration leaves new jobs pending without breaking business workflows. Once configured, those pending **new** jobs can be delivered; old notifications predating this feature never enter the queue.

Workers claim jobs atomically with expiring leases so overlapping requests do not normally send the same email. Failed sends retry with exponential backoff (up to five attempts); terminal failures remain visible in the inbox. A final crashed attempt becomes Failed after its lease expires. No inbox action erases the email delivery history. Email settings and active-user status are checked again immediately before sending. Turning email off skips queued jobs when next processed; turning it back on applies to future notifications, without replaying skipped jobs. Trashed notifications are skipped if their email has not been sent; archiving does not cancel the copy.

Sent means the SMTP provider accepted the message, not that the recipient opened it or that final mailbox delivery is guaranteed. SMTP cannot provide exactly-once delivery: a process failure after provider acceptance but before the database confirmation can produce a duplicate on retry. A stable Message-ID accompanies retries. Bounce tracking, provider webhooks, and external delivery receipts are not implemented. Demo mode suppresses all provider side effects and all durable writes.

The worker stops starting messages after 20 seconds, and each SMTP attempt has an absolute 25-second deadline that destroys its underlying connection before recording a timeout. DNS lookup is separately capped at five seconds. This leaves time for database confirmation within the retry route's 60-second execution window. Each email uses a validated single mailbox so malformed legacy addresses cannot expand into a recipient list.

Run focused queue/content tests with `npx tsx --test app/lib/notification-email.test.ts`. These use an in-memory database double and never connect to SMTP or a production database.

For custom location/company/date lists and the daily reminder scan, see [notification-reminders.md](notification-reminders.md). Hidden locations and paused lists suppress unsent recurring-reminder copies as well as future scans. Copies already transmitting cannot be recalled.

For private administrator copies of notifications delivered to other users, see [notification-oversight.md](notification-oversight.md). Oversight uses independent recipient jobs in the same queue. It respects the administrator's own email preference and authority, and preserves event details even if the original user later trashes the notification or pauses its schedule.
