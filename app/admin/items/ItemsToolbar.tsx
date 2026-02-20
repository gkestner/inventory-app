// app/admin/items/ItemsToolbar.tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Draft = {
  sku: string;
  partNumber: string;
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

function isValidMoney(input: string): boolean {
  const v = input.trim();
  if (v === "") return true; // allow empty
  return /^-?\d+(\.\d{0,2})?$/.test(v);
}

function safeUrl(raw: string | null | undefined): string | null {
  const v = (raw || "").trim();
  if (!v) return null;

  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/].*)?$/i.test(v)) return `https://${v}`;
  return null;
}

function defaultDraft(): Draft {
  return {
    sku: "",
    partNumber: "",
    name: "",
    description: "",
    category: "",
    manufacturer: "",
    orderFrom: "",
    webUrl: "",
    cost: "",
    price: "",
    taxable: true,
    active: true,
  };
}

function validate(d: Draft): FieldErrors {
  const e: FieldErrors = {};
  if (!d.sku.trim()) e.sku = "SKU is required.";
  if (!d.name.trim()) e.name = "Name is required.";

  if (d.cost.trim() && !isValidMoney(d.cost)) e.cost = "Invalid money (max 2 decimals).";
  if (d.price.trim() && !isValidMoney(d.price)) e.price = "Invalid money (max 2 decimals).";

  const web = d.webUrl.trim();
  if (web && !safeUrl(web)) e.webUrl = "Invalid URL (use https://… or a domain like example.com).";

  return e;
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
  return typeof e === "string" && e.trim() ? e : null;
}

