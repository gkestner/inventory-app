"use client";

import { useEffect, useState } from "react";

type ReportRow = {
  id: string;
  name: string;
  onHandQty: number;
  location: string;
  link: string | null;
  partNumber: string | null;
};

type ReportResponse = {
  resetAt: string | null;
  total: number;
  hiddenCount: number;
  items: ReportRow[];
};

export default function ScannerCountUntouchedReportClient() {
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function loadReport() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/maintenance/scanner-count/report", {
        method: "GET",
        cache: "no-store",
      });
      const data = (await res.json()) as ReportResponse | { error?: string };
      if (!res.ok) throw new Error(("error" in data && data.error) || `Report failed (${res.status})`);
      setReport(data as ReportResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load report.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReport();
  }, []);

  async function resetReport() {
    setResetting(true);
    setError(null);

    try {
      const res = await fetch("/api/maintenance/scanner-count/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await res.json()) as ReportResponse | { error?: string };
      if (!res.ok) throw new Error(("error" in data && data.error) || `Reset failed (${res.status})`);
      setReport(data as ReportResponse);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Failed to reset report.");
    } finally {
      setResetting(false);
    }
  }

  async function hideItem(itemId: string) {
    setRemovingId(itemId);
    setError(null);

    try {
      const res = await fetch("/api/maintenance/scanner-count/report", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const data = (await res.json()) as ReportResponse | { error?: string };
      if (!res.ok) throw new Error(("error" in data && data.error) || `Remove failed (${res.status})`);
      setReport(data as ReportResponse);
    } catch (hideError) {
      setError(hideError instanceof Error ? hideError.message : "Failed to remove item from report.");
    } finally {
      setRemovingId((current) => (current === itemId ? null : current));
    }
  }

  const border = "1px solid var(--border)";

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section
        style={{
          border,
          borderRadius: 14,
          background: "var(--surface)",
          boxShadow: "var(--shadow)",
          padding: 16,
          display: "grid",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "var(--muted)", letterSpacing: 0.3 }}>
              NOT SCANNED / LOOKED UP REPORT
            </div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>
              {report
                ? report.hiddenCount > 0
                  ? `${report.items.length.toLocaleString()} shown of ${report.total.toLocaleString()} untouched parts`
                  : `${report.total.toLocaleString()} parts still untouched`
                : "Loading report..."}
            </div>
            <div style={{ display: "grid", gap: 4, color: "var(--muted)", fontSize: 13, lineHeight: 1.45 }}>
              <span>Tracks items you have not opened or saved on the scanner count page since the last reset.</span>
              <span>
                {report?.resetAt
                  ? `Last reset ${new Date(report.resetAt).toLocaleString()}`
                  : "No reset yet. Report includes every part not touched yet."}
              </span>
              {report?.hiddenCount ? <span>{`${report.hiddenCount.toLocaleString()} hidden until the next report reset.`}</span> : null}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void loadReport()}
              disabled={loading || resetting || Boolean(removingId)}
              style={{
                minHeight: 44,
                padding: "10px 14px",
                borderRadius: 12,
                border,
                background: "var(--surface-2)",
                color: "var(--foreground)",
                fontWeight: 900,
                cursor: loading || resetting || removingId ? "not-allowed" : "pointer",
              }}
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void resetReport()}
              disabled={resetting || Boolean(removingId)}
              style={{
                minHeight: 44,
                padding: "10px 14px",
                borderRadius: 12,
                border,
                background: "color-mix(in srgb, var(--brand) 16%, var(--surface))",
                color: "var(--foreground)",
                fontWeight: 900,
                cursor: resetting || removingId ? "not-allowed" : "pointer",
              }}
            >
              {resetting ? "Resetting..." : "Reset Report"}
            </button>
          </div>
        </div>

        {error ? (
          <div style={{ border: "1px solid rgba(239, 68, 68, 0.45)", background: "rgba(239, 68, 68, 0.12)", borderRadius: 12, padding: 12 }}>
            {error}
          </div>
        ) : null}

        {loading && !report ? (
          <div style={{ border, borderRadius: 12, padding: 14, background: "var(--surface)" }}>Loading report...</div>
        ) : null}

        {report && report.total === 0 ? (
          <div style={{ border: "1px solid rgba(34, 197, 94, 0.45)", background: "rgba(34, 197, 94, 0.12)", borderRadius: 12, padding: 12 }}>
            Everything has been scanned or looked up since the last reset.
          </div>
        ) : null}

        {report && report.total > 0 && report.items.length === 0 ? (
          <div style={{ border: "1px solid rgba(245, 158, 11, 0.45)", background: "rgba(245, 158, 11, 0.12)", borderRadius: 12, padding: 12 }}>
            All remaining untouched parts are hidden until the next report reset.
          </div>
        ) : null}
      </section>

      {report && report.items.length > 0 ? (
        <section style={{ border, borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", overflow: "auto" }}>
          <table style={{ width: "100%", minWidth: 940, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Item Name", "Qty On Hand", "Location", "Link", "Part Number", "Action"].map((heading) => (
                  <th key={heading} style={{ textAlign: "left", padding: "12px 14px", borderBottom: border, fontSize: 12, letterSpacing: 0.3, color: "var(--muted)" }}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.items.map((row) => (
                <tr key={row.id}>
                  <td style={{ padding: "12px 14px", borderBottom: border }}>{row.name}</td>
                  <td style={{ padding: "12px 14px", borderBottom: border }}>{row.onHandQty}</td>
                  <td style={{ padding: "12px 14px", borderBottom: border }}>{row.location}</td>
                  <td style={{ padding: "12px 14px", borderBottom: border }}>
                    {row.link ? (
                      <a href={row.link} target="_blank" rel="noreferrer" style={{ color: "var(--brand)", fontWeight: 800, textDecoration: "none" }}>
                        Open link
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td style={{ padding: "12px 14px", borderBottom: border }}>{row.partNumber || "-"}</td>
                  <td style={{ padding: "12px 14px", borderBottom: border }}>
                    <button
                      type="button"
                      onClick={() => void hideItem(row.id)}
                      disabled={loading || resetting || Boolean(removingId)}
                      style={{
                        minHeight: 38,
                        padding: "8px 12px",
                        borderRadius: 10,
                        border,
                        background: removingId === row.id ? "var(--surface-2)" : "color-mix(in srgb, var(--surface-2) 88%, var(--surface))",
                        color: "var(--foreground)",
                        fontWeight: 800,
                        whiteSpace: "nowrap",
                        cursor: loading || resetting || removingId ? "not-allowed" : "pointer",
                      }}
                    >
                      {removingId === row.id ? "Removing..." : "Hide until reset"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}