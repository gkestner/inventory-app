// app/admin/items/ItemsTableClient.tsx
"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

type Vendor = "SUCCESS_PLUS" | "AMERICAN_PLUS";
function isCostPlusVendor(v: unknown): v is Vendor {
  return v === "SUCCESS_PLUS" || v === "AMERICAN_PLUS";
}

// ✅ Safe client-side formula evaluator (numbers, + - * /, parentheses, "cost")
type Tok =
  | { t: "num"; v: number }
  | { t: "var" }
  | { t: "op"; v: "+" | "-" | "*" | "/" }
  | { t: "lp" }
  | { t: "rp" };

function isDigit(ch: string) {
  return ch >= "0" && ch <= "9";
}

function tokenizeFormula(input: string): Tok[] {
  const s = String(input ?? "").trim();
  if (!s) throw new Error("Formula is empty.");

  const out: Tok[] = [];
  let i = 0;

  while (i < s.length) {
    const c = s[i];

    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }

    if (c === "(") {
      out.push({ t: "lp" });
      i++;
      continue;
    }
    if (c === ")") {
      out.push({ t: "rp" });
      i++;
      continue;
    }

    if (c === "+" || c === "-" || c === "*" || c === "/") {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }

    if (isDigit(c) || c === ".") {
      let j = i;
      let seenDot = false;

      if (s[j] === ".") {
        seenDot = true;
        j++;
        if (j >= s.length || !isDigit(s[j])) throw new Error(`Invalid number near "." at position ${i + 1}.`);
      }

      while (j < s.length) {
        const ch = s[j];
        if (isDigit(ch)) {
          j++;
          continue;
        }
        if (ch === ".") {
          if (seenDot) break;
          seenDot = true;
          j++;
          continue;
        }
        break;
      }

      const raw = s.slice(i, j);
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`Invalid number: ${raw}`);
      out.push({ t: "num", v: n });
      i = j;
      continue;
    }

    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
      const raw = s.slice(i, j).toLowerCase();
      if (raw !== "cost") throw new Error(`Unknown identifier "${raw}". Only "cost" is allowed.`);
      out.push({ t: "var" });
      i = j;
      continue;
    }

    throw new Error(`Invalid character "${c}".`);
  }

  return out;
}

function normalizeUnary(tokens: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (const tok of tokens) {
    if (tok.t === "op" && tok.v === "-") {
      const prev = out[out.length - 1];
      const isUnary = !prev || prev.t === "op" || prev.t === "lp";
      if (isUnary) {
        out.push({ t: "num", v: 0 });
        out.push({ t: "op", v: "-" });
        continue;
      }
    }
    out.push(tok);
  }
  return out;
}

function prec(op: "+" | "-" | "*" | "/") {
  return op === "*" || op === "/" ? 2 : 1;
}

function toRpn(tokens: Tok[]): Tok[] {
  const out: Tok[] = [];
  const stack: Tok[] = [];

  for (const tok of tokens) {
    if (tok.t === "num" || tok.t === "var") {
      out.push(tok);
      continue;
    }

    if (tok.t === "op") {
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.t === "op" && prec(top.v) >= prec(tok.v)) out.push(stack.pop()!);
        else break;
      }
      stack.push(tok);
      continue;
    }

    if (tok.t === "lp") {
      stack.push(tok);
      continue;
    }

    if (tok.t === "rp") {
      let matched = false;
      while (stack.length) {
        const top = stack.pop()!;
        if (top.t === "lp") {
          matched = true;
          break;
        }
        out.push(top);
      }
      if (!matched) throw new Error("Mismatched parentheses.");
      continue;
    }
  }

  while (stack.length) {
    const top = stack.pop()!;
    if (top.t === "lp" || top.t === "rp") throw new Error("Mismatched parentheses.");
    out.push(top);
  }

  return out;
}

function evalRpn(rpn: Tok[], cost: number): number {
  const st: number[] = [];

  for (const tok of rpn) {
    if (tok.t === "num") {
      st.push(tok.v);
      continue;
    }
    if (tok.t === "var") {
      st.push(cost);
      continue;
    }
    if (tok.t === "op") {
      const b = st.pop();
      const a = st.pop();
      if (a === undefined || b === undefined) throw new Error("Invalid formula.");

      let r = 0;
      if (tok.v === "+") r = a + b;
      else if (tok.v === "-") r = a - b;
      else if (tok.v === "*") r = a * b;
      else {
        if (b === 0) throw new Error("Division by zero.");
        r = a / b;
      }

      if (!Number.isFinite(r)) throw new Error("Formula result is not finite.");
      st.push(r);
      continue;
    }

    throw new Error("Invalid token.");
  }

  if (st.length !== 1) throw new Error("Invalid formula.");
  return st[0];
}

function evaluateCostPlusFormula(formula: string, cost: number): number {
  if (!Number.isFinite(cost) || cost < 0) throw new Error("Cost must be a valid non-negative number.");
  const tokens = normalizeUnary(tokenizeFormula(formula));
  const rpn = toRpn(tokens);
  const result = evalRpn(rpn, cost);
  return Number(result.toFixed(4));
}

