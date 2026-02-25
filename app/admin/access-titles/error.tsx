"use client";

import { useEffect } from "react";

export default function AccessTitlesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // logs in browser console
    console.error("Access Titles crashed:", error);
  }, [error]);

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", color: "var(--foreground)" }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>⚠️ Access Titles crashed</h1>

        <div
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: 14,
            border: "1px solid rgba(244,67,54,0.55)",
            background: "rgba(244,67,54,0.08)",
            whiteSpace: "pre-wrap",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          }}
        >
          {error?.message ?? "Unknown error"}
          {error?.digest ? `\n\ndigest: ${error.digest}` : ""}
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(128,128,128,0.25)",
              background: "rgba(33,150,243,0.18)",
              color: "var(--foreground)",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Retry
          </button>

          <a
            href="/admin/users"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(128,128,128,0.25)",
              background: "var(--background)",
              color: "var(--foreground)",
              textDecoration: "none",
              fontWeight: 900,
            }}
          >
            ← Back to Users
          </a>
        </div>
      </div>
    </main>
  );
}