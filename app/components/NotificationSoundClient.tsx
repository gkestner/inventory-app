"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  isNewerNotification, NOTIFICATION_COUNT_EVENT,
  type NotificationCountUpdate, type NotificationCursor,
} from "@/app/lib/notification-counts";

const POLL_MS = 20000;

function playNotificationTone() {
  if (typeof window === "undefined") return;

  const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;

  const ctx = new Ctx();
  const now = ctx.currentTime;

  const oscA = ctx.createOscillator();
  const gainA = ctx.createGain();
  oscA.type = "sine";
  oscA.frequency.setValueAtTime(880, now);
  gainA.gain.setValueAtTime(0.0001, now);
  gainA.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
  gainA.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  oscA.connect(gainA);
  gainA.connect(ctx.destination);
  oscA.start(now);
  oscA.stop(now + 0.24);

  const oscB = ctx.createOscillator();
  const gainB = ctx.createGain();
  oscB.type = "triangle";
  oscB.frequency.setValueAtTime(1175, now + 0.14);
  gainB.gain.setValueAtTime(0.0001, now + 0.14);
  gainB.gain.exponentialRampToValueAtTime(0.07, now + 0.16);
  gainB.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
  oscB.connect(gainB);
  gainB.connect(ctx.destination);
  oscB.start(now + 0.14);
  oscB.stop(now + 0.36);

  window.setTimeout(() => {
    void ctx.close().catch(() => undefined);
  }, 500);
}

export default function NotificationSoundClient() {
  const router = useRouter();
  const pathname = usePathname();
  const enabledRef = useRef(false);
  const previousRef = useRef<{
    userId: string; unreadCount: number; latest: NotificationCursor; emailDeliveryRevision: string | null;
  } | null>(null);

  useEffect(() => {
    const unlock = () => {
      enabledRef.current = true;
    };

    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    window.addEventListener("touchstart", unlock, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, []);

  useEffect(() => {
    let dead = false;
    let inFlight = false;

    async function tick() {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const res = await fetch("/api/me/notifications/unread-count", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!res.ok) {
          if (res.status === 401) previousRef.current = null;
          return;
        }

        const json = (await res.json()) as {
          userId?: string; unreadCount?: unknown;
          latestNotification?: NotificationCursor; latestUnreadNotification?: NotificationCursor;
          emailDeliveryRevision?: string | null;
        };
        const next = Number(json.unreadCount ?? 0);
        if (dead || !json.userId || !Number.isInteger(next) || next < 0) return;

        const prev = previousRef.current;
        const latest = json.latestNotification ?? null;
        const emailDeliveryRevision = json.emailDeliveryRevision ?? null;
        previousRef.current = { userId: json.userId, unreadCount: next, latest, emailDeliveryRevision };
        window.dispatchEvent(new CustomEvent<NotificationCountUpdate>(NOTIFICATION_COUNT_EVENT, {
          detail: { userId: json.userId, unreadCount: next },
        }));
        if (!prev || prev.userId !== json.userId) {
          // Delivery can finish between the server render and this first poll.
          if (pathname === "/notifications") router.refresh();
          return;
        }

        // A zero-history inbox may receive its first new item after initialization.
        const newUnread = json.latestUnreadNotification ?? null;
        const arrived = isNewerNotification(newUnread, prev.latest);
        if (arrived && enabledRef.current) playNotificationTone();
        if (pathname === "/notifications" &&
          (next !== prev.unreadCount || latest?.id !== prev.latest?.id ||
            emailDeliveryRevision !== prev.emailDeliveryRevision)) {
          router.refresh();
        }
      } catch {
        // Ignore polling/network errors; next interval will retry.
      } finally {
        inFlight = false;
      }
    }

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      dead = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pathname, router]);

  return null;
}