function parseMoneyToNumber(s: string): number | null {
  const v = (s || "").trim();
  if (!v) return null;
  const cleaned = v.replace(/\$/g, "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

type ItemRow = {
  id: string;
  sku: string;
  partNumber: string | null;
  vendor?: Vendor | null;
  name: string;
  description: string | null;
  category: string | null;
  unit?: string | null; // legacy / tolerated (not displayed)
  cost: string | null; // decimal string
  price: string | null; // decimal string
  taxable: boolean;
  active: boolean;
  createdAt: string; // ISO
  updatedAt: string; // ISO

  // qty fields (included by page.tsx)
  onHandQty?: number;
  orderedQty?: number;
  usedQty?: number;
  minQty?: number;

  // reference fields
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
  price: string; // manual when vendor formula blank

  taxable: boolean;
  active: boolean;
};

type FieldErrors = Partial<Record<keyof Draft, string>>;

type ItemVersion = {
  id: string;
  itemId: string;
  sku: string;
  partNumber: string | null;
  vendor?: Vendor | null;
  name: string;
  description: string | null;
  category: string | null;
  unit?: string | null; // legacy / tolerated

  manufacturer: string | null;
  orderFrom: string | null;
  webUrl: string | null;

  cost: string | null;
  price: string | null;

  taxable: boolean;
  active: boolean;
  version: number;
  createdAt: string; // ISO
};

function isValidMoney(input: string): boolean {
  const v = input.trim();
  if (v === "") return true;
  return /^-?\d+(\.\d{0,2})?$/.test(v);
}

function safeUrl(raw: string | null | undefined): string | null {
  const v = (raw || "").trim();
  if (!v) return null;

  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/].*)?$/i.test(v)) return `https://${v}`;
  return null;
}

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

