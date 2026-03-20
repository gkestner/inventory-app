"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const LIVE_ORDERS_SCROLL_SPEED_KEY = "live-orders-scroll-speed";

function clampIntervalSec(value: number): number {
  if (!Number.isFinite(value)) return 30;
  return Math.max(10, Math.min(300, Math.floor(value)));
}

function clampScrollSpeed(value: number): number {
  if (!Number.isFinite(value)) return 18;
  return Math.max(4, Math.min(120, Math.floor(value)));
}

function getScrollableTarget(): HTMLElement | null {
  const board = document.querySelector<HTMLElement>(".live-orders-board");
  if (board && board.scrollHeight - board.clientHeight > 8) return board;

  const page = document.querySelector<HTMLElement>(".live-orders-page");
  if (page && page.scrollHeight - page.clientHeight > 8) return page;

  const root = document.scrollingElement;
  if (root instanceof HTMLElement && root.scrollHeight - root.clientHeight > 8) return root;

  return board ?? page ?? (root instanceof HTMLElement ? root : null);
}

export default function LiveOrdersBoardControls({
  defaultEnabled = true,
  defaultIntervalSec = 30,
  defaultFullscreen = true,
}: {
  defaultEnabled?: boolean;
  defaultIntervalSec?: number;
  defaultFullscreen?: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean>(defaultEnabled);
  const [intervalSec, setIntervalSec] = useState<number>(clampIntervalSec(defaultIntervalSec));
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [scrollSpeed, setScrollSpeed] = useState(18);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LIVE_ORDERS_SCROLL_SPEED_KEY);
      if (!raw) return;
      setScrollSpeed(clampScrollSpeed(Number(raw)));
    } catch {
      // Ignore storage failures; defaults still work.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(LIVE_ORDERS_SCROLL_SPEED_KEY, String(clampScrollSpeed(scrollSpeed)));
    } catch {
      // Ignore storage failures; runtime controls still work.
    }
  }, [scrollSpeed]);

  useEffect(() => {
    if (!defaultFullscreen) return;
    document.documentElement.setAttribute("data-live-orders-fullscreen", "true");
    setIsFullscreen(true);
    setControlsCollapsed(true);
  }, [defaultFullscreen]);

  useEffect(() => {
    const syncFullscreen = () => {
      const active =
        typeof document !== "undefined" &&
        (document.documentElement.getAttribute("data-live-orders-fullscreen") === "true" || !!document.fullscreenElement);
      setIsFullscreen(active);
      setControlsCollapsed(active);
      if (typeof document !== "undefined") {
        if (active) document.documentElement.setAttribute("data-live-orders-fullscreen", "true");
        else document.documentElement.removeAttribute("data-live-orders-fullscreen");
      }
    };

    syncFullscreen();
    document.addEventListener("fullscreenchange", syncFullscreen);

    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      document.documentElement.removeAttribute("data-live-orders-fullscreen");
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const safeIntervalMs = clampIntervalSec(intervalSec) * 1000;
    const id = window.setInterval(() => {
      router.refresh();
      setLastRefreshedAt(new Date());
    }, safeIntervalMs);

    return () => window.clearInterval(id);
  }, [enabled, intervalSec, router]);

  useEffect(() => {
    if (!isFullscreen || !autoScrollEnabled) return;

    let frameId = 0;
    let lastTimestamp = 0;
    let direction = 1;
    let pauseUntil = 0;
    let activeScroller: HTMLElement | null = null;
    let desiredTop = 0;

    const pxPerSecond = clampScrollSpeed(scrollSpeed);
    const edgePauseMs = 1400;

    const tick = (timestamp: number) => {
      const scroller = getScrollableTarget();
      if (!scroller) {
        frameId = window.requestAnimationFrame(tick);
        return;
      }

      if (scroller !== activeScroller) {
        activeScroller = scroller;
        desiredTop = scroller.scrollTop;
        lastTimestamp = timestamp;
      }

      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      if (maxScrollTop > 0) {
        if (lastTimestamp === 0) lastTimestamp = timestamp;
        const dt = timestamp - lastTimestamp;
        lastTimestamp = timestamp;

        if (timestamp >= pauseUntil) {
          desiredTop += direction * ((pxPerSecond * dt) / 1000);
          const nextTop = desiredTop;
          if (nextTop <= 0) {
            desiredTop = 0;
            scroller.scrollTop = 0;
            direction = 1;
            pauseUntil = timestamp + edgePauseMs;
          } else if (nextTop >= maxScrollTop) {
            desiredTop = maxScrollTop;
            scroller.scrollTop = maxScrollTop;
            direction = -1;
            pauseUntil = timestamp + edgePauseMs;
          } else {
            scroller.scrollTop = Math.round(nextTop);
          }
        }
      } else {
        desiredTop = 0;
        lastTimestamp = timestamp;
      }

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [autoScrollEnabled, isFullscreen, scrollSpeed]);

  async function toggleFullscreen() {
    try {
      if (isFullscreen) {
        document.documentElement.removeAttribute("data-live-orders-fullscreen");
        setIsFullscreen(false);
        setControlsCollapsed(false);
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        }
        return;
      }

      document.documentElement.setAttribute("data-live-orders-fullscreen", "true");
      setIsFullscreen(true);
      setControlsCollapsed(true);

      const root = document.documentElement as typeof document.documentElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      };

      if (typeof root.requestFullscreen === "function") {
        try {
          await root.requestFullscreen({ navigationUI: "hide" });
        } catch {
          await root.requestFullscreen();
        }
        return;
      }

      if (typeof root.webkitRequestFullscreen === "function") {
        await root.webkitRequestFullscreen();
      }
    } catch {
      // Ignore fullscreen API failures; the board remains usable.
    }
  }

  const shell: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    border: "1px solid rgba(128,128,128,0.25)",
    borderRadius: 12,
    background: "var(--surface)",
    color: "var(--foreground)",
    padding: 10,
  };

  const row: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  };

  const buttonBase: CSSProperties = {
    borderRadius: 10,
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
    border: "1px solid rgba(128,128,128,0.25)",
  };

  const activeButton: CSSProperties = {
    ...buttonBase,
    background: "linear-gradient(160deg, var(--brand-2) 0%, var(--brand) 100%)",
    color: "var(--brand-contrast)",
  };

  const neutralButton: CSSProperties = {
    ...buttonBase,
    background: "var(--surface)",
    color: "var(--foreground)",
  };

  const input: CSSProperties = {
    width: 90,
    border: "1px solid rgba(128,128,128,0.25)",
    borderRadius: 10,
    padding: "8px 10px",
    fontSize: 12,
    background: "var(--surface)",
    color: "var(--foreground)",
    outline: "none",
  };

  const hint: CSSProperties = { fontSize: 12, opacity: 0.78 };
  const compactShell: CSSProperties = {
    ...shell,
    justifyContent: "flex-start",
    gap: 8,
    padding: "8px 10px",
    width: "auto",
  };

  if (isFullscreen && controlsCollapsed) {
    return (
      <div className="live-orders-controls" style={compactShell}>
        <div style={{ fontSize: 12, fontWeight: 900 }}>Board Controls</div>
        <div style={hint}>{autoScrollEnabled ? "Auto-scroll on" : "Auto-scroll off"}</div>
        <button type="button" style={neutralButton} onClick={() => setControlsCollapsed(false)}>
          Expand
        </button>
        <button type="button" style={neutralButton} onClick={toggleFullscreen}>
          Exit Fullscreen
        </button>
      </div>
    );
  }

  return (
    <div className="live-orders-controls" style={shell}>
      <div style={row}>
        <div style={{ fontSize: 12, fontWeight: 900 }}>Board Controls</div>

        <button type="button" style={enabled ? activeButton : neutralButton} onClick={() => setEnabled((v) => !v)}>
          Auto-refresh {enabled ? "On" : "Off"}
        </button>

        <label style={{ ...row, gap: 8 }}>
          <span style={hint}>Every</span>
          <input
            style={input}
            inputMode="numeric"
            pattern="[0-9]*"
            value={String(intervalSec)}
            onChange={(e) => setIntervalSec(clampIntervalSec(Number(e.target.value)))}
            aria-label="Refresh interval in seconds"
          />
          <span style={hint}>sec</span>
        </label>
      </div>

      <div style={row}>
        <button
          type="button"
          style={neutralButton}
          onClick={() => {
            router.refresh();
            setLastRefreshedAt(new Date());
          }}
        >
          Refresh Now
        </button>

        <button type="button" style={isFullscreen ? activeButton : neutralButton} onClick={toggleFullscreen}>
          {isFullscreen ? "Exit Fullscreen" : "Fullscreen Board"}
        </button>

        <button
          type="button"
          style={autoScrollEnabled ? activeButton : neutralButton}
          onClick={() => setAutoScrollEnabled((v) => !v)}
        >
          Auto-scroll {autoScrollEnabled ? "On" : "Off"}
        </button>

        <label style={{ ...row, gap: 8 }}>
          <span style={hint}>Speed</span>
          <input
            style={{ ...input, width: 78 }}
            inputMode="numeric"
            pattern="[0-9]*"
            value={String(scrollSpeed)}
            onChange={(e) => setScrollSpeed(clampScrollSpeed(Number(e.target.value)))}
            aria-label="Auto-scroll speed in pixels per second"
          />
          <span style={hint}>px/sec</span>
        </label>

        {isFullscreen ? (
          <button type="button" style={neutralButton} onClick={() => setControlsCollapsed(true)}>
            Minimize Controls
          </button>
        ) : null}

        <div style={hint}>
          {isFullscreen && autoScrollEnabled
            ? "Fullscreen scroll is active"
            : lastRefreshedAt
            ? `Last refresh ${lastRefreshedAt.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}`
            : "Manual or timer refresh not used yet"}
        </div>
      </div>
    </div>
  );
}