"use client";

import { useEffect } from "react";

type Props = {
  /** The item ids to print (usually [itemId]) */
  ids: string[];
  /**
   * If true, do nothing when the user is typing in an input/textarea/select/contenteditable.
   * Recommended = true.
   */
  ignoreWhenTyping?: boolean;
  /** How many copies to print per item (handled by the labels page) */
  copies?: number;
};

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  return false;
}

export default function PrintHotkeys({
  ids,
  ignoreWhenTyping = true,
  copies = 1,
}: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Press "P" (or "p") to print label(s)
      if (e.key !== "p" && e.key !== "P") return;
      if (e.repeat) return;

      // Don't hijack Ctrl/Cmd+P (browser print)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (ignoreWhenTyping && isTypingTarget(e.target)) return;

      if (!ids || ids.length === 0) return;

      e.preventDefault();

      const qs = new URLSearchParams();
      qs.set("ids", ids.join(","));
      qs.set("autoprint", "1");
      qs.set("autoclose", "1");
      qs.set("copies", String(Math.max(1, Math.min(50, copies))));
      // Debug flag: show diagnostic overlay in the popup to help troubleshoot
      // (safe to remove after debugging)
      qs.set("debug", "1");

      const url = `/labels?${qs.toString()}`;

      const lockKey = "__labelsPopupLockUntil" as const;
      const now = Date.now();
      const memLockUntil = Number((window as any)[lockKey] ?? 0);
      const storageLockUntil = Number(window.sessionStorage.getItem(lockKey) ?? 0);
      const lockUntil = Math.max(memLockUntil, storageLockUntil);
      if (now < lockUntil) return;
      const nextLock = now + 3000;
      (window as any)[lockKey] = nextLock;
      window.sessionStorage.setItem(lockKey, String(nextLock));

      // Small popup window (warehouse-style)
      const w = 420;
      const h = 320;
      const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
      const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));

      // Always open a fresh popup window to avoid reusing an existing tab/window
      // which can sometimes leave stale content (or be blocked from navigating).
      console.debug("PrintHotkeys", url);
      const existing = (window as any).__labelsPopupRef as Window | undefined;
      if (existing && !existing.closed) {
        existing.location.href = url;
        existing.focus();
        return;
      }

      const win = window.open(
        url,
        "labels-print-popup",
        `noopener,noreferrer,popup=yes,width=${w},height=${h},left=${left},top=${top}`,
      );
      if (!win) {
        // fallback if popup blocked
        window.location.href = url;
      } else {
        (window as any).__labelsPopupRef = win;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ids, ignoreWhenTyping, copies]);

  return null;
}
