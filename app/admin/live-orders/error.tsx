// app/admin/live-orders/error.tsx
"use client";

import type { CSSProperties } from "react";
import { useEffect } from "react";

export default function LiveOrdersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // You can wire this into any logging later; keep stable for now.
    // eslint-disable-next-line no-console
    console.error("Live Orders Board error:", error);
  }, [error]);

  const wrap: CSSProperties = {
    padding: 16,
    maxWidth: 900,
    margin: "0 auto",
  };

  const card: CSSProperties = {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    background: "#fff",
    padding: 14,
    marginTop: 12,
  };

  const btn: CSSProperties = {
    border: "1px solid #111827",
    background: "#111827",
    color: "#fff",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 13,
    cursor: "pointer",
  };

  const mono: CSSProperties = {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    color: "#374151",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
  };

  return (
    <main style={wrap}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Live Orders Board</h1>

      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>Something went wrong.</div>
        <div style={{ marginTop: 6, fontSize: 13, color: "#6b7280" }}>
          Try again. If it keeps happening, copy the details below.
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button style={btn} onClick={() => reset()}>
            Retry
          </button>
        </div>

        <div style={mono}>
          {error?.message ?? "Unknown error"}
          {error?.digest ? `\nDigest: ${error.digest}` : ""}
        </div>
      </div>
    </main>
  );
}