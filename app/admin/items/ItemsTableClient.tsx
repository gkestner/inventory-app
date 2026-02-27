// app/admin/items/ItemsTableClient.tsx
"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

type Vendor = "SUCCESS_PLUS" | "AMERICAN_PLUS";
function isCostPlusVendor(v: unknown): v is Vendor {
  return v === "SUCCESS_PLUS" || v === "AMERICAN_PLUS";
}

/** ---------- helpers (unchanged) ---------- */
function safeUrl(raw: string | null | undefined): string | null {
  const v = (raw || "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/].*)?$/i.test(v)) return `https://${v}`;
  return null;
}

async function safeJson(res: Response): Promise<unknown | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function getJsonErrorMessage(j: unknown): string | null {
  if (!j || typeof j !== "object") return null;
  const rec = j as Record<string, unknown>;
  const e = rec["error"];
  if (typeof e === "string" && e.trim()) return e;
  const reason = rec["reason"];
  if (typeof reason === "string" && reason.trim()) return reason;
  return null;
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

/** ---------- types ---------- */
type ItemRow = {
  id: string;
  sku: string;
  partNumber: string | null;
  vendor?: Vendor | null;
  name: string;
  description: string | null;
  category: string | null;
  cost: string | null;
  price: string | null;
  taxable: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;

  onHandQty?: number;
  orderedQty?: number;
  usedQty?: number;
  minQty?: number;

  manufacturer?: string | null;
  orderFrom?: string | null;
  webUrl?: string | null;
};

type Draft = {
  sku: string;
  partNumber: string;
  vendor: Vendor;
  name: string;
  description: string;
  category: string;

  manufacturer: string;
  orderFrom: string;
  webUrl: string;

  cost: string;
  price: string;

  taxable: boolean;
  active: boolean;
};

type FieldErrors = Partial<Record<keyof Draft, string>>;

function normalizeDraftFromRow(row: ItemRow): Draft {
  return {
    sku: row.sku,
    partNumber: row.partNumber ?? "",
    vendor: (row.vendor ?? "SUCCESS_PLUS") as Vendor,
    name: row.name ?? "",
    description: row.description ?? "",
    category: row.category ?? "",
    manufacturer: row.manufacturer ?? "",
    orderFrom: row.orderFrom ?? "",
    webUrl: row.webUrl ?? "",
    cost: row.cost ?? "",
    price: row.price ?? "",
    taxable: !!row.taxable,
    active: !!row.active,
  };
}

function isValidMoney(input: string): boolean {
  const v = input.trim();
  if (v === "") return true;
  return /^-?\d+(\.\d{0,2})?$/.test(v);
}

export default function ItemsTableClient({
  initialItems,
  createdSku,
  page,
  perPage,
  total: initialTotal,
  vendorFormulas,
}: {
  initialItems: ItemRow[];
  createdSku: string | null;
  page: number;
  perPage: number;
  total: number;
  vendorFormulas: Record<Vendor, string>;
}) {
  const [rows, setRows] = useState<ItemRow[]>(initialItems ?? []);
  const [total, setTotal] = useState<number>(initialTotal ?? 0);
  const [pageState, setPageState] = useState<number>(page ?? 1);
  const [perPageState, setPerPageState] = useState<number>(perPage ?? 25);

  // Search input
  const [qInput, setQInput] = useState<string>("");

  // Bulk
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function clearSelection() {
    setSelectedIds({});
    setBulkError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setErrors({});
    setSaveError(null);
  }

  // keep server snapshot authoritative on hard refresh
  useEffect(() => {
    setRows(initialItems ?? []);
    setTotal(initialTotal ?? 0);
    setPageState(page ?? 1);
    setPerPageState(perPage ?? 25);
    clearSelection();
    cancelEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialItems, initialTotal, page, perPage]);

  const totalPages = useMemo(() => {
    const tp = Math.ceil((total || 0) / (perPageState || 25));
    return Math.max(1, tp);
  }, [total, perPageState]);

  async function fetchSearch(nextQ: string, nextPage: number) {
    setBulkError(null);
    setBulkBusy(true);

    try {
      const q = nextQ.trim();
      const p = Math.max(1, Math.min(totalPages, nextPage));

      const url = `/api/admin/items/search?q=${encodeURIComponent(q)}&page=${p}&perPage=${perPageState}`;
      const res = await fetch(url, { method: "GET" });
      const j = await safeJson(res);

      if (!res.ok) throw new Error(getJsonErrorMessage(j) || (await res.text()) || `Search failed (${res.status})`);

      const rec = j as { total: number; items: ItemRow[]; page: number; perPage: number };
      setRows(rec.items ?? []);
      setTotal(rec.total ?? 0);
      setPageState(rec.page ?? p);
      setPerPageState(rec.perPage ?? perPageState);

      clearSelection();
      cancelEdit();
    } catch (err: unknown) {
      setBulkError(getErrorMessage(err, "Search failed."));
    } finally {
      setBulkBusy(false);
    }
  }

  // ✅ Debounced live-search: typing “bulb” or “hot bar” immediately filters
  useEffect(() => {
    const t = window.setTimeout(() => {
      fetchSearch(qInput, 1);
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  function goToPage(nextPage: number) {
    fetchSearch(qInput, nextPage);
  }

  function startEdit(row: ItemRow) {
    setSaveError(null);
    setErrors({});
    setEditingId(row.id);
    setDraft(normalizeDraftFromRow(row));
  }

  function validate(d: Draft): FieldErrors {
    const e: FieldErrors = {};
    if (!d.sku.trim()) e.sku = "SKU is required.";
    if (!d.name.trim()) e.name = "Name is required.";
    if (d.cost.trim() && !isValidMoney(d.cost)) e.cost = "Invalid money (max 2 decimals).";
    if (d.price.trim() && !isValidMoney(d.price)) e.price = "Invalid money (max 2 decimals).";

    const web = d.webUrl.trim();
    if (web && !safeUrl(web)) e.webUrl = "Invalid URL (use https://… or example.com).";
    return e;
  }

  async function saveEdit(id: string) {
    if (!draft) return;
    setSaveError(null);

    const e = validate(draft);
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: draft.sku.trim(),
          partNumber: draft.partNumber.trim() || null,
          vendor: draft.vendor,
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          category: draft.category.trim() || null,

          manufacturer: draft.manufacturer.trim() || null,
          orderFrom: draft.orderFrom.trim() || null,
          webUrl: draft.webUrl.trim() || null,

          cost: draft.cost.trim() || null,
          price: draft.price.trim() || null,

          taxable: !!draft.taxable,
          active: !!draft.active,
        }),
      });

      if (!res.ok) {
        const j = await safeJson(res);
        throw new Error(getJsonErrorMessage(j) || (await res.text()) || `PATCH failed (${res.status})`);
      }

      const updated: ItemRow = (await res.json()) as ItemRow;
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
      cancelEdit();
    } catch (err: unknown) {
      setSaveError(getErrorMessage(err, "Failed to save."));
    } finally {
      setSaving(false);
    }
  }

  const createdIndex = useMemo(() => {
    if (!createdSku) return -1;
    return rows.findIndex((r) => r.sku === createdSku);
  }, [rows, createdSku]);

  const allOnPageSelected = useMemo(() => {
    if (rows.length === 0) return false;
    return rows.every((r) => !!selectedIds[r.id]);
  }, [rows, selectedIds]);

  const anyOnPageSelected = useMemo(() => rows.some((r) => !!selectedIds[r.id]), [rows, selectedIds]);

  function toggleAllOnPage(next: boolean) {
    setSelectedIds((prev) => {
      const copy: Record<string, boolean> = { ...prev };
      for (const r of rows) copy[r.id] = next;
      return copy;
    });
  }

  const surface = "var(--card, var(--background))";
  const surface2 = "rgba(255,255,255,0.04)";
  const danger = "var(--danger, #b00020)";

  const COLS = 13;

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: surface }}>
      {bulkError ? (
        <div style={{ padding: 12, borderBottom: "1px solid var(--border)", color: danger }}>{bulkError}</div>
      ) : null}

      <div style={{ padding: 10, borderBottom: "1px solid var(--border)", background: surface }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            {(total ?? 0).toLocaleString()} results • page {pageState} / {totalPages}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              onClick={() => goToPage(pageState - 1)}
              disabled={pageState <= 1 || bulkBusy}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: surface,
                color: "var(--text)",
                cursor: pageState <= 1 || bulkBusy ? "not-allowed" : "pointer",
                opacity: pageState <= 1 || bulkBusy ? 0.6 : 1,
              }}
            >
              Prev
            </button>
            <button
              onClick={() => goToPage(pageState + 1)}
              disabled={pageState >= totalPages || bulkBusy}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: surface,
                color: "var(--text)",
                cursor: pageState >= totalPages || bulkBusy ? "not-allowed" : "pointer",
                opacity: pageState >= totalPages || bulkBusy ? 0.6 : 1,
              }}
            >
              Next
            </button>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search SKU, part #, name, category, manufacturer, orderFrom, web..."
            style={{
              width: "min(620px, 100%)",
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: surface,
              color: "var(--text)",
            }}
          />
          <button
            type="button"
            onClick={() => setQInput("")}
            disabled={bulkBusy}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: surface,
              color: "var(--text)",
              cursor: bulkBusy ? "not-allowed" : "pointer",
            }}
          >
            Clear
          </button>
          {bulkBusy ? <span style={{ fontSize: 12, opacity: 0.8 }}>Searching…</span> : null}
        </div>
      </div>

      {saveError ? (
        <div style={{ padding: 12, borderBottom: "1px solid var(--border)", color: danger }}>{saveError}</div>
      ) : null}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ width: 44, textAlign: "left", padding: 10, background: surface }}>
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allOnPageSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allOnPageSelected && anyOnPageSelected;
                  }}
                  onChange={(e) => toggleAllOnPage(e.target.checked)}
                  disabled={bulkBusy}
                />
              </th>

              {["SKU", "Part #", "Vendor", "Name", "Category", "On Hand", "Cost", "Price", "Taxable", "Active", "Updated", "Actions"].map(
                (h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: 10,
                      fontWeight: 700,
                      fontSize: 13,
                      color: "var(--text)",
                      whiteSpace: "nowrap",
                      background: surface,
                    }}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, idx) => {
              const isEditing = editingId === row.id;
              const isCreated = createdIndex === idx;
              const isSelected = !!selectedIds[row.id];

              const web = safeUrl(row.webUrl);

              return (
                <Fragment key={row.id}>
                  <tr style={{ borderBottom: "1px solid var(--border)", background: isCreated ? surface2 : "transparent" }}>
                    <td style={{ padding: 10 }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => setSelectedIds((prev) => ({ ...prev, [row.id]: e.target.checked }))}
                        aria-label={`Select ${row.sku}`}
                        disabled={bulkBusy}
                      />
                    </td>

                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {isEditing ? (
                        <input
                          value={draft?.sku ?? ""}
                          onChange={(e) => setDraft((d) => (d ? { ...d, sku: e.target.value } : d))}
                          style={{
                            width: 140,
                            padding: "6px 8px",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            background: surface,
                            color: "var(--text)",
                          }}
                        />
                      ) : (
                        row.sku
                      )}
                      {errors.sku ? <div style={{ fontSize: 12, color: danger }}>{errors.sku}</div> : null}
                    </td>

                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {isEditing ? (
                        <input
                          value={draft?.partNumber ?? ""}
                          onChange={(e) => setDraft((d) => (d ? { ...d, partNumber: e.target.value } : d))}
                          style={{
                            width: 140,
                            padding: "6px 8px",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            background: surface,
                            color: "var(--text)",
                          }}
                        />
                      ) : (
                        row.partNumber ?? ""
                      )}
                    </td>

                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {isEditing ? (
                        <select
                          value={draft?.vendor ?? "SUCCESS_PLUS"}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, vendor: e.target.value === "AMERICAN_PLUS" ? "AMERICAN_PLUS" : "SUCCESS_PLUS" } : d
                            )
                          }
                          style={{
                            width: 160,
                            padding: "6px 8px",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            background: surface,
                            color: "var(--text)",
                          }}
                        >
                          <option value="SUCCESS_PLUS">Success Plus</option>
                          <option value="AMERICAN_PLUS">American Plus</option>
                        </select>
                      ) : (row.vendor ?? "SUCCESS_PLUS") === "AMERICAN_PLUS" ? (
                        "American Plus"
                      ) : (
                        "Success Plus"
                      )}
                    </td>

                    <td style={{ padding: 10, minWidth: 220 }}>
                      {isEditing ? (
                        <input
                          value={draft?.name ?? ""}
                          onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                          style={{
                            width: 220,
                            padding: "6px 8px",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            background: surface,
                            color: "var(--text)",
                          }}
                        />
                      ) : (
                        row.name
                      )}
                      {errors.name ? <div style={{ fontSize: 12, color: danger }}>{errors.name}</div> : null}
                    </td>

                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {isEditing ? (
                        <input
                          value={draft?.category ?? ""}
                          onChange={(e) => setDraft((d) => (d ? { ...d, category: e.target.value } : d))}
                          style={{
                            width: 160,
                            padding: "6px 8px",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            background: surface,
                            color: "var(--text)",
                          }}
                        />
                      ) : (
                        row.category ?? ""
                      )}
                    </td>

                    <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 800 }}>
                      {typeof row.onHandQty === "number" ? row.onHandQty.toLocaleString() : "—"}
                    </td>

                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {isEditing ? (
                        <input
                          value={draft?.cost ?? ""}
                          onChange={(e) => setDraft((d) => (d ? { ...d, cost: e.target.value } : d))}
                          style={{
                            width: 110,
                            padding: "6px 8px",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            background: surface,
                            color: "var(--text)",
                          }}
                        />
                      ) : (
                        row.cost ?? ""
                      )}
                      {errors.cost ? <div style={{ fontSize: 12, color: danger }}>{errors.cost}</div> : null}
                    </td>

                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {isEditing ? (
                        <input
                          value={draft?.price ?? ""}
                          onChange={(e) => setDraft((d) => (d ? { ...d, price: e.target.value } : d))}
                          style={{
                            width: 110,
                            padding: "6px 8px",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            background: surface,
                            color: "var(--text)",
                          }}
                        />
                      ) : (
                        row.price ?? ""
                      )}
                      {errors.price ? <div style={{ fontSize: 12, color: danger }}>{errors.price}</div> : null}
                    </td>

                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{row.taxable ? "Yes" : "No"}</td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{row.active ? "Yes" : "No"}</td>

                    <td style={{ padding: 10, whiteSpace: "nowrap", fontSize: 12, opacity: 0.85 }}>
                      {new Date(row.updatedAt).toLocaleString()}
                    </td>

                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {isEditing ? (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => saveEdit(row.id)}
                            disabled={saving}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 10,
                              border: "1px solid var(--border)",
                              background: surface,
                              color: "var(--text)",
                              cursor: saving ? "not-allowed" : "pointer",
                            }}
                          >
                            {saving ? "Saving..." : "Save"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            disabled={saving}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 10,
                              border: "1px solid var(--border)",
                              background: surface,
                              color: "var(--text)",
                              cursor: saving ? "not-allowed" : "pointer",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <button
                            onClick={() => startEdit(row)}
                            disabled={bulkBusy}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 10,
                              border: "1px solid var(--border)",
                              background: surface,
                              color: "var(--text)",
                              cursor: bulkBusy ? "not-allowed" : "pointer",
                              opacity: bulkBusy ? 0.7 : 1,
                            }}
                          >
                            Edit
                          </button>

                          <a
                            href={`/admin/items/${row.id}/inventory`}
                            style={{
                              display: "inline-block",
                              padding: "6px 10px",
                              borderRadius: 10,
                              border: "1px solid var(--border)",
                              background: surface,
                              color: "var(--text)",
                              textDecoration: "none",
                              fontWeight: 700,
                              lineHeight: 1.1,
                            }}
                          >
                            Inventory
                          </a>
                        </div>
                      )}
                    </td>
                  </tr>

                  <tr style={{ borderBottom: "1px solid var(--border)", background: isCreated ? surface2 : "transparent" }}>
                    <td colSpan={COLS} style={{ padding: "0 10px 10px 54px" }}>
                      <div style={{ fontSize: 12, opacity: 0.85, display: "flex", flexWrap: "wrap", gap: 12 }}>
                        <span>
                          <strong>Manufacturer:</strong> {(row.manufacturer ?? "").trim() || "—"}
                        </span>
                        <span>
                          <strong>Order From:</strong> {(row.orderFrom ?? "").trim() || "—"}
                        </span>
                        <span>
                          <strong>Used:</strong> {typeof row.usedQty === "number" ? row.usedQty : "—"}
                        </span>
                        <span>
                          <strong>Keep on hand:</strong> {typeof row.minQty === "number" ? row.minQty : "—"}
                        </span>
                        <span>
                          <strong>Web:</strong>{" "}
                          {web ? (
                            <a href={web} target="_blank" rel="noreferrer" style={{ textDecoration: "underline", color: "inherit" }}>
                              link
                            </a>
                          ) : (
                            "—"
                          )}
                        </span>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}

            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLS} style={{ padding: 16, opacity: 0.8 }}>
                  No results.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}