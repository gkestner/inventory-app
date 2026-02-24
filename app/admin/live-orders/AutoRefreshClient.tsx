// app/admin/live-orders/AutoRefreshClient.tsx
"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export default function AutoRefreshClient({
  defaultEnabled = true,
  defaultIntervalSec = 30,
}: {
  defaultEnabled?: boolean;
  defaultIntervalSec?: number;
}) {
  const router = useRouter();

  const [enabled, setEnabled] = useState<boolean>(defaultEnabled);
  const [intervalSec, setIntervalSec] = useState<number>(defaultIntervalSec);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const safeIntervalMs = useMemo(() => {
    const s = Number(intervalSec);
    if (!Number.isFinite(s)) return 30_000;
    const clamped = Math.max(10, Math.min(300, Math.floor(s))); // 10s .. 5m
    return clamped * 1000;
  }, [intervalSec]);

  useEffect(() => {
    if (!enabled) return;

    const id = window.setInterval(() => {
      router.refresh();
      setLastRefreshedAt(new Date());
    }, safeIntervalMs);

    return () => window.clearInterval(id);
  }, [enabled, safeIntervalMs, router]);

  const bar: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    background: "#fff",
    padding: 10,
    marginTop: 12,
  };

  const left: CSSProperties = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };
  const right: CSSProperties = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };

  const label: CSSProperties = { fontSize: 12, color: "#374151", fontWeight: 700 };
  const hint: CSSProperties = { fontSize: 12, color: "#6b7280" };

  const btn: CSSProperties = {
    border: "1px solid #111827",
    background: "#111827",
    color: "#fff",
    borderRadius: 10,
    padding: "8px 10px",
    fontSize: 12,
    cursor: "pointer",
  };

  const btnGhost: CSSProperties = {
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: "#111827",
    borderRadius: 10,
    padding: "8px 10px",
    fontSize: 12,
    cursor: "pointer",
  };

  const input: CSSProperties = {
    width: 90,
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "8px 10px",
    fontSize: 12,
    outline: "none",
  };

  return (
    <div style={bar}>
      <div style={left}>
        <div style={label}>Auto-refresh</div>

        <button
          type="button"
          style={enabled ? btn : btnGhost}
          onClick={() => setEnabled((v) => !v)}
          aria-pressed={enabled}
          title="Toggle auto-refresh"
        >
          {enabled ? "On" : "Off"}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={hint}>Every</span>
          <input
            style={input}
            inputMode="numeric"
            pattern="[0-9]*"
            value={String(intervalSec)}
            onChange={(e) => setIntervalSec(Number(e.target.value))}
            aria-label="Auto-refresh interval in seconds"
          />
          <span style={hint}>sec (10–300)</span>
        </div>
      </div>

      <div style={right}>
        <button
          type="button"
          style={btnGhost}
          onClick={() => {
            router.refresh();
            setLastRefreshedAt(new Date());
          }}
          title="Refresh now"
        >
          Refresh now
        </button>

        <div style={hint}>
          {lastRefreshedAt ? (
            <>
              Last refresh:{" "}
              {lastRefreshedAt.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </>
          ) : (
            "—"
          )}
        </div>
      </div>
    </div>
  );
}