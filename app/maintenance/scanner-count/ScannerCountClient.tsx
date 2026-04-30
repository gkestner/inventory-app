"use client";

import { useEffect, useState } from "react";

import ItemPicker from "@/app/admin/inventory-orders/ItemPicker";

type SearchItem = {
  id: string;
  labelNumber: number | null;
  sku: string;
  partNumber: string | null;
  name: string;
  category: string | null;
  manufacturer: string | null;
  orderFrom: string | null;
};

type ChartPoint = {
  label: string;
  value: number;
};

type ItemDetail = {
  id: string;
  labelNumber: number | null;
  sku: string;
  partNumber: string | null;
  name: string;
  onHandQty: number;
  minQty: number;
  cost: string | null;
  location: string;
  shelf: string;
  bin: string;
  costHistory: ChartPoint[];
  usageHistory: ChartPoint[];
  updatedAt: string;
};

type Draft = {
  name: string;
  onHandQty: string;
  location: string;
  shelf: string;
  bin: string;
};

type SaveResponse = {
  item: {
    id: string;
    sku: string;
    name: string;
    onHandQty: number;
    location: string;
    shelf: string;
    bin: string;
    updatedAt: string;
  };
};

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
  items: ReportRow[];
};

function prettyCode(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}

function locationText(location: string, shelf: string, bin: string): string {
  const locLabel = location === "vault" ? "Vault" : `Loc ${prettyCode(location)}`;
  return `${locLabel} / Shelf ${prettyCode(shelf || "0")} / Bin ${prettyCode(bin || "0")}`;
}

function isDirty(detail: ItemDetail | null, draft: Draft | null): boolean {
  if (!detail || !draft) return false;
  return (
    draft.name.trim() !== detail.name ||
    draft.onHandQty.trim() !== String(detail.onHandQty) ||
    draft.location !== detail.location ||
    draft.shelf.trim() !== detail.shelf ||
    draft.bin.trim() !== detail.bin
  );
}

