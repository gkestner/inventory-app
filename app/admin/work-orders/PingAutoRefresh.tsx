"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PingAutoRefreshProps = {
  intervalMs?: number;
};

export default function PingAutoRefresh({ intervalMs = 12000 }: PingAutoRefreshProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(true);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const id = window.setInterval(() => {
      if (document.hidden) return;
      router.refresh();
      setLastRefreshAt(new Date());
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [enabled, intervalMs, router]);

  const nextEverySec = useMemo(() => Math.max(1, Math.round(intervalMs / 1000)), [intervalMs]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={() => setEnabled((v) => !v)}
        style={{
          padding: "6px 10px",
          borderRadius: 10,
          border: "1px solid rgba(128,128,128,0.35)",
          background: "var(--background)",
          color: "var(--foreground)",
          fontWeight: 800,
          cursor: "pointer",
        }}
      >
        {enabled ? "Pause Live Refresh" : "Resume Live Refresh"}
      </button>

      <div style={{ fontSize: 12, opacity: 0.8 }}>
        {enabled ? `Auto-refreshing every ${nextEverySec}s` : "Auto-refresh paused"}
        {lastRefreshAt ? ` • last refresh ${lastRefreshAt.toLocaleTimeString()}` : ""}
      </div>
    </div>
  );
}
