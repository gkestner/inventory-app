# Recurring notification lists

Managers with the existing admin preventative-maintenance permission can open **Facilities → Compliance & Testing**, or use the **Compliance & Testing** button in Notifications. The canonical page is `/admin/preventative-maintenance/compliance`; old reminder-list bookmarks redirect there. The same live-account and admin-access checks apply to every server action, including company creation and hide/show actions.

## Sections and navigation

Every category and location starts collapsed. Open a category for compact location summaries, then open one location to load its last service and new-entry form. Closing a location keeps an unfinished entry until you leave the page. Search by category, location, or company; filter for records needing attention, missing dates, or paused reminders. The year selector chooses the record year for new entries; the last service always spans all years. Maintenance viewers see only their assigned locations and no private recipient addresses.

Use **Add a compliance section** for another inspection, servicing task, or renewal. **Edit category details** changes its name, description, display order and default interval. **Assign category recipients** accepts multiple app users and email-only addresses. Select **All locations, keeping location recipients** to notify the category recipients alongside location-specific recipients, or limit the category to locations that use its defaults. Existing categories keep their routing choice; new categories default to all locations. The searchable user picker keeps selections while filtering and loads when opened.

At a location, use **Change location recipients**, enable the override, choose users or enter email addresses, and **Save recipients**. Without an override, category recipients apply. Standard categories with no selected app users still notify each location’s primary maintenance team where it has no override. Custom categories can use email addresses alone. Email-only recipients get the reminder without an inbox account; addresses already associated with an app user belong in the user picker. Recipient-only updates leave service history unchanged. Date and interval edits show the calculated date before saving.

## Dates, companies, and recurrence

- Create a named list and choose one or more active recipients. The creator is the initial recipient. Each active location receives a blank row. Locations added later appear in the section and their row is saved when edited or when list settings are saved.
- Enter or select a service company on a new entry. Company identities are stored in their own SQL table with a unique normalized name and stable foreign keys. Each history entry also retains the company label recorded at that time. Inventory suppliers remain separate from service companies.
- The **Service date** is the reference date. It is the basis of the schedule, rather than the first notification date. A reference date of January 31 and an 11-month interval first reminds on December 31.
- Every list defaults to **11 months**. A location can override that interval with a whole number from 1 through 120. An empty override inherits the list default. Explicit valid overrides are preserved when the default changes.
- Recurrences always use the original reference date, clamping to month-end where necessary. January 31 repeated monthly yields February 28/29 and then March 31. It does not drift to March 28/29.
- A blank date means no schedule. Changing the reference date, interval override, or inherited list interval recalculates the schedule from its reference date and cancels unsent email copies of superseded reminders. Changing only the company preserves the progressed next-reminder date.
- **Save new entry** requires a service date and appends a separate history record. Multiple visits within one year are retained. A backdated entry appears in history without replacing a newer service date or moving its reminder backwards. Duplicate submissions of the same form are idempotent.

## Service history reports

Open **Reports Hub → Compliance History**, or use the history links on the dashboard. Choose one location with all sections to see every compliance field for that location; choose one section with all locations to compare its entire history. Both filters can also be combined. All years are included unless a record-year filter is selected. Hidden, paused, and inactive locations retain their history.

Each entry includes its service date, interval, company, cost, notes, applicable tank size/gallons and additional boiler inspection date, recorder, timestamp and provenance. Existing annual records and reliable audit snapshots are imported without changing their source records. The report pages through 25 entries at a time. Excel, CSV and readable full-text PDF exports include all matching entries; browser print includes the current page.

The service ledger is relational and append-only. Legacy annual PM edits create linked correction records, preserving their predecessors and dashboard-only notes. Annual tables remain compatible with existing checklist and scorecard reports. Built-in reminders use the latest valid non-superseded service history; custom schedules retain their anchored recurrence state.

## Pausing and history

Locations with a numeric location number of **65 or above** start hidden and paused. **Hide & pause** also pauses any location manually. Enable **Include hidden** and apply the filters to reveal these rows. **Show & resume** explicitly restores visibility and resumes reminders; ordinary saves keep that choice. Dates, intervals, companies, recipients and history stay intact. Pausing a category suppresses all its locations. Inactive locations are also excluded.

The first daily scan after resuming an overdue schedule creates at most one catch-up notification, then advances directly to the next future cycle from the original reference date. It does not send one email for every missed month. Existing occurrences cannot be replayed by setting a row back to an already-notified due date.

Hiding, clearing the date, revising the schedule or pausing a list cancels pending copies. Before SMTP starts, the worker also checks the current visibility, list/location status, reference date and effective interval against the occurrence. An email already transmitting or accepted by the provider cannot be recalled. Read, archive and trash actions on notifications preserve the relational occurrence and audit history and do not alter recurrence dates.

