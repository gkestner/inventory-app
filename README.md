This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Notifications

The notification inbox supports read/unread states, archiving, recoverable trash, bulk actions, search, category filters, and pagination. New notifications can also send private email copies using authenticated SMTP, with durable retry tracking and per-user email preferences.

See [notification email and database rollout setup](docs/notification-email-setup.md) before deploying. Run `npm run test:notifications` for the focused regression checks. The visible application version comes from `package.json`; its version must match the package lock and service-worker cache version.

PM administrators manage service records and custom reminder sections under **Facilities → Compliance & Testing**. All sections start collapsed. Sections support editable names, descriptions, display order, multiple recipients, per-location recipients and intervals, and preserved annual service records. New sections default to 11 months from the date entered. Hiding a location pauses future reminders while preserving its saved details. Run `npm run test:reminders` for calendar, routing, and scheduling checks.

Full administrators can enable private copies of other users' notifications in Notifications. The requested owner account is enrolled when the reviewed migration finds its current active administrator identity. See [notification oversight and coordinated rollout](docs/notification-oversight.md).

See [recurring reminder usage and activation](docs/notification-reminders.md) for date examples, pause/resume behavior, and database rollout requirements.

The Needs Ordering report, its Excel export, and suggested reorder quantities count only unfinished live orders (Ordered or Arrived) as incoming stock. The saved Ordered total remains separate history. Run `npm run test:inventory` for replenishment regression checks.

Inventory editors can use **Unignore All** at the top of Needs Ordering to restore normal ordering checks for every ignored item, regardless of the current filters. The button shows the total ignored count; after restoring, the report resets its filters and shows items that need ordering. The action records the editor and restored count in the audit log.

Order-more flags in Needs Ordering and its Excel export default to the last 30 days. Check **Include older order flags** and Apply to include unresolved requests from all dates. This choice follows supplier grouping, priority links, per-item Ignore/Unignore, and Excel export. Stock shortages remain eligible regardless of flag age; older requests are preserved.

Each order-more request has a **Dismiss Flag** button beside its requester, store, and date in the flag cards and report rows. Dismissal resolves only that alert ID, preserves its original note and records the resolver. Other open requests and later flags for the same item remain eligible, including requests submitted while a dismissal is in progress. Stock levels and the item's permanent Ignore setting are unaffected. Report filters are preserved after dismissal, and the action is audit logged.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
