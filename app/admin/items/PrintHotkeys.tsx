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

      // Small popup window (warehouse-style)
      const w = 420;
      const h = 320;
      const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
      const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));

      // Always open a fresh popup window to avoid reusing an existing tab/window
      // which can sometimes leave stale content (or be blocked from navigating).
      console.debug("PrintHotkeys", url);
      const win = window.open("about:blank", "_blank", `noopener,noreferrer,popup=yes,width=${w},height=${h},left=${left},top=${top}`);
      if (win) {
        // navigate the new window after opening to avoid blockers
        win.location.href = url;
      } else {
        // fallback if popup blocked
        window.location.href = url;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ids, ignoreWhenTyping, copies]);

  return null;
}
