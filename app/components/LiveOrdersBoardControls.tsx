"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function clampIntervalSec(value: number): number {
  if (!Number.isFinite(value)) return 30;
  return Math.max(10, Math.min(300, Math.floor(value)));
}

export default function LiveOrdersBoardControls({
  defaultEnabled = true,
  defaultIntervalSec = 30,
}: {
  defaultEnabled?: boolean;
  defaultIntervalSec?: number;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean>(defaultEnabled);
  const [intervalSec, setIntervalSec] = useState<number>(clampIntervalSec(defaultIntervalSec));
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  useEffect(() => {
    const syncFullscreen = () => {
      const active = typeof document !== "undefined" && !!document.fullscreenElement;
      setIsFullscreen(active);
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

    const scroller = document.querySelector<HTMLElement>(".live-orders-board");
    if (!scroller) return;

    let frameId = 0;
    let lastTimestamp = 0;
    let direction = 1;
    let pauseUntil = 0;

    const pxPerSecond = 18;
    const edgePauseMs = 1400;

    const tick = (timestamp: number) => {
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      if (maxScrollTop > 0) {
        if (lastTimestamp === 0) lastTimestamp = timestamp;
        const dt = timestamp - lastTimestamp;
        lastTimestamp = timestamp;

        if (timestamp >= pauseUntil) {
          const nextTop = scroller.scrollTop + direction * ((pxPerSecond * dt) / 1000);
          if (nextTop <= 0) {
            scroller.scrollTop = 0;
            direction = 1;
            pauseUntil = timestamp + edgePauseMs;
          } else if (nextTop >= maxScrollTop) {
            scroller.scrollTop = maxScrollTop;
            direction = -1;
            pauseUntil = timestamp + edgePauseMs;
          } else {
            scroller.scrollTop = nextTop;
          }
        }
      }

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [autoScrollEnabled, isFullscreen]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

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