## Scheduled operation and delivery

`vercel.json` runs `/api/cron/notification-reminders` daily at **13:00 UTC** (8 a.m. Eastern Standard Time / 9 a.m. Eastern Daylight Time). The route requires `Authorization: Bearer <CRON_SECRET>`, and rejects every request when the secret is unset or incorrect. On another host, configure a scheduler to make the same request. Scan dates use the **America/New_York** calendar regardless of the server timezone.

The daily route independently runs the custom reminder scan and the existing preventative-maintenance compliance scan. Custom reminders become due on the calculated reminder date. Existing PM reminders retain their 30-day due-soon window; a blank PM interval uses the section default, initially 11 months, and explicit valid intervals are retained. PM scanning uses the most recent applicable non-superseded service history and includes recorded company details. Invalid explicit legacy interval text remains visible in history and does not silently enable a schedule. Its stable per-recipient dedupe key prevents overlapping scans, multiple locations and vacation forwarding from confusing each other's reminders. The existing PM integration endpoint retains its supported token aliases (`PM_COMPLIANCE_REMINDER_TOKEN`, `PM_REMINDER_SYNC_TOKEN`, `MOCREO_SYNC_TOKEN`, `CRON_SECRET`) and fails closed if no token is configured.

The custom scan pages through due rows in batches of 100, with a default cap of 5,000 rows and a 90-second start budget. Its result reports `incomplete: true` if a cap is reached; operators can invoke the authenticated endpoint again for remaining work. Inactive-recipient lists are excluded. A list with no reachable routed recipients does not lose its due occurrence or advance its date; within a scan, cursor pagination still reaches later rows.

Custom events use the shared notification routing and email outbox: active-user checks, vacation forwarding, per-user email preferences, retry leases and SMTP failure handling all continue to apply. Notification bodies include the category, location, company, service date, due date, repeat interval and next reminder. App users get private inbox copies and their configured emails. Email-only recipients get the same reminder details without a sign-in link. The worker rechecks contact membership, account matches, pauses and schedule changes before sending, and queues eligible administrator oversight copies only after an email-only delivery is accepted. Delivery uses the existing SMTP setup in [notification-email-setup.md](notification-email-setup.md).

## Database rollout and verification

Back up the affected records and review the additive migrations before deployment:

1. `20261109120000_notification_inbox_email` adds inbox states and the email outbox.
2. `20261109130000_custom_notification_reminders` adds companies, lists, per-location schedules, recipient junctions and immutable occurrence records, plus notification foreign keys and dedupe constraints.
3. `20261110120000_compliance_sections` adds section metadata, built-in section settings, location recipient overrides, and optional annual company references. It preserves all annual service facts.
4. `20261110121000_notification_oversight` adds independent per-recipient delivery jobs and administrator oversight. Follow its [coordinated rollout instructions](notification-oversight.md) before activating the new application client.
5. `20261110160000_compliance_service_history` adds the service ledger, correction links and source foreign keys; imports current annual facts and reliable audit history; and retains every original source row. Review imported counts, facts and foreign-key integrity before finishing rollout. Existing clients should finish compliance writes before this migration and the matching application release; check for any legacy audit updates during the release window.
6. `20261111100000_compliance_category_routing` adds the all-location category option, applies the 65+ visibility default, and skips unsent primary reminder emails for newly paused rows. It preserves explicit resumes, oversight copies, and service history.
7. `20261111101000_compliance_email_recipients` adds normalized contact assignments and email-only reminder events to the existing outbox. It preserves existing deliveries. After email-only jobs exist, use a compatible worker for any release rollback.

Run `npm run migrate:deploy` during the deployment workflow, then build and deploy the application. These migrations do not backfill old notifications for delivery. Historical company labels remain intact without guessing company relationships, and original annual records are preserved.

Occurrence creation, the next-date update, linked notifications and outbox jobs, and the audit record commit together in a transaction. A database row lock serializes list edits and scans; unique occurrence and recipient-notification keys prevent duplicate identities. Foreign keys and date/interval checks protect relationships and prevent partial schedule records. Hiding and editing retain historical occurrence references. Demo mode bypasses both scans and suppresses durable writes and external delivery.

Run `npm run test:history`, `npm run test:reminders` and `npm run test:notifications`, followed by `npm run typecheck` and `npm run build`. These tests use local data doubles and do not send real mail or update a production database. Coverage includes multiple services per year, backdated entries, duplicate submissions, full-field history, correction links, complete PDF text, date anchoring, month-end clamping, overlapping scans, no-recipient rollback, pagination, hidden locations and superseded queued emails.