function diffRowToVersion(current: ItemRow, v: ItemVersion) {
  const pairs: Array<{ field: string; current: string; version: string; changed: boolean }> = [];

  const get = {
    sku: () => current.sku,
    partNumber: () => current.partNumber ?? "",
    vendor: () => (current.vendor ?? "SUCCESS_PLUS") as string,
    name: () => current.name ?? "",
    description: () => current.description ?? "",
    category: () => current.category ?? "",

    manufacturer: () => (current.manufacturer ?? "") || "",
    orderFrom: () => (current.orderFrom ?? "") || "",
    webUrl: () => (current.webUrl ?? "") || "",

    cost: () => current.cost ?? "",
    price: () => current.price ?? "",

    taxable: () => String(current.taxable),
    active: () => String(current.active),
  };

  type K = keyof typeof get;

  const ver: Record<K, string> = {
    sku: v.sku,
    partNumber: v.partNumber ?? "",
    vendor: (v.vendor ?? "SUCCESS_PLUS") as string,
    name: v.name,
    description: v.description ?? "",
    category: v.category ?? "",

    manufacturer: v.manufacturer ?? "",
    orderFrom: v.orderFrom ?? "",
    webUrl: v.webUrl ?? "",

    cost: v.cost ?? "",
    price: v.price ?? "",

    taxable: String(v.taxable),
    active: String(v.active),
  };

  (Object.keys(get) as K[]).forEach((k) => {
    const c = get[k]();
    const vv = ver[k];
    pairs.push({ field: k, current: c, version: vv, changed: c !== vv });
  });

  return pairs;
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

function isItemVersionArray(v: unknown): v is ItemVersion[] {
  if (!Array.isArray(v)) return false;
  return v.every((x) => {
    if (!x || typeof x !== "object") return false;
    const o = x as Record<string, unknown>;
    return (
      typeof o.id === "string" &&
      typeof o.itemId === "string" &&
      typeof o.sku === "string" &&
      typeof o.name === "string" &&
      typeof o.taxable === "boolean" &&
      typeof o.active === "boolean" &&
      typeof o.version === "number" &&
      typeof o.createdAt === "string"
    );
  });
}

function readQFromLocation(): string {
  try {
    const p = new URLSearchParams(window.location.search);
    return (p.get("q") || "").trim();
  } catch {
    return "";
  }
}

/**
 * ✅ Client-side search behavior:
 * - split query into tokens (words)
 * - match ANY field on screen (sku, part#, name, category, vendor label, mfg, orderFrom, url, cost/price, flags, qty)
 * - partial matches allowed
 * - AND semantics: all tokens must be found somewhere in the row
 */
function tokenizeQuery(q: string): string[] {
  return (q || "")
    .toLowerCase()
    .trim()
    .split(/\s+/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

function rowSearchText(row: ItemRow): string {
  const vendorLabel =
    (row.vendor ?? "") === "AMERICAN_PLUS"
      ? "american plus"
      : (row.vendor ?? "") === "SUCCESS_PLUS"
        ? "success plus"
        : "";

  const onHandStr = typeof row.onHandQty === "number" ? String(row.onHandQty) : "";
  const usedStr = typeof row.usedQty === "number" ? String(row.usedQty) : "";
  const minStr = typeof row.minQty === "number" ? String(row.minQty) : "";
  const orderedStr = typeof row.orderedQty === "number" ? String(row.orderedQty) : "";

  const taxableStr = row.taxable ? "taxable yes" : "taxable no";
  const activeStr = row.active ? "active yes" : "active no";

  return [
    row.sku,
    row.partNumber ?? "",
    vendorLabel,
    row.name ?? "",
    row.category ?? "",
    row.description ?? "",
    row.manufacturer ?? "",
    row.orderFrom ?? "",
    row.webUrl ?? "",
    row.cost ?? "",
    row.price ?? "",
    taxableStr,
    activeStr,
    onHandStr,
    usedStr,
    minStr,
    orderedStr,
  ]
    .join(" ")
    .toLowerCase();
}

function rowMatchesQuery(row: ItemRow, q: string): boolean {
  const tokens = tokenizeQuery(q);
  if (tokens.length === 0) return true;
  const hay = rowSearchText(row);
  return tokens.every((tok) => hay.includes(tok));
}

export default function ItemsTableClient({
  initialItems,
  createdSku,
  page,
  perPage,
  total,
  vendorFormulas,
}: {
  initialItems: ItemRow[];
  createdSku: string | null;
  page: number;
  perPage: number;
  total: number;

  // ✅ ONE formula per vendor (passed from server)
  vendorFormulas: Record<Vendor, string>;
}) {
  const [rows, setRows] = useState<ItemRow[]>(initialItems ?? []);

  // Search UI value
  const [qInput, setQInput] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return readQFromLocation();
  });

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ✅ Cost-plus preview (vendor-level formula)
  const [formulaPreview, setFormulaPreview] = useState<string | null>(null);
  const [formulaError, setFormulaError] = useState<string | null>(null);

  // Multi-select + bulk actions (selection is page-scoped)
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // History / rollback
  const [historyForId, setHistoryForId] = useState<string | null>(null);
  const [versions, setVersions] = useState<ItemVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [selectedVersion, setSelectedVersion] = useState<ItemVersion | null>(null);
  const [rollbackConfirmText, setRollbackConfirmText] = useState("");
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  function clearSelection() {
    setSelectedIds({});
    setBulkError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setErrors({});
    setSaveError(null);
    setFormulaPreview(null);
    setFormulaError(null);
  }

  function closeHistory() {
    setHistoryForId(null);
    setVersions([]);
    setSelectedVersion(null);
    setRollbackConfirmText("");
    setRollbackError(null);
    setHistoryError(null);
    setHistoryLoading(false);
    setRollingBack(false);
  }

  // Treat new server snapshot as authoritative + prevent stale ops across pages
  useEffect(() => {
    setRows(initialItems ?? []);
    clearSelection();
    cancelEdit();
    closeHistory();
  }, [initialItems, page, perPage]);

  useEffect(() => {
    const onPop = () => setQInput(readQFromLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ✅ LIVE client-side filtered view (as you type)
  const viewRows = useMemo(() => {
    const q = (qInput || "").trim();
    if (!q) return rows;
    return rows.filter((r) => rowMatchesQuery(r, q));
  }, [rows, qInput]);

  // Selection should be scoped to what's visible on this page (after filter)
  const pageIdSet = useMemo(() => new Set(viewRows.map((r) => r.id)), [viewRows]);

  // Prune any selected ids not visible (covers filter + local deletes)
  useEffect(() => {
    setSelectedIds((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const id of Object.keys(prev)) {
        if (prev[id] && pageIdSet.has(id)) next[id] = true;
        else if (prev[id]) changed = true;
      }
      return changed ? next : prev;
    });
  }, [pageIdSet]);

  const totalPages = useMemo(() => {
    const tp = Math.ceil((total || 0) / (perPage || 25));
    return Math.max(1, tp);
  }, [total, perPage]);

  function goToPage(nextPage: number) {
    const p = new URLSearchParams(window.location.search);
    p.set("page", String(Math.max(1, Math.min(totalPages, nextPage))));
    window.location.assign(`${window.location.pathname}?${p.toString()}`);
  }

  function applySearch(nextQ: string) {
    // Optional server-side search (keeps URL in sync) — you can still press Enter / click Search
    const p = new URLSearchParams(window.location.search);
    const v = nextQ.trim();

    if (v) p.set("q", v);
    else p.delete("q");

    p.set("page", "1");
    window.location.assign(`${window.location.pathname}?${p.toString()}`);
  }

  // Keep the inventory search aligned with checkout search behavior by querying
  // the server as the user types (debounced), instead of only filtering this page.
  useEffect(() => {
    const nextQ = qInput.trim();

    const id = window.setTimeout(() => {
      const current = new URLSearchParams(window.location.search);
      const currentQ = (current.get("q") || "").trim();

      if (nextQ === currentQ) return;

      applySearch(nextQ);
    }, 350);

    return () => window.clearTimeout(id);
  }, [qInput]);
  
  const createdIndex = useMemo(() => {
    if (!createdSku) return -1;
    return viewRows.findIndex((r) => r.sku === createdSku);
  }, [viewRows, createdSku]);

  const selectedOnPage = useMemo(() => viewRows.filter((r) => !!selectedIds[r.id]).map((r) => r.id), [viewRows, selectedIds]);

  const allOnPageSelected = useMemo(() => {
    if (viewRows.length === 0) return false;
    return viewRows.every((r) => !!selectedIds[r.id]);
  }, [viewRows, selectedIds]);

  const anyOnPageSelected = useMemo(() => viewRows.some((r) => !!selectedIds[r.id]), [viewRows, selectedIds]);

  function toggleAllOnPage(next: boolean) {
    setSelectedIds((prev) => {
      const copy: Record<string, boolean> = { ...prev };
      for (const r of viewRows) copy[r.id] = next;
      return copy;
    });
  }

  async function archiveIds(ids: string[]) {
    if (ids.length === 0) return;
    setBulkError(null);
    setBulkBusy(true);

    try {
      const res = await fetch("/api/admin/items/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action: "archive" }),
      });

      if (!res.ok) {
        const j = await safeJson(res);
        throw new Error(getJsonErrorMessage(j) || (await res.text()) || `Archive failed (${res.status})`);
      }

      setRows((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, active: false } : r)));
      clearSelection();
    } catch (err: unknown) {
      setBulkError(getErrorMessage(err, "Archive failed."));
    } finally {
      setBulkBusy(false);
    }
  }

  async function deleteIds(ids: string[]) {
    if (ids.length === 0) return;

    const label = ids.length === 1 ? "this item" : `${ids.length} items`;
    const ok = window.confirm(`Permanently delete ${label}? This cannot be undone.`);
    if (!ok) return;

    setBulkError(null);
    setBulkBusy(true);

    try {
      // Single delete should hit the single-item DELETE route so we get accurate “blocked” reasons.
      if (ids.length === 1) {
        const id = ids[0];
        const res = await fetch(`/api/admin/items/${id}`, { method: "DELETE" });

        if (!res.ok) {
          const j = await safeJson(res);
          throw new Error(getJsonErrorMessage(j) || (await res.text()) || `Delete failed (${res.status})`);
        }

        setRows((prev) => prev.filter((r) => r.id !== id));
        clearSelection();

        if (editingId === id) cancelEdit();
        if (historyForId === id) closeHistory();

        return;
      }

      // Multi-delete stays bulk
      const res = await fetch("/api/admin/items/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action: "delete" }),
      });

      if (!res.ok) {
        const j = await safeJson(res);
        throw new Error(getJsonErrorMessage(j) || (await res.text()) || `Delete failed (${res.status})`);
      }

      setRows((prev) => prev.filter((r) => !ids.includes(r.id)));
      clearSelection();

      if (editingId && ids.includes(editingId)) cancelEdit();
      if (historyForId && ids.includes(historyForId)) closeHistory();
    } catch (err: unknown) {
      setBulkError(getErrorMessage(err, "Delete failed."));
    } finally {
      setBulkBusy(false);
    }
  }

  async function purgeIds(ids: string[]) {
    if (ids.length === 0) return;

    const label = ids.length === 1 ? "this item" : `${ids.length} items`;
    const promptText =
      `PURGE will permanently delete ${label} AND all related records (checkout tickets, invoice lines, inventory orders, item versions).\n\n` +
      `This is irreversible.\n\nType PURGE to confirm:`;
    const typed = window.prompt(promptText, "");
    if ((typed || "").trim().toUpperCase() !== "PURGE") return;

    setBulkError(null);
    setBulkBusy(true);

    try {
      const res = await fetch("/api/admin/items/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });

      if (!res.ok) {
        const j = await safeJson(res);
        throw new Error(getJsonErrorMessage(j) || (await res.text()) || `Purge failed (${res.status})`);
      }

      setRows((prev) => prev.filter((r) => !ids.includes(r.id)));
      clearSelection();

      if (editingId && ids.includes(editingId)) cancelEdit();
      if (historyForId && ids.includes(historyForId)) closeHistory();
    } catch (err: unknown) {
      setBulkError(getErrorMessage(err, "Purge failed."));
    } finally {
      setBulkBusy(false);
    }
  }

  function startEdit(row: ItemRow) {
    setSaveError(null);
    setErrors({});
    setEditingId(row.id);
    setDraft(normalizeDraftFromRow(row));
    setFormulaPreview(null);
    setFormulaError(null);
  }

  function validate(d: Draft): FieldErrors {
    const e: FieldErrors = {};
    if (!d.sku.trim()) e.sku = "SKU is required.";
    if (!d.name.trim()) e.name = "Name is required.";
    if (d.cost.trim() && !isValidMoney(d.cost)) e.cost = "Invalid money (max 2 decimals).";

    const vendorKey = (d.vendor ?? "SUCCESS_PLUS") as Vendor;
    const vendorFormula = (vendorFormulas?.[vendorKey] ?? "").trim();
    const usingCostPlus = isCostPlusVendor(vendorKey) && vendorFormula.length > 0;

    if (!usingCostPlus) {
      if (d.price.trim() && !isValidMoney(d.price)) e.price = "Invalid money (max 2 decimals).";
    }

    const web = d.webUrl.trim();
    if (web && !safeUrl(web)) e.webUrl = "Invalid URL (use https://… or a domain like example.com).";

    return e;
  }

  // ✅ cost-plus preview (vendor-level) when editing
  useEffect(() => {
    if (!draft) {
      setFormulaPreview(null);
      setFormulaError(null);
      return;
    }

    const vendorKey = (draft.vendor ?? "SUCCESS_PLUS") as Vendor;
    const vendorFormula = (vendorFormulas?.[vendorKey] ?? "").trim();

    const usingCostPlus = isCostPlusVendor(vendorKey) && vendorFormula.length > 0;
    if (!usingCostPlus) {
      setFormulaPreview(null);
      setFormulaError(null);
      return;
    }

    const c = parseMoneyToNumber(draft.cost || "");
    if (c === null) {
      setFormulaPreview(null);
      setFormulaError("Enter a valid Cost to preview.");
      return;
    }

    try {
      const computed = evaluateCostPlusFormula(vendorFormula, c);
      setFormulaPreview(computed.toFixed(2));
      setFormulaError(null);
    } catch (err: unknown) {
      setFormulaPreview(null);
      setFormulaError(getErrorMessage(err, "Invalid vendor formula."));
    }
  }, [draft, vendorFormulas]);

  async function saveEdit(id: string) {
    if (!draft) return;
    setSaveError(null);

    const e = validate(draft);
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSaving(true);
    try {
      const vendorKey = (draft.vendor ?? "SUCCESS_PLUS") as Vendor;
      const vendorFormula = (vendorFormulas?.[vendorKey] ?? "").trim();
      const usingCostPlus = isCostPlusVendor(vendorKey) && vendorFormula.length > 0;

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

          // ✅ If vendor formula is set, server computes price. Otherwise allow manual price.
          price: usingCostPlus ? null : draft.price.trim() || null,

          taxable: !!draft.taxable,
          active: !!draft.active,
        }),
      });

      if (!res.ok) {
        const j = await safeJson(res);
        throw new Error(getJsonErrorMessage(j) || (await res.text()) || `PATCH failed (${res.status})`);
      }

      const updated: ItemRow = (await res.json()) as ItemRow;

      const prevVendor = (rows.find((r) => r.id === id)?.vendor ?? "SUCCESS_PLUS") as Vendor;

      const shaped: ItemRow = {
        ...updated,
        cost: updated.cost ?? null,
        price: updated.price ?? null,
        partNumber: updated.partNumber ?? null,
        vendor: (updated.vendor ?? prevVendor) as Vendor,
        description: updated.description ?? null,
        category: updated.category ?? null,

        manufacturer: updated.manufacturer ?? null,
        orderFrom: updated.orderFrom ?? null,
        webUrl: updated.webUrl ?? null,

        onHandQty:
          typeof updated.onHandQty === "number"
            ? updated.onHandQty
            : rows.find((r) => r.id === id)?.onHandQty,
        orderedQty:
          typeof updated.orderedQty === "number"
            ? updated.orderedQty
            : rows.find((r) => r.id === id)?.orderedQty,
        usedQty:
          typeof updated.usedQty === "number"
            ? updated.usedQty
            : rows.find((r) => r.id === id)?.usedQty,
        minQty:
          typeof updated.minQty === "number"
            ? updated.minQty
            : rows.find((r) => r.id === id)?.minQty,

        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };

      setRows((prev) => prev.map((r) => (r.id === id ? shaped : r)));
      cancelEdit();
    } catch (err: unknown) {
      setSaveError(getErrorMessage(err, "Failed to save."));
    } finally {
      setSaving(false);
    }
  }

  async function openHistory(rowId: string) {
    setHistoryForId(rowId);
    setVersions([]);
    setSelectedVersion(null);
    setRollbackConfirmText("");
    setRollbackError(null);
    setHistoryError(null);

    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/admin/items/${rowId}/versions`, { method: "GET" });
      if (!res.ok) {
        const j = await safeJson(res);
        throw new Error(getJsonErrorMessage(j) || (await res.text()) || `GET versions failed (${res.status})`);
      }
      const raw = await safeJson(res);
      if (!isItemVersionArray(raw)) throw new Error("Invalid versions response");
      setVersions(raw);
    } catch (err: unknown) {
      setHistoryError(getErrorMessage(err, "Failed to load history."));
    } finally {
      setHistoryLoading(false);
    }
  }

  async function doRollback(rowId: string, versionNumber: number) {
    setRollbackError(null);

    if (!Number.isFinite(versionNumber) || versionNumber <= 0) {
      setRollbackError("Invalid version.");
      return;
    }

    if (rollbackConfirmText.trim().toUpperCase() !== "ROLLBACK") {
      setRollbackError('Type "ROLLBACK" to confirm.');
      return;
    }

    setRollingBack(true);
    try {
      const res = await fetch(`/api/admin/items/${rowId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: versionNumber }),
      });

      if (!res.ok) {
        const j = await safeJson(res);
        throw new Error(getJsonErrorMessage(j) || (await res.text()) || `Rollback failed (${res.status})`);
      }

      const updated: ItemRow = (await res.json()) as ItemRow;

      const shaped: ItemRow = {
        ...updated,
        cost: updated.cost ?? null,
        price: updated.price ?? null,
        partNumber: updated.partNumber ?? null,
        description: updated.description ?? null,
        category: updated.category ?? null,

        manufacturer: updated.manufacturer ?? null,
        orderFrom: updated.orderFrom ?? null,
        webUrl: updated.webUrl ?? null,

        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };

      setRows((prev) => prev.map((r) => (r.id === rowId ? shaped : r)));

      setRollbackConfirmText("");
      setSelectedVersion(null);
    } catch (err: unknown) {
      setRollbackError(getErrorMessage(err, "Rollback failed."));
    } finally {
      setRollingBack(false);
    }
  }

  const activeRow = useMemo(() => {
    if (!historyForId) return null;
    return rows.find((r) => r.id === historyForId) ?? null;
  }, [historyForId, rows]);

  // Theme-safe surface fallbacks
  const surface = "var(--card, var(--background))";
  const surface2 = "rgba(255,255,255,0.04)";
  const danger = "var(--danger, #b00020)";

  const used = (row: ItemRow) => (typeof row.usedQty === "number" ? row.usedQty : null);
  const keep = (row: ItemRow) => (typeof row.minQty === "number" ? row.minQty : null);
  const onHand = (row: ItemRow) => (typeof row.onHandQty === "number" ? row.onHandQty : null);

  // Column count (keep in sync with <thead> and colSpan below)
  const COLS = 13;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
        background: surface,
      }}
    >
      {/* Global bulk error banner */}
      {bulkError ? (
        <div style={{ padding: 12, borderBottom: "1px solid var(--border)", color: danger, background: surface }}>
          {bulkError}
        </div>
      ) : null}

      {/* Bulk actions strip */}
      {selectedOnPage.length > 0 ? (
        <div
          style={{
            padding: 10,
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            background: surface2,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800 }}>{selectedOnPage.length} selected</div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => archiveIds(selectedOnPage)}
              disabled={bulkBusy}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: surface,
                color: "var(--text)",
                cursor: bulkBusy ? "not-allowed" : "pointer",
                fontWeight: 900,
              }}
            >
              {bulkBusy ? "Working..." : "Archive Selected"}
            </button>

            <button
              onClick={() => deleteIds(selectedOnPage)}
              disabled={bulkBusy}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: `1px solid ${danger}`,
                background: surface,
                color: danger,
                cursor: bulkBusy ? "not-allowed" : "pointer",
                fontWeight: 900,
              }}
              title="Delete selected (may be blocked by audit references)"
            >
              {bulkBusy ? "Working..." : "Delete Selected"}
            </button>

            <button
              onClick={() => purgeIds(selectedOnPage)}
              disabled={bulkBusy}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: `2px solid ${danger}`,
                background: surface,
                color: danger,
                cursor: bulkBusy ? "not-allowed" : "pointer",
                fontWeight: 950,
              }}
              title="PURGE selected (irreversible; deletes related tickets/orders/versions)"
            >
              {bulkBusy ? "Working..." : "PURGE Selected"}
            </button>

            <button
              onClick={clearSelection}
              disabled={bulkBusy}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: surface,
                color: "var(--text)",
                cursor: bulkBusy ? "not-allowed" : "pointer",
              }}
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

      {/* Pagination + search strip */}
      <div style={{ padding: 10, borderBottom: "1px solid var(--border)", background: surface }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            {(total ?? 0).toLocaleString()} results • page {page ?? 1} / {Math.max(1, Math.ceil((total || 0) / (perPage || 25)))}
            {qInput.trim() ? (
              <>
                {" "}
                • showing <b>{viewRows.length}</b> on this page
              </>
            ) : null}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: surface,
                color: "var(--text)",
                cursor: page <= 1 ? "not-allowed" : "pointer",
                opacity: page <= 1 ? 0.6 : 1,
              }}
            >
              Prev
            </button>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= Math.max(1, Math.ceil((total || 0) / (perPage || 25)))}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: surface,
                color: "var(--text)",
                cursor: page >= Math.max(1, Math.ceil((total || 0) / (perPage || 25))) ? "not-allowed" : "pointer",
                opacity: page >= Math.max(1, Math.ceil((total || 0) / (perPage || 25))) ? 0.6 : 1,
              }}
            >
              Next
            </button>
          </div>
        </div>

        {/* ✅ Live filter as you type. Submit still does optional server-side search (URL sync). */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            applySearch(qInput);
          }}
          style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
        >
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search SKU, part #, name, category, vendor, mfg, order from…"
            style={{
              width: "min(520px, 100%)",
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: surface,
              color: "var(--text)",
            }}
          />
          <button
            type="submit"
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: surface,
              color: "var(--text)",
              cursor: "pointer",
              fontWeight: 900,
            }}
            title="Optional: reload page with server-side q param"
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => {
              setQInput("");
              // also clear URL q if present
              applySearch("");
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: surface,
              color: "var(--text)",
              cursor: "pointer",
            }}
            title="Clear search"
          >
            Clear
          </button>
        </form>
      </div>

      {saveError ? (
        <div style={{ padding: 12, borderBottom: "1px solid var(--border)", color: danger }}>{saveError}</div>
      ) : null}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th
                style={{
                  width: 44,
                  textAlign: "left",
                  padding: 10,
                  fontWeight: 700,
                  fontSize: 13,
                  color: "var(--text)",
                  whiteSpace: "nowrap",
                  background: surface,
                }}
              >
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allOnPageSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allOnPageSelected && anyOnPageSelected;
                  }}
                  onChange={(e) => toggleAllOnPage(e.target.checked)}
                />
              </th>

              {[
                "SKU",
                "Part #",
                "Vendor",
                "Name",
                "Category",
                "On Hand",
                "Cost",
                "Price",
                "Taxable",
                "Active",
                "Updated",
                "Actions",
              ].map((h) => (
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
              ))}
            </tr>
          </thead>

          <tbody>
            {viewRows.map((row, idx) => {
              const isEditing = editingId === row.id;
              const isCreated = createdIndex === idx;
              const isSelected = !!selectedIds[row.id];

              const mfg = (row.manufacturer ?? "").trim();
              const orderFrom = (row.orderFrom ?? "").trim();
              const web = safeUrl(row.webUrl);

              const oh = onHand(row);

              const detailText = {
                manufacturer: mfg || "—",
                orderFrom: orderFrom || "—",
                onHand: oh ?? "—",
                used: used(row) ?? "—",
                keep: keep(row) ?? "—",
                webLabel: web ? "link" : "—",
              };

              const currentVendor = (isEditing ? draft?.vendor : (row.vendor ?? "SUCCESS_PLUS")) as Vendor;
              const vendorFormula = (vendorFormulas?.[currentVendor] ?? "").trim();
              const editingUsesCostPlus = isEditing && isCostPlusVendor(currentVendor) && vendorFormula.length > 0;

              return (
                <Fragment key={row.id}>
                  <tr
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: isCreated ? surface2 : "transparent",
                    }}
                  >
                    <td style={{ padding: 10 }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) =>
                          setSelectedIds((prev) => ({
                            ...prev,
                            [row.id]: e.target.checked,
                          }))
                        }
                        aria-label={`Select ${row.sku}`}
                        disabled={bulkBusy}
                      />
                    </td>

                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {isEditing ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
                          {errors.sku ? <span style={{ fontSize: 12, color: danger }}>{errors.sku}</span> : null}
                        </div>
                      ) : (
                        row.sku
                      )}
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
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
                          {errors.name ? <span style={{ fontSize: 12, color: danger }}>{errors.name}</span> : null}
                        </div>
                      ) : (
                        row.name
                      )}
                    </td>

                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {isEditing ? (
                        <input
                          value={draft?.category ?? ""}
                          onChange={(e) => setDraft((d) => (d ? { ...d, category: e.target.value } : d))}
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
                        row.category ?? ""
                      )}
                    </td>

                    <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 800 }}>
                      {oh === null ? "—" : oh.toLocaleString()}
                    </td>

                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {isEditing ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
                          {errors.cost ? <span style={{ fontSize: 12, color: danger }}>{errors.cost}</span> : null}
                        </div>
                      ) : (
                        row.cost ?? ""
                      )}
                    </td>

                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {isEditing ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <input
                            value={draft?.price ?? ""}
                            onChange={(e) => setDraft((d) => (d ? { ...d, price: e.target.value } : d))}
                            disabled={editingUsesCostPlus}
                            title={editingUsesCostPlus ? "Price is computed from vendor cost-plus formula" : undefined}
                            style={{
                              width: 110,
                              padding: "6px 8px",
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              background: surface,
                              color: "var(--text)",
                              opacity: editingUsesCostPlus ? 0.65 : 1,
                              cursor: editingUsesCostPlus ? "not-allowed" : "text",
                            }}
                          />
                          {editingUsesCostPlus ? (
                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              Auto{formulaPreview ? ` • preview: $${formulaPreview}` : ""}
                            </span>
                          ) : null}
                          {!editingUsesCostPlus && errors.price ? <span style={{ fontSize: 12, color: danger }}>{errors.price}</span> : null}
                        </div>
                      ) : (
                        row.price ?? ""
                      )}
                    </td>

                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {isEditing ? (
                        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={!!draft?.taxable}
                            onChange={(e) => setDraft((d) => (d ? { ...d, taxable: e.target.checked } : d))}
                          />
                          <span>Tax</span>
                        </label>
                      ) : row.taxable ? (
                        "Yes"
                      ) : (
                        "No"
                      )}
                    </td>

                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      {isEditing ? (
                        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={!!draft?.active}
                            onChange={(e) => setDraft((d) => (d ? { ...d, active: e.target.checked } : d))}
                          />
                          <span>On</span>
                        </label>
                      ) : row.active ? (
                        "Yes"
                      ) : (
                        "No"
                      )}
                    </td>

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

                          <button
                            onClick={() => openHistory(row.id)}
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
                            History
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

                          <button
                            onClick={() => {
                              if (window.confirm(`Archive item ${row.sku}?`)) archiveIds([row.id]);
                            }}
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
                            title="Archive (sets active=false)"
                          >
                            Archive
                          </button>

                          <button
                            onClick={() => deleteIds([row.id])}
                            disabled={bulkBusy}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 10,
                              border: `1px solid ${danger}`,
                              background: surface,
                              color: danger,
                              cursor: bulkBusy ? "not-allowed" : "pointer",
                              opacity: bulkBusy ? 0.7 : 1,
                              fontWeight: 900,
                            }}
                            title="Delete (may be blocked by audit references)"
                          >
                            Delete
                          </button>

                          <button
                            onClick={() => purgeIds([row.id])}
                            disabled={bulkBusy}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 10,
                              border: `2px solid ${danger}`,
                              background: surface,
                              color: danger,
                              cursor: bulkBusy ? "not-allowed" : "pointer",
                              opacity: bulkBusy ? 0.7 : 1,
                              fontWeight: 950,
                            }}
                            title="PURGE (irreversible; deletes related tickets/orders/versions)"
                          >
                            PURGE
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>

                  {/* Detail row */}
                  <tr
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: isCreated ? surface2 : "transparent",
                    }}
                  >
                    <td colSpan={COLS} style={{ padding: "0 10px 10px 54px" }}>
                      {isEditing ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              <span style={{ fontSize: 12, opacity: 0.85 }}>
                                <strong>Manufacturer</strong>
                              </span>
                              <input
                                value={draft?.manufacturer ?? ""}
                                onChange={(e) => setDraft((d) => (d ? { ...d, manufacturer: e.target.value } : d))}
                                style={{
                                  width: 220,
                                  padding: "6px 8px",
                                  border: "1px solid var(--border)",
                                  borderRadius: 8,
                                  background: surface,
                                  color: "var(--text)",
                                }}
                              />
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              <span style={{ fontSize: 12, opacity: 0.85 }}>
                                <strong>Order From</strong>
                              </span>
                              <input
                                value={draft?.orderFrom ?? ""}
                                onChange={(e) => setDraft((d) => (d ? { ...d, orderFrom: e.target.value } : d))}
                                style={{
                                  width: 220,
                                  padding: "6px 8px",
                                  border: "1px solid var(--border)",
                                  borderRadius: 8,
                                  background: surface,
                                  color: "var(--text)",
                                }}
                              />
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 320px" }}>
                              <span style={{ fontSize: 12, opacity: 0.85 }}>
                                <strong>Web URL</strong>
                              </span>
                              <input
                                value={draft?.webUrl ?? ""}
                                onChange={(e) => setDraft((d) => (d ? { ...d, webUrl: e.target.value } : d))}
                                placeholder="https://example.com (or example.com)"
                                style={{
                                  width: "min(520px, 100%)",
                                  padding: "6px 8px",
                                  border: "1px solid var(--border)",
                                  borderRadius: 8,
                                  background: surface,
                                  color: "var(--text)",
                                }}
                              />
                              {errors.webUrl ? <span style={{ fontSize: 12, color: danger }}>{errors.webUrl}</span> : null}
                            </div>
                          </div>

                          {/* ✅ Vendor-level formula (read-only) */}
                          {isCostPlusVendor(currentVendor) && vendorFormula ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              <span style={{ fontSize: 12, opacity: 0.85 }}>
                                <strong>Vendor Cost-Plus Formula</strong>{" "}
                                <span style={{ opacity: 0.75 }}>(Success Plus / American Plus global setting)</span>
                              </span>
                              <div
                                style={{
                                  padding: "6px 8px",
                                  border: "1px solid var(--border)",
                                  borderRadius: 8,
                                  background: surface2,
                                  fontFamily: "monospace",
                                  width: "min(820px, 100%)",
                                }}
                              >
                                {vendorFormula}
                              </div>

                              {formulaError ? <span style={{ fontSize: 12, color: danger }}>{formulaError}</span> : null}
                              {!formulaError && formulaPreview ? (
                                <span style={{ fontSize: 12, opacity: 0.85 }}>Preview price: ${formulaPreview}</span>
                              ) : null}
                            </div>
                          ) : null}

                          <div style={{ fontSize: 12, opacity: 0.85, display: "flex", flexWrap: "wrap", gap: 12 }}>
                            <span>
                              <strong>On Hand:</strong> {detailText.onHand}
                            </span>
                            <span>
                              <strong>Used:</strong> {detailText.used}
                            </span>
                            <span>
                              <strong>Keep on hand:</strong> {detailText.keep}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, opacity: 0.85, display: "flex", flexWrap: "wrap", gap: 12 }}>
                          <span>
                            <strong>Manufacturer:</strong> {detailText.manufacturer}
                          </span>
                          <span>
                            <strong>Order From:</strong> {detailText.orderFrom}
                          </span>
                          <span>
                            <strong>On Hand:</strong> {detailText.onHand}
                          </span>
                          <span>
                            <strong>Used:</strong> {detailText.used}
                          </span>
                          <span>
                            <strong>Keep on hand:</strong> {detailText.keep}
                          </span>

                          {/* ✅ Show vendor formula used by this item */}
                          {isCostPlusVendor(currentVendor) && vendorFormula ? (
                            <span>
                              <strong>Cost Plus:</strong> <span style={{ fontFamily: "monospace" }}>{vendorFormula}</span>
                            </span>
                          ) : null}

                          <span>
                            <strong>Web:</strong>{" "}
                            {web ? (
                              <a href={web} target="_blank" rel="noreferrer" style={{ textDecoration: "underline", color: "inherit" }}>
                                {detailText.webLabel}
                              </a>
                            ) : (
                              "—"
                            )}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                </Fragment>
              );
            })}

            {viewRows.length === 0 ? (
              <tr>
                <td colSpan={COLS} style={{ padding: 16, opacity: 0.8 }}>
                  No results.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* History / Rollback Modal */}
      {historyForId ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
            zIndex: 50,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeHistory();
          }}
        >
          <div
            style={{
              width: "min(980px, 100%)",
              maxHeight: "85vh",
              overflow: "auto",
              borderRadius: 14,
              border: "1px solid var(--border)",
              background: surface,
              color: "var(--text)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
            }}
          >
            <div
              style={{
                padding: 14,
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div style={{ fontWeight: 900 }}>
                History: <span style={{ opacity: 0.85 }}>{activeRow?.sku ?? historyForId}</span>
              </div>

              <button
                onClick={closeHistory}
                style={{
                  marginLeft: "auto",
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: surface,
                  color: "var(--text)",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                Close
              </button>
            </div>

            <div style={{ padding: 14 }}>
              {historyError ? <div style={{ color: danger, marginBottom: 10 }}>{historyError}</div> : null}
              {historyLoading ? <div style={{ opacity: 0.85 }}>Loading…</div> : null}

              {!historyLoading && versions.length === 0 ? <div style={{ opacity: 0.85 }}>No versions found.</div> : null}

              {!historyLoading && versions.length > 0 && activeRow ? (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                    <div style={{ fontSize: 13, opacity: 0.85 }}>Select a version to compare and rollback (if needed).</div>

                    <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        value={rollbackConfirmText}
                        onChange={(e) => setRollbackConfirmText(e.target.value)}
                        placeholder='Type "ROLLBACK"'
                        style={{
                          width: 180,
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid var(--border)",
                          background: surface,
                          color: "var(--text)",
                        }}
                      />
                      <button
                        onClick={() => {
                          if (!selectedVersion) return;
                          doRollback(historyForId, selectedVersion.version);
                        }}
                        disabled={!selectedVersion || rollingBack}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 10,
                          border: `1px solid ${danger}`,
                          background: surface,
                          color: danger,
                          cursor: !selectedVersion || rollingBack ? "not-allowed" : "pointer",
                          fontWeight: 900,
                          opacity: !selectedVersion || rollingBack ? 0.65 : 1,
                        }}
                        title="Rollback to selected version"
                      >
                        {rollingBack ? "Rolling back..." : "Rollback"}
                      </button>
                    </div>
                  </div>

                  {rollbackError ? <div style={{ color: danger }}>{rollbackError}</div> : null}

                  <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 12 }}>
                    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                      <div
                        style={{
                          padding: 10,
                          borderBottom: "1px solid var(--border)",
                          background: surface2,
                          fontWeight: 900,
                        }}
                      >
                        Versions
                      </div>

                      <div>
                        {versions.map((v) => {
                          const selected = selectedVersion?.id === v.id;
                          return (
                            <button
                              key={v.id}
                              onClick={() => setSelectedVersion(v)}
                              style={{
                                width: "100%",
                                textAlign: "left",
                                padding: 10,
                                border: "none",
                                borderBottom: "1px solid var(--border)",
                                background: selected ? surface2 : "transparent",
                                color: "var(--text)",
                                cursor: "pointer",
                              }}
                            >
                              <div style={{ fontWeight: 900 }}>v{v.version}</div>
                              <div style={{ fontSize: 12, opacity: 0.85 }}>{new Date(v.createdAt).toLocaleString()}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                      <div
                        style={{
                          padding: 10,
                          borderBottom: "1px solid var(--border)",
                          background: surface2,
                          fontWeight: 900,
                        }}
                      >
                        Compare
                      </div>

                      <div style={{ padding: 10 }}>
                        {!selectedVersion ? (
                          <div style={{ opacity: 0.85 }}>Select a version to see differences.</div>
                        ) : (
                          <div style={{ display: "grid", gap: 8 }}>
                            {diffRowToVersion(activeRow, selectedVersion).map((p) => (
                              <div
                                key={p.field}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "160px 1fr 1fr",
                                  gap: 10,
                                  padding: "8px 10px",
                                  borderRadius: 10,
                                  border: "1px solid var(--border)",
                                  background: p.changed ? "rgba(255,165,0,0.08)" : "transparent",
                                }}
                              >
                                <div style={{ fontWeight: 900 }}>{p.field}</div>
                                <div style={{ fontSize: 12, opacity: 0.85 }}>
                                  <strong>Current:</strong> {p.current || "—"}
                                </div>
                                <div style={{ fontSize: 12, opacity: 0.85 }}>
                                  <strong>v{selectedVersion.version}:</strong> {p.version || "—"}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}