function buildPath(points: ChartPoint[], width: number, height: number, padding: number): string {
  if (points.length === 0) return "";

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;

  return points
    .map((point, index) => {
      const x = padding + (plotWidth * index) / Math.max(points.length - 1, 1);
      const y = padding + plotHeight - ((point.value - min) / span) * plotHeight;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function valueRange(points: ChartPoint[]): { min: number; max: number } {
  if (points.length === 0) return { min: 0, max: 0 };
  const values = points.map((point) => point.value);
  return { min: Math.min(...values), max: Math.max(...values) };
}

function MiniChart({
  title,
  subtitle,
  points,
  accent,
}: {
  title: string;
  subtitle: string;
  points: ChartPoint[];
  accent: string;
}) {
  const width = 640;
  const height = 180;
  const padding = 20;
  const path = buildPath(points, width, height, padding);
  const range = valueRange(points);

  return (
    <div className="scanner-chart-card">
      <div className="scanner-chart-head">
        <div>
          <div className="scanner-chart-title">{title}</div>
          <div className="scanner-chart-subtitle">{subtitle}</div>
        </div>
        <div className="scanner-chart-range">
          <span>Min {range.min.toLocaleString()}</span>
          <span>Max {range.max.toLocaleString()}</span>
        </div>
      </div>
      {points.length === 0 ? (
        <div className="scanner-chart-empty">No history available yet.</div>
      ) : (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} className="scanner-chart-svg" role="img" aria-label={title}>
            <defs>
              <linearGradient id={`scanner-chart-${title.replace(/\s+/g, "-").toLowerCase()}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
                <stop offset="100%" stopColor={accent} stopOpacity="0.03" />
              </linearGradient>
            </defs>
            <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="rgba(128,128,128,0.32)" strokeWidth="1" />
            <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="rgba(128,128,128,0.18)" strokeWidth="1" />
            <path d={`${path} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`} fill={`url(#scanner-chart-${title.replace(/\s+/g, "-").toLowerCase()})`} />
            <path d={path} fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            {points.map((point, index) => {
              const values = points.map((entry) => entry.value);
              const min = Math.min(...values);
              const max = Math.max(...values);
              const span = max - min || 1;
              const plotWidth = width - padding * 2;
              const plotHeight = height - padding * 2;
              const x = padding + (plotWidth * index) / Math.max(points.length - 1, 1);
              const y = padding + plotHeight - ((point.value - min) / span) * plotHeight;

              return (
                <g key={`${point.label}-${index}`}>
                  <circle cx={x} cy={y} r="3.5" fill={accent} />
                  {index === 0 || index === points.length - 1 || index === Math.floor(points.length / 2) ? (
                    <text x={x} y={height - 4} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} fontSize="11" fill="var(--muted)">
                      {point.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          <div className="scanner-chart-foot">
            {points.map((point) => (
              <span key={`${title}-${point.label}`} className="scanner-chart-pill">
                {point.label}: {point.value.toLocaleString()}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function ScannerCountClient({
  items,
  availableLocations,
}: {
  items: SearchItem[];
  availableLocations: string[];
}) {
  const [searchItems, setSearchItems] = useState<SearchItem[]>(items);
  const [pickerResetKey, setPickerResetKey] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openChart, setOpenChart] = useState<"cost" | "usage" | null>(null);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);
  const [resettingReport, setResettingReport] = useState(false);

  async function loadReport() {
    setReportLoading(true);
    setReportError(null);

    try {
      const res = await fetch("/api/maintenance/scanner-count/report", {
        method: "GET",
        cache: "no-store",
      });
      const data = (await res.json()) as ReportResponse | { error?: string };
      if (!res.ok) throw new Error(("error" in data && data.error) || `Report failed (${res.status})`);
      setReport(data as ReportResponse);
    } catch (loadError) {
      setReportError(loadError instanceof Error ? loadError.message : "Failed to load report.");
    } finally {
      setReportLoading(false);
    }
  }

  useEffect(() => {
    void loadReport();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDraft(null);
      setError(null);
      return;
    }

    let ignore = false;
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);
      setNotice(null);

      try {
        const res = await fetch(`/api/maintenance/scanner-count?itemId=${encodeURIComponent(selectedId)}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await res.json()) as ItemDetail | { error?: string };
        if (!res.ok) throw new Error(("error" in data && data.error) || `Load failed (${res.status})`);
        if (ignore) return;
        setDetail(data as ItemDetail);
        const loaded = data as ItemDetail;
        setDraft({
          name: loaded.name,
          onHandQty: String(loaded.onHandQty),
          location: loaded.location,
          shelf: loaded.shelf,
          bin: loaded.bin,
        });
        void loadReport();
      } catch (loadError) {
        if (ignore || (loadError instanceof DOMException && loadError.name === "AbortError")) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load item.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void load();

    return () => {
      ignore = true;
      controller.abort();
    };
  }, [selectedId]);

  async function saveChanges() {
    if (!detail || !draft) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/maintenance/scanner-count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: detail.id,
          name: draft.name,
          onHandQty: draft.onHandQty,
          location: draft.location,
          shelf: draft.shelf,
          bin: draft.bin,
        }),
      });
      const data = (await res.json()) as SaveResponse | { error?: string };
      if (!res.ok) throw new Error(("error" in data && data.error) || `Save failed (${res.status})`);

      const saved = (data as SaveResponse).item;
      setSearchItems((current) =>
        current.map((item) =>
          item.id === saved.id
            ? {
                ...item,
                name: saved.name,
                sku: saved.sku,
              }
            : item
        )
      );
      setSelectedId("");
      setDetail(null);
      setDraft(null);
      setOpenChart(null);
      setPickerResetKey((current) => current + 1);
      setNotice("Item saved. Ready for the next scan.");
      void loadReport();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save item.");
    } finally {
      setSaving(false);
    }
  }

  async function resetReport() {
    setResettingReport(true);
    setReportError(null);

    try {
      const res = await fetch("/api/maintenance/scanner-count/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await res.json()) as ReportResponse | { error?: string };
      if (!res.ok) throw new Error(("error" in data && data.error) || `Reset failed (${res.status})`);
      setReport(data as ReportResponse);
    } catch (resetError) {
      setReportError(resetError instanceof Error ? resetError.message : "Failed to reset report.");
    } finally {
      setResettingReport(false);
    }
  }

  return (
    <>
      <style>{`
        .scanner-count-shell {
          display: grid;
          gap: 14px;
        }

        .scanner-editor-card,
        .scanner-chart-wrap {
          border: 1px solid var(--border);
          border-radius: 18px;
          background: var(--surface);
          box-shadow: var(--shadow);
        }

        .scanner-editor-card {
          padding: 16px;
        }

        .scanner-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
          gap: 14px;
          align-items: start;
        }

        .scanner-fields {
          display: grid;
          gap: 12px;
        }

        .scanner-two-col {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .scanner-three-col {
          display: grid;
          grid-template-columns: 1.2fr 0.8fr 0.8fr;
          gap: 12px;
        }

        .scanner-label {
          display: grid;
          gap: 6px;
          min-width: 0;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.3px;
          color: var(--muted);
        }

        .scanner-field,
        .scanner-select {
          width: 100%;
          min-width: 0;
          min-height: 48px;
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid var(--border);
          background: color-mix(in srgb, var(--surface) 90%, white 10%);
          color: var(--foreground);
          font-size: 18px;
          font-weight: 700;
          box-sizing: border-box;
          overflow-wrap: normal;
          word-break: normal;
        }

        .scanner-readonly {
          min-height: 48px;
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid color-mix(in srgb, var(--brand) 16%, var(--border));
          background: color-mix(in srgb, var(--surface-2) 88%, white 12%);
          color: var(--foreground);
          font-size: 18px;
          font-weight: 800;
          display: flex;
          align-items: center;
        }

        .scanner-meta {
          display: grid;
          gap: 10px;
          padding: 14px;
          border-radius: 16px;
          border: 1px solid color-mix(in srgb, var(--brand) 18%, var(--border));
          background: linear-gradient(180deg, color-mix(in srgb, var(--surface-2) 92%, white 8%) 0%, var(--surface) 100%);
        }

        .scanner-meta-list {
          display: grid;
          gap: 8px;
        }

        .scanner-meta-row {
          display: flex;
          gap: 8px;
          justify-content: space-between;
          align-items: baseline;
          flex-wrap: wrap;
        }

        .scanner-meta-label {
          font-size: 12px;
          font-weight: 900;
          color: var(--muted);
          letter-spacing: 0.3px;
        }

        .scanner-meta-value {
          font-size: 18px;
          font-weight: 900;
          overflow-wrap: normal;
          word-break: normal;
        }

        .scanner-save-row {
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
        }

        .scanner-button {
          min-height: 48px;
          padding: 12px 18px;
          border-radius: 14px;
          border: 1px solid var(--border);
          background: color-mix(in srgb, var(--brand) 16%, var(--surface));
          color: var(--foreground);
          font-size: 16px;
          font-weight: 900;
          cursor: pointer;
        }

        .scanner-button:disabled {
          opacity: 0.55;
          cursor: default;
        }

        .scanner-notice,
        .scanner-error,
        .scanner-loading,
        .scanner-empty {
          border-radius: 14px;
          padding: 12px 14px;
          line-height: 1.5;
        }

        .scanner-notice {
          border: 1px solid rgba(34, 197, 94, 0.45);
          background: rgba(34, 197, 94, 0.12);
        }

        .scanner-error {
          border: 1px solid rgba(239, 68, 68, 0.45);
          background: rgba(239, 68, 68, 0.12);
        }

        .scanner-loading,
        .scanner-empty {
          border: 1px solid var(--border);
          background: var(--surface);
          box-shadow: var(--shadow);
        }

        .scanner-report-card {
          border: 1px solid var(--border);
          border-radius: 18px;
          background: var(--surface);
          box-shadow: var(--shadow);
          padding: 16px;
          display: grid;
          gap: 14px;
        }

        .scanner-report-head {
          display: flex;
          gap: 12px;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
        }

        .scanner-report-meta {
          display: grid;
          gap: 4px;
          font-size: 13px;
          color: var(--muted);
          line-height: 1.45;
        }

        .scanner-report-table-wrap {
          overflow-x: auto;
          border: 1px solid var(--border);
          border-radius: 14px;
        }

        .scanner-report-table {
          width: 100%;
          min-width: 760px;
          border-collapse: collapse;
        }

        .scanner-report-table th,
        .scanner-report-table td {
          padding: 12px 14px;
          border-bottom: 1px solid var(--border);
          text-align: left;
          vertical-align: top;
        }

        .scanner-report-table th {
          font-size: 12px;
          letter-spacing: 0.3px;
          color: var(--muted);
        }

        .scanner-report-table tr:last-child td {
          border-bottom: none;
        }

        .scanner-link {
          color: var(--brand);
          font-weight: 800;
          text-decoration: none;
        }

        .scanner-link:hover {
          text-decoration: underline;
        }

        .scanner-chart-wrap {
          padding: 16px;
          display: grid;
          gap: 12px;
        }

        .scanner-chart-toggle-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .scanner-chart-toggle {
          padding: 10px 14px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: var(--surface-2);
          color: var(--foreground);
          font-weight: 900;
          cursor: pointer;
        }

        .scanner-chart-toggle[data-open="true"] {
          background: color-mix(in srgb, var(--brand) 18%, var(--surface));
        }

        .scanner-chart-card {
          border: 1px solid color-mix(in srgb, var(--brand) 14%, var(--border));
          border-radius: 16px;
          padding: 14px;
          background: linear-gradient(180deg, color-mix(in srgb, var(--surface-2) 90%, white 10%) 0%, var(--surface) 100%);
          display: grid;
          gap: 12px;
        }

        .scanner-chart-head {
          display: flex;
          gap: 10px;
          justify-content: space-between;
          align-items: start;
          flex-wrap: wrap;
        }

        .scanner-chart-title {
          font-size: 18px;
          font-weight: 900;
        }

        .scanner-chart-subtitle {
          margin-top: 4px;
          font-size: 13px;
          color: var(--muted);
        }

        .scanner-chart-range {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          font-size: 12px;
          color: var(--muted);
          font-weight: 800;
        }

        .scanner-chart-svg {
          width: 100%;
          height: auto;
          display: block;
        }

        .scanner-chart-foot {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .scanner-chart-pill {
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid var(--border);
          font-size: 12px;
          font-weight: 800;
          background: color-mix(in srgb, var(--surface) 92%, white 8%);
        }

        .scanner-chart-empty {
          border: 1px dashed var(--border);
          border-radius: 12px;
          padding: 18px;
          color: var(--muted);
        }

        @media (max-width: 900px) {
          .scanner-grid {
            grid-template-columns: minmax(0, 1fr);
          }
        }

        @media (max-width: 720px) {
          .scanner-two-col,
          .scanner-three-col {
            grid-template-columns: minmax(0, 1fr);
          }

          .scanner-editor-card,
          .scanner-chart-wrap {
            padding: 14px;
          }

          .scanner-field,
          .scanner-select,
          .scanner-readonly {
            font-size: 16px;
          }
        }
      `}</style>

      <div className="scanner-count-shell">
        <section className="scanner-report-card">
          <div className="scanner-report-head">
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "var(--muted)", letterSpacing: 0.3 }}>
                NOT SCANNED / LOOKED UP REPORT
              </div>
              <div style={{ fontSize: 18, fontWeight: 900 }}>
                {report ? `${report.total.toLocaleString()} parts still untouched` : "Loading report..."}
              </div>
              <div className="scanner-report-meta">
                <span>Tracks items you have not opened or saved on this scanner count page since the last reset.</span>
                <span>
                  {report?.resetAt
                    ? `Last reset ${new Date(report.resetAt).toLocaleString()}`
                    : "No reset yet. Report includes every part not touched yet."}
                </span>
              </div>
            </div>

            <button className="scanner-button" type="button" onClick={() => void resetReport()} disabled={resettingReport}>
              {resettingReport ? "Resetting..." : "Reset Report"}
            </button>
          </div>

          {reportError ? <div className="scanner-error">{reportError}</div> : null}
          {reportLoading && !report ? <div className="scanner-loading">Loading report…</div> : null}
          {report && report.items.length === 0 ? (
            <div className="scanner-notice">Everything has been scanned or looked up since the last reset.</div>
          ) : null}
          {report && report.items.length > 0 ? (
            <div className="scanner-report-table-wrap">
              <table className="scanner-report-table">
                <thead>
                  <tr>
                    <th>Item Name</th>
                    <th>Qty On Hand</th>
                    <th>Location</th>
                    <th>Link</th>
                    <th>Part Number</th>
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.onHandQty}</td>
                      <td>{row.location}</td>
                      <td>
                        {row.link ? (
                          <a className="scanner-link" href={row.link} target="_blank" rel="noreferrer">
                            Open link
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>{row.partNumber || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section className="scanner-editor-card">
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "var(--muted)", letterSpacing: 0.3 }}>FIND PART</div>
            <ItemPicker
              key={pickerResetKey}
              name="scannerCountSelectedItem"
              items={searchItems}
              autoFocus
              placeholder="Scan QR / barcode or search ITEM#, SKU, part #, name, category, manufacturer…"
              onSelectedIdChange={setSelectedId}
              enableGlobalScannerCapture
              inputStyle={{
                width: "100%",
                minHeight: 54,
                padding: "14px 16px",
                borderRadius: 14,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--foreground)",
                fontSize: 17,
                fontWeight: 700,
              }}
            />
          </div>

          {!selectedId ? (
            <div className="scanner-empty" style={{ marginTop: 14 }}>
              Scan a label or choose a part above to start counting from this page.
            </div>
          ) : loading && !detail ? (
            <div className="scanner-loading" style={{ marginTop: 14 }}>
              Loading item details…
            </div>
          ) : detail && draft ? (
            <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
              {notice ? <div className="scanner-notice">{notice}</div> : null}
              {error ? <div className="scanner-error">{error}</div> : null}

              <div className="scanner-grid">
                <div className="scanner-fields">
                  <div className="scanner-two-col">
                    <label className="scanner-label">
                      PART NAME
                      <input
                        className="scanner-field"
                        value={draft.name}
                        onChange={(event) => setDraft((current) => (current ? { ...current, name: event.currentTarget.value } : current))}
                      />
                    </label>

                    <label className="scanner-label">
                      ON HAND STOCK
                      <input
                        className="scanner-field"
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={draft.onHandQty}
                        onChange={(event) => setDraft((current) => (current ? { ...current, onHandQty: event.currentTarget.value } : current))}
                      />
                    </label>
                  </div>

                  <div className="scanner-three-col">
                    <label className="scanner-label">
                      LOCATION
                      <select
                        className="scanner-select"
                        value={draft.location}
                        onChange={(event) => setDraft((current) => (current ? { ...current, location: event.currentTarget.value } : current))}
                      >
                        {availableLocations.map((location) => (
                          <option key={location} value={location}>
                            {location === "vault" ? "Vault" : `Loc ${prettyCode(location)}`}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="scanner-label">
                      SHELF
                      <input
                        className="scanner-field"
                        type="number"
                        min="0"
                        max="99"
                        inputMode="numeric"
                        value={draft.shelf}
                        onChange={(event) => setDraft((current) => (current ? { ...current, shelf: event.currentTarget.value } : current))}
                      />
                    </label>

                    <label className="scanner-label">
                      BIN
                      <input
                        className="scanner-field"
                        type="number"
                        min="0"
                        max="99"
                        inputMode="numeric"
                        value={draft.bin}
                        onChange={(event) => setDraft((current) => (current ? { ...current, bin: event.currentTarget.value } : current))}
                      />
                    </label>
                  </div>

                  <div className="scanner-two-col">
                    <label className="scanner-label">
                      CURRENT LOCATION
                      <div className="scanner-readonly">{locationText(detail.location, detail.shelf, detail.bin)}</div>
                    </label>

                    <label className="scanner-label">
                      COST
                      <div className="scanner-readonly">{detail.cost ? `$${detail.cost}` : "No cost set"}</div>
                    </label>
                  </div>

                  <div className="scanner-save-row">
                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={{ fontSize: 13, color: "var(--muted)" }}>
                        Save updates to stock, part name, and room location without leaving this screen.
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        Last updated {new Date(detail.updatedAt).toLocaleString()}
                      </div>
                    </div>
                    <button className="scanner-button" type="button" onClick={() => void saveChanges()} disabled={saving || !isDirty(detail, draft)}>
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>

                <aside className="scanner-meta">
                  <div style={{ fontSize: 12, fontWeight: 900, color: "var(--muted)", letterSpacing: 0.3 }}>PART SNAPSHOT</div>
                  <div className="scanner-meta-list">
                    <div className="scanner-meta-row">
                      <span className="scanner-meta-label">ITEM#</span>
                      <span className="scanner-meta-value">{detail.labelNumber ?? "—"}</span>
                    </div>
                    <div className="scanner-meta-row">
                      <span className="scanner-meta-label">SKU</span>
                      <span className="scanner-meta-value">{detail.sku}</span>
                    </div>
                    <div className="scanner-meta-row">
                      <span className="scanner-meta-label">PART #</span>
                      <span className="scanner-meta-value">{detail.partNumber || "—"}</span>
                    </div>
                    <div className="scanner-meta-row">
                      <span className="scanner-meta-label">MIN QTY</span>
                      <span className="scanner-meta-value">{detail.minQty}</span>
                    </div>
                    <div className="scanner-meta-row">
                      <span className="scanner-meta-label">EDIT TARGET</span>
                      <span className="scanner-meta-value">{locationText(draft.location, draft.shelf, draft.bin)}</span>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          ) : null}
        </section>

        {detail ? (
          <section className="scanner-chart-wrap">
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "var(--muted)", letterSpacing: 0.3 }}>READ-ONLY HISTORY</div>
              <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.45 }}>
                Tap a chart below to review recent movement without crowding the main counting controls.
              </div>
            </div>

            <div className="scanner-chart-toggle-row">
              <button
                type="button"
                className="scanner-chart-toggle"
                data-open={openChart === "cost"}
                onClick={() => setOpenChart((current) => (current === "cost" ? null : "cost"))}
              >
                Cost Over Time
              </button>
              <button
                type="button"
                className="scanner-chart-toggle"
                data-open={openChart === "usage"}
                onClick={() => setOpenChart((current) => (current === "usage" ? null : "usage"))}
              >
                Use Over Time
              </button>
            </div>

            {openChart === "cost" ? (
              <MiniChart
                title="Cost Over Time"
                subtitle="Recent ordered unit costs from inventory order history."
                points={detail.costHistory}
                accent="#0f766e"
              />
            ) : null}

            {openChart === "usage" ? (
              <MiniChart
                title="Use Over Time"
                subtitle="Net monthly usage from checkout history. Returns pull the line back down."
                points={detail.usageHistory}
                accent="#c2410c"
              />
            ) : null}
          </section>
        ) : null}
      </div>
    </>
  );
}