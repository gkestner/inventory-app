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
    console.error("Access Titles crashed:", error);
  }, [error]);

  return (
    <main style={{ padding: 16, background: "#ffffff", color: "#111111" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Access Titles crashed</h1>

        <pre
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: 12,
            border: "2px solid #e53935",
            background: "#fff5f5",
            whiteSpace: "pre-wrap",
          }}
        >
          {error?.message ?? "Unknown error"}
          {error?.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>

        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: 12,
            padding: "10px 14px",
            borderRadius: 10,
            border: "2px solid #1976d2",
            background: "#e3f2fd",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    </main>
  );
}