function getOkMessage(j: unknown): string | null {
  if (!j || typeof j !== "object") return null;
  const rec = j as Record<string, unknown>;
  const created = rec["created"];
  if (typeof created === "number") return `Imported ${created} item${created === 1 ? "" : "s"}.`;
  if (rec["ok"] === true) return "Import completed.";
  return null;
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

export default function ItemsToolbar() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [draft, setDraft] = useState<Draft>(() => defaultDraft());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // CSV Import UI state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importOk, setImportOk] = useState<string | null>(null);

  const active = sp.get("active") || "all";
  const perPage = sp.get("perPage") || "25";
  // Back-compat: older URLs may still have sort=unit. Treat it as name in UI.
  const sortRaw = sp.get("sort") || "updatedAt";
  const sort = sortRaw === "unit" ? "name" : sortRaw;
  const dir = sp.get("dir") || "desc";

  const exportHref = useMemo(() => {
    const p = new URLSearchParams(sp.toString());
    p.delete("createdSku");
    if (p.get("sort") === "unit") p.set("sort", "name");
    return `/api/admin/items/export?${p.toString()}`;
  }, [sp]);

  function setParam(key: string, value: string | null) {
    const p = new URLSearchParams(sp.toString());
    if (value === null || value === "") p.delete(key);
    else p.set(key, value);

    if (key === "active" || key === "perPage" || key === "sort" || key === "dir") {
      p.set("page", "1");
    }

    if (key !== "createdSku") p.delete("createdSku");
    if (p.get("sort") === "unit") p.set("sort", "name");

    router.push(`${pathname}?${p.toString()}`);
  }

  function updateDraft<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft((prev) => ({ ...prev, [k]: v }));
  }

  async function createItem() {
    setSaveError(null);

    const e = validate(draft);
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSaving(true);
    try {
      const res = await fetch("/api/admin/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: draft.sku.trim(),
          partNumber: draft.partNumber.trim() || null,
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
        throw new Error(getJsonErrorMessage(j) || (await res.text()) || `Create failed (${res.status})`);
      }

      const created = (await res.json()) as { sku?: unknown };
      const createdSku = typeof created?.sku === "string" ? created.sku : draft.sku.trim();

      setDraft(defaultDraft());
      setErrors({});

      const p = new URLSearchParams(sp.toString());
      p.set("createdSku", createdSku);
      if (p.get("sort") === "unit") p.set("sort", "name");
      router.push(`${pathname}?${p.toString()}`);
      router.refresh();
    } catch (err: unknown) {
      setSaveError(getErrorMessage(err, "Create failed."));
    } finally {
      setSaving(false);
    }
  }

  async function runImport(file: File) {
    setImportError(null);
    setImportOk(null);
    setImporting(true);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/admin/items/import", {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const j = await safeJson(res);
        throw new Error(getJsonErrorMessage(j) || (await res.text()) || `Import failed (${res.status})`);
      }

      const j = await safeJson(res);
      const okMsg = getOkMessage(j) || "Import completed.";

      setImportOk(okMsg);

      // Clear file input so same file can be uploaded again if needed
      if (fileInputRef.current) fileInputRef.current.value = "";

      // Refresh list (keeps filters/sort)
      router.refresh();
    } catch (err: unknown) {
      setImportError(getErrorMessage(err, "Import failed."));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 12,
        background: "var(--card, var(--background))",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>Items</strong>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, opacity: 0.9, display: "flex", alignItems: "center", gap: 6 }}>
            Active
            <select
              value={active}
              onChange={(e) => setParam("active", e.target.value)}
              style={{
                padding: "6px 8px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--card, var(--background))",
                color: "var(--text)",
              }}
            >
              <option value="all">All</option>
              <option value="true">Active</option>
              <option value="false">Archived</option>
            </select>
          </label>

          <label style={{ fontSize: 12, opacity: 0.9, display: "flex", alignItems: "center", gap: 6 }}>
            Per page
            <select
              value={perPage}
              onChange={(e) => setParam("perPage", e.target.value)}
              style={{
                padding: "6px 8px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--card, var(--background))",
                color: "var(--text)",
              }}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>

          <label style={{ fontSize: 12, opacity: 0.9, display: "flex", alignItems: "center", gap: 6 }}>
            Sort
            <select
              value={sort}
              onChange={(e) => setParam("sort", e.target.value)}
              style={{
                padding: "6px 8px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--card, var(--background))",
                color: "var(--text)",
              }}
            >
              <option value="updatedAt">Updated</option>
              <option value="createdAt">Created</option>
              <option value="sku">SKU</option>
              <option value="partNumber">Part #</option>
              <option value="name">Name</option>
              <option value="category">Category</option>
              {/* Unit removed */}
              <option value="cost">Cost</option>
              <option value="price">Price</option>
              <option value="taxable">Taxable</option>
              <option value="active">Active</option>
            </select>
          </label>

          <label style={{ fontSize: 12, opacity: 0.9, display: "flex", alignItems: "center", gap: 6 }}>
            Dir
            <select
              value={dir}
              onChange={(e) => setParam("dir", e.target.value)}
              style={{
                padding: "6px 8px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--card, var(--background))",
                color: "var(--text)",
              }}
            >
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
          </label>

          {/* CSV Import */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              if (!f) return;
              void runImport(f);
            }}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--card, var(--background))",
              color: "var(--text)",
              cursor: importing ? "not-allowed" : "pointer",
              fontWeight: 800,
            }}
            title="Import items from CSV (creates items + version snapshots atomically)"
          >
            {importing ? "Importing..." : "Import CSV"}
          </button>

          <a
            href={exportHref}
            style={{
              display: "inline-block",
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--card, var(--background))",
              color: "var(--text)",
              textDecoration: "none",
              fontWeight: 800,
            }}
          >
            Export CSV
          </a>
        </div>
      </div>

      {/* Import status */}
      {importError ? (
        <div style={{ marginTop: 10, color: "var(--danger, #b00020)", fontSize: 13 }}>{importError}</div>
      ) : null}
      {importOk ? <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>{importOk}</div> : null}

      {saveError ? (
        <div style={{ marginTop: 10, color: "var(--danger, #b00020)", fontSize: 13 }}>{saveError}</div>
      ) : null}

      {/* Create form */}
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.85 }}>
              <strong>SKU *</strong>
            </span>
            <input
              value={draft.sku}
              onChange={(e) => updateDraft("sku", e.target.value)}
              style={{
                width: 160,
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--card, var(--background))",
                color: "var(--text)",
              }}
            />
            {errors.sku ? <span style={{ fontSize: 12, color: "var(--danger, #b00020)" }}>{errors.sku}</span> : null}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.85 }}>
              <strong>Part #</strong>
            </span>
            <input
              value={draft.partNumber}
              onChange={(e) => updateDraft("partNumber", e.target.value)}
              style={{
                width: 160,
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--card, var(--background))",
                color: "var(--text)",
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.85 }}>
              <strong>Name *</strong>
            </span>
            <input
              value={draft.name}
              onChange={(e) => updateDraft("name", e.target.value)}
              style={{
                width: 260,
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--card, var(--background))",
                color: "var(--text)",
              }}
            />
            {errors.name ? <span style={{ fontSize: 12, color: "var(--danger, #b00020)" }}>{errors.name}</span> : null}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.85 }}>
              <strong>Category</strong>
            </span>
            <input
              value={draft.category}
              onChange={(e) => updateDraft("category", e.target.value)}
              style={{
                width: 160,
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--card, var(--background))",
                color: "var(--text)",
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.85 }}>
              <strong>Manufacturer</strong>
            </span>
            <input
              value={draft.manufacturer}
              onChange={(e) => updateDraft("manufacturer", e.target.value)}
              style={{
                width: 220,
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--card, var(--background))",
                color: "var(--text)",
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.85 }}>
              <strong>Order From</strong>
            </span>
            <input
              value={draft.orderFrom}
              onChange={(e) => updateDraft("orderFrom", e.target.value)}
              style={{
                width: 220,
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--card, var(--background))",
                color: "var(--text)",
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 360px" }}>
            <span style={{ fontSize: 12, opacity: 0.85 }}>
              <strong>Web URL</strong>
            </span>
            <input
              value={draft.webUrl}
              onChange={(e) => updateDraft("webUrl", e.target.value)}
              placeholder="https://example.com (or example.com)"
              style={{
                width: "min(560px, 100%)",
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--card, var(--background))",
                color: "var(--text)",
              }}
            />
            {errors.webUrl ? (
              <span style={{ fontSize: 12, color: "var(--danger, #b00020)" }}>{errors.webUrl}</span>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.85 }}>
              <strong>Cost</strong>
            </span>
            <input
              value={draft.cost}
              onChange={(e) => updateDraft("cost", e.target.value)}
              style={{
                width: 140,
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--card, var(--background))",
                color: "var(--text)",
              }}
            />
            {errors.cost ? <span style={{ fontSize: 12, color: "var(--danger, #b00020)" }}>{errors.cost}</span> : null}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.85 }}>
              <strong>Price</strong>
            </span>
            <input
              value={draft.price}
              onChange={(e) => updateDraft("price", e.target.value)}
              style={{
                width: 140,
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--card, var(--background))",
                color: "var(--text)",
              }}
            />
            {errors.price ? <span style={{ fontSize: 12, color: "var(--danger, #b00020)" }}>{errors.price}</span> : null}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 6 }}>
            <input type="checkbox" checked={draft.taxable} onChange={(e) => updateDraft("taxable", e.target.checked)} />
            <span style={{ fontSize: 13, fontWeight: 800 }}>Taxable</span>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 6 }}>
            <input type="checkbox" checked={draft.active} onChange={(e) => updateDraft("active", e.target.checked)} />
            <span style={{ fontSize: 13, fontWeight: 800 }}>Active</span>
          </label>

          <button
            onClick={createItem}
            disabled={saving}
            style={{
              marginLeft: "auto",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--card, var(--background))",
              color: "var(--text)",
              cursor: saving ? "not-allowed" : "pointer",
              fontWeight: 900,
            }}
          >
            {saving ? "Creating..." : "Create Item"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 520px" }}>
            <span style={{ fontSize: 12, opacity: 0.85 }}>
              <strong>Description</strong>
            </span>
            <input
              value={draft.description}
              onChange={(e) => updateDraft("description", e.target.value)}
              style={{
                width: "min(720px, 100%)",
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--card, var(--background))",
                color: "var(--text)",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}