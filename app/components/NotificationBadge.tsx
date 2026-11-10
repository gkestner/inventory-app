"use client";

import { useEffect, useState } from "react";
import { NOTIFICATION_COUNT_EVENT, type NotificationCountUpdate } from "@/app/lib/notification-counts";

export default function NotificationBadge({ userId, initialCount }: { userId: string; initialCount: number }) {
  const [state, setState] = useState({ userId, initialCount, count: initialCount });
  // Reset together when server data or the authenticated user changes.
  if (state.userId !== userId || state.initialCount !== initialCount) {
    setState({ userId, initialCount, count: initialCount });
  }
  const count = state.userId === userId && state.initialCount === initialCount ? state.count : initialCount;

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<NotificationCountUpdate>).detail;
      if (detail?.userId === userId) setState((previous) => ({ ...previous, count: detail.unreadCount }));
    };
    window.addEventListener(NOTIFICATION_COUNT_EVENT, update);
    return () => window.removeEventListener(NOTIFICATION_COUNT_EVENT, update);
  }, [userId]);

  return (
    <span
      style={{
        minWidth: 20, height: 20, padding: "0 6px", borderRadius: 999,
        border: "1px solid color-mix(in srgb, var(--brand) 50%, var(--border))",
        background: "linear-gradient(160deg, var(--brand-2) 0%, var(--brand) 100%)",
        color: "var(--brand-contrast)", display: count > 0 ? "inline-flex" : "none",
        alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900, lineHeight: 1,
      }}
      aria-label={`${count} unread notifications`}
      aria-live="polite"
      aria-atomic="true"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
