"use client";

import { useEffect, useRef } from "react";

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
  const enabledRef = useRef(false);
  const prevUnreadRef = useRef<number | null>(null);
  const initializedRef = useRef(false);

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

    async function tick() {
      try {
        const res = await fetch("/api/me/notifications/unread-count", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!res.ok) return;

        const json = (await res.json()) as { unreadCount?: unknown };
        const next = Number(json.unreadCount ?? 0);
        if (!Number.isFinite(next)) return;

        const prev = prevUnreadRef.current;
        prevUnreadRef.current = next;

        if (!initializedRef.current) {
          initializedRef.current = true;
          return;
        }

        if (prev !== null && next > prev && enabledRef.current && !dead) {
          playNotificationTone();
        }
      } catch {
        // Ignore polling/network errors; next interval will retry.
      }
    }

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, POLL_MS);

    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, []);

  return null;
}
