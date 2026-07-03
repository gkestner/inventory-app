"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";

type SourceKey = "items" | "checkouts";
type FieldKind = "text" | "number" | "currency" | "date" | "datetime" | "boolean" | "url";
type FormatKey = "table" | "compact" | "grouped";
type SortDir = "asc" | "desc";
type ReportValue = string | number | boolean | null;
type ReportRow = Record<string, ReportValue>;

type FieldDefinition = {
  key: string;
  label: string;
  kind: FieldKind;
};

type PreviewResponse = {
  columns: FieldDefinition[];
  rows: ReportRow[];
  rowCount: number;
  generatedAt: string;
};

const SOURCE_FIELDS: Record<SourceKey, FieldDefinition[]> = {
  items: [
    { key: "sku", label: "SKU", kind: "text" },
    { key: "labelNumber", label: "Item #", kind: "number" },
    { key: "name", label: "Item Name", kind: "text" },
    { key: "partNumber", label: "Part Number", kind: "text" },
    { key: "manufacturer", label: "Manufacturer", kind: "text" },
    { key: "category", label: "Category", kind: "text" },
    { key: "vendor", label: "Vendor", kind: "text" },
    { key: "orderFrom", label: "Supplier", kind: "text" },
    { key: "cost", label: "Cost", kind: "currency" },
    { key: "price", label: "Price", kind: "currency" },
    { key: "onHandQty", label: "On Hand", kind: "number" },
    { key: "orderedQty", label: "Ordered", kind: "number" },
    { key: "usedQty", label: "Used", kind: "number" },
    { key: "minQty", label: "Min", kind: "number" },
    { key: "availableQty", label: "Available", kind: "number" },
    { key: "active", label: "Active", kind: "boolean" },
    { key: "webUrl", label: "Part Link", kind: "url" },
    { key: "createdAt", label: "Created", kind: "datetime" },
    { key: "updatedAt", label: "Updated", kind: "datetime" },
    { key: "lastCheckoutAt", label: "Last Checkout", kind: "datetime" },
    { key: "checkoutQty12Month", label: "Checkout Qty 12 Mo", kind: "number" },
  ],
  checkouts: [
    { key: "id", label: "Ticket ID", kind: "text" },
    { key: "createdAt", label: "Created", kind: "datetime" },
    { key: "status", label: "Status", kind: "text" },
    { key: "storeName", label: "Store", kind: "text" },
    { key: "createdByName", label: "Created By", kind: "text" },
    { key: "skuSnapshot", label: "SKU", kind: "text" },
    { key: "partNumberSnapshot", label: "Part Number", kind: "text" },
    { key: "nameSnapshot", label: "Item Name", kind: "text" },
    { key: "vendorSnapshot", label: "Vendor", kind: "text" },
    { key: "quantity", label: "Quantity", kind: "number" },
    { key: "costSnapshot", label: "Cost", kind: "currency" },
    { key: "lineCost", label: "Line Cost", kind: "currency" },
    { key: "priceSnapshot", label: "Price", kind: "currency" },
    { key: "needToOrderMore", label: "Need More", kind: "boolean" },
    { key: "invoiceId", label: "Invoice ID", kind: "text" },
    { key: "invoicedAt", label: "Invoiced", kind: "datetime" },
    { key: "voidedAt", label: "Voided", kind: "datetime" },
    { key: "note", label: "Note", kind: "text" },
  ],
};

const DEFAULT_FIELDS: Record<SourceKey, string[]> = {
  items: ["sku", "name", "partNumber", "manufacturer", "cost", "onHandQty", "lastCheckoutAt", "checkoutQty12Month"],
  checkouts: ["createdAt", "status", "storeName", "skuSnapshot", "partNumberSnapshot", "nameSnapshot", "quantity", "lineCost"],
};

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthBackInput(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().slice(0, 10);
}

function sourceLabel(source: SourceKey): string {
  return source === "checkouts" ? "Checkout Tickets" : "Items";
}

function formatValue(value: ReportValue, kind: FieldKind): string {
  if (value === null || value === undefined || value === "") return "-";
  if (kind === "boolean") return value ? "Yes" : "No";
  if (kind === "currency") {
    const n = Number(value);
    return Number.isFinite(n) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n) : "-";
  }
  if (kind === "date" || kind === "datetime") {
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return kind === "date" ? d.toLocaleDateString() : d.toLocaleString();
  }
  return String(value);
}

function csvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, columns: FieldDefinition[], rows: ReportRow[]) {
  const lines = [
    columns.map((column) => csvCell(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(formatValue(row[column.key] ?? null, column.kind))).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function moveValue(values: string[], index: number, direction: -1 | 1): string[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= values.length) return values;
  const next = values.slice();
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

function groupRows(rows: ReportRow[], fieldKey: string): Array<{ label: string; rows: ReportRow[] }> {
  const groups = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const label = String(row[fieldKey] ?? "Unassigned").trim() || "Unassigned";
    groups.set(label, [...(groups.get(label) ?? []), row]);
  }
  return Array.from(groups.entries())
    .map(([label, groupRowsValue]) => ({ label, rows: groupRowsValue }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

export default function CustomReportBuilder() {
  const [source, setSource] = useState<SourceKey>("items");
  const [selectedFields, setSelectedFields] = useState<string[]>(DEFAULT_FIELDS.items);
  const [sortField, setSortField] = useState<string>("sku");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [groupField, setGroupField] = useState<string>("");
  const [format, setFormat] = useState<FormatKey>("table");
  const [q, setQ] = useState<string>("");
  const [from, setFrom] = useState<string>(monthBackInput(12));
  const [to, setTo] = useState<string>(todayInput());
  const [active, setActive] = useState<"active" | "inactive" | "all">("active");
  const [limit, setLimit] = useState<number>(100);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const fields = SOURCE_FIELDS[source];
  const fieldMap = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);
  const selectedColumns = selectedFields.map((key) => fieldMap.get(key)).filter((field): field is FieldDefinition => Boolean(field));
  const groupedPreview = preview && groupField ? groupRows(preview.rows, groupField) : [];

  const border = "1px solid var(--border)";
  const panel: CSSProperties = {
    border,
    borderRadius: 10,
    background: "var(--surface)",
    padding: 14,
  };
  const fieldStyle: CSSProperties = {
    width: "100%",
    padding: "9px 10px",
    borderRadius: 8,
    border,
    background: "var(--surface-2)",
    color: "var(--foreground)",
    boxSizing: "border-box",
  };
  const button: CSSProperties = {
    padding: "9px 12px",
    borderRadius: 8,
    border,
    background: "var(--surface-2)",
    color: "var(--foreground)",
    fontWeight: 900,
    cursor: "pointer",
  };
  const primaryButton: CSSProperties = {
    ...button,
    background: "linear-gradient(160deg, var(--brand-2) 0%, var(--brand) 100%)",
    color: "var(--brand-contrast)",
  };

  function changeSource(nextSource: SourceKey) {
    setSource(nextSource);
    setSelectedFields(DEFAULT_FIELDS[nextSource]);
    setSortField(nextSource === "checkouts" ? "createdAt" : "sku");
    setSortDir(nextSource === "checkouts" ? "desc" : "asc");
    setGroupField("");
    setFormat("table");
    setPreview(null);
    setError("");
  }

  function toggleField(key: string) {
    setSelectedFields((current) => {
      if (current.includes(key)) return current.filter((value) => value !== key);
      return [...current, key];
    });
    setPreview(null);
  }

  async function runPreview() {
    if (selectedFields.length === 0) {
      setError("Choose at least one field.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/reports/custom-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          fields: selectedFields,
          sortField,
          sortDir,
          limit,
          filters: { q, from, to, active },
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as PreviewResponse;
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report preview failed.");
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    if (!preview) return;
    downloadCsv(`custom-${source}-report.csv`, preview.columns, preview.rows);
  }

  return (
    <main>
      <div style={{ maxWidth: 1480, margin: "0 auto", color: "var(--foreground)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Create Report</h1>
          <Link href="/admin/reports" style={{ ...button, textDecoration: "none" }}>
            Reports Hub
          </Link>
          <button type="button" onClick={runPreview} style={primaryButton} disabled={loading}>
            {loading ? "Building..." : "Build Preview"}
          </button>
          <button type="button" onClick={exportCsv} style={button} disabled={!preview}>
            Download CSV
          </button>
        </div>

        <section style={{ marginTop: 14, display: "grid", gridTemplateColumns: "360px minmax(0, 1fr)", gap: 14 }}>
          <div style={{ display: "grid", gap: 12, alignSelf: "start" }}>
            <div style={panel}>
              <h2 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 900 }}>Data Source</h2>
              <select value={source} onChange={(event) => changeSource(event.currentTarget.value as SourceKey)} style={fieldStyle}>
                <option value="items">Items</option>
                <option value="checkouts">Checkout Tickets</option>
              </select>
            </div>

            <div style={panel}>
              <h2 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 900 }}>Filters</h2>
              <div style={{ display: "grid", gap: 8 }}>
                <input value={q} onChange={(event) => setQ(event.currentTarget.value)} placeholder="Search text" style={fieldStyle} />
                {source === "items" ? (
                  <select value={active} onChange={(event) => setActive(event.currentTarget.value as "active" | "inactive" | "all")} style={fieldStyle}>
                    <option value="active">Active items</option>
                    <option value="inactive">Inactive items</option>
                    <option value="all">All items</option>
                  </select>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <input type="date" value={from} onChange={(event) => setFrom(event.currentTarget.value)} style={fieldStyle} />
                    <input type="date" value={to} onChange={(event) => setTo(event.currentTarget.value)} style={fieldStyle} />
                  </div>
                )}
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={limit}
                  onChange={(event) => setLimit(Math.max(1, Math.min(500, Number(event.currentTarget.value) || 100)))}
                  style={fieldStyle}
                />
              </div>
            </div>

            <div style={panel}>
              <h2 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 900 }}>Sort and Format</h2>
              <div style={{ display: "grid", gap: 8 }}>
                <select value={sortField} onChange={(event) => setSortField(event.currentTarget.value)} style={fieldStyle}>
                  <option value="">No sort</option>
                  {fields.map((field) => (
                    <option key={field.key} value={field.key}>
                      {field.label}
                    </option>
                  ))}
                </select>
                <select value={sortDir} onChange={(event) => setSortDir(event.currentTarget.value as SortDir)} style={fieldStyle}>
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
                <select value={format} onChange={(event) => setFormat(event.currentTarget.value as FormatKey)} style={fieldStyle}>
                  <option value="table">Table</option>
                  <option value="compact">Compact</option>
                  <option value="grouped">Grouped</option>
                </select>
                {format === "grouped" ? (
                  <select value={groupField} onChange={(event) => setGroupField(event.currentTarget.value)} style={fieldStyle}>
                    <option value="">Choose group field</option>
                    {selectedColumns.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <div style={panel}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>Fields and Column Order</h2>
                <div style={{ color: "var(--muted)", fontSize: 13 }}>
                  {selectedFields.length} selected from {sourceLabel(source)}
                </div>
              </div>

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "minmax(240px, 1fr) minmax(260px, 1fr)", gap: 12 }}>
                <div style={{ border, borderRadius: 10, padding: 10, background: "var(--surface-2)" }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "var(--muted)", marginBottom: 8 }}>Available Fields</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 6 }}>
                    {fields.map((field) => (
                      <label key={field.key} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                        <input type="checkbox" checked={selectedFields.includes(field.key)} onChange={() => toggleField(field.key)} />
                        <span>{field.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ border, borderRadius: 10, padding: 10, background: "var(--surface-2)" }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "var(--muted)", marginBottom: 8 }}>Report Column Placement</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {selectedFields.map((key, index) => {
                      const field = fieldMap.get(key);
                      if (!field) return null;
                      return (
                        <div key={key} style={{ display: "grid", gridTemplateColumns: "32px minmax(0, 1fr) auto auto auto", gap: 6, alignItems: "center" }}>
                          <span style={{ color: "var(--muted)", fontSize: 12 }}>{index + 1}</span>
                          <span style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{field.label}</span>
                          <button type="button" style={button} onClick={() => setSelectedFields((current) => moveValue(current, index, -1))} disabled={index === 0}>
                            Up
                          </button>
                          <button type="button" style={button} onClick={() => setSelectedFields((current) => moveValue(current, index, 1))} disabled={index === selectedFields.length - 1}>
                            Down
                          </button>
                          <button type="button" style={button} onClick={() => toggleField(key)}>
                            Remove
                          </button>
                        </div>
                      );
                    })}
                    {selectedFields.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13 }}>Select fields to build the report columns.</div> : null}
                  </div>
                </div>
              </div>
            </div>

            <div style={panel}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>Preview</h2>
                <div style={{ color: error ? "#ef4444" : "var(--muted)", fontSize: 13 }}>
                  {error || (preview ? `${preview.rowCount} rows generated ${new Date(preview.generatedAt).toLocaleTimeString()}` : "Build a preview to see the report.")}
                </div>
              </div>

              <div style={{ marginTop: 12, border, borderRadius: 10, overflowX: "auto" }}>
                {preview && preview.rows.length > 0 ? (
                  format === "grouped" && groupField ? (
                    <div style={{ display: "grid", gap: 10, padding: 10 }}>
                      {groupedPreview.map((group) => (
                        <details key={group.label} open style={{ border, borderRadius: 10, overflow: "hidden" }}>
                          <summary style={{ padding: "10px 12px", cursor: "pointer", fontWeight: 900, background: "var(--surface-2)" }}>
                            {group.label} ({group.rows.length})
                          </summary>
                          <ReportTable columns={preview.columns} rows={group.rows} compact={false} />
                        </details>
                      ))}
                    </div>
                  ) : (
                    <ReportTable columns={preview.columns} rows={preview.rows} compact={format === "compact"} />
                  )
                ) : (
                  <div style={{ padding: 16, color: "var(--muted)" }}>
                    {preview ? "No rows matched this report setup." : "No preview yet."}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function ReportTable({ columns, rows, compact }: { columns: FieldDefinition[]; rows: ReportRow[]; compact: boolean }) {
  const border = "1px solid var(--border)";
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: compact ? "auto" : "fixed" }}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} style={{ textAlign: "left", padding: compact ? 7 : 10, borderBottom: border, fontSize: 12, color: "var(--muted)" }}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={`row-${rowIndex}`} style={{ borderBottom: border }}>
            {columns.map((column) => {
              const value = row[column.key] ?? null;
              return (
                <td key={column.key} style={{ padding: compact ? 7 : 10, fontSize: compact ? 12 : 13, wordBreak: "break-word", verticalAlign: "top" }}>
                  {column.kind === "url" && value ? (
                    <a href={String(value)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)", fontWeight: 800 }}>
                      Open
                    </a>
                  ) : (
                    formatValue(value, column.kind)
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
