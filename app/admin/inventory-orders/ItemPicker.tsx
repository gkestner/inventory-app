"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type ItemPickRow = {
  id: string;
  sku: string;
  partNumber: string | null;
  name: string;
  category?: string | null;
  manufacturer?: string | null;
  orderFrom?: string | null;
};

function tokenize(q: string): string[] {
  const s = (q || "").trim().replace(/\s+/g, " ");
  if (!s) return [];
  return s
    .split(" ")
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

function variants(t: string): string[] {
  const lower = t.toLowerCase();
  const out = new Set<string>([lower]);
  if (lower.endsWith("s") && lower.length > 3) out.add(lower.slice(0, -1));
  else out.add(`${lower}s`);
  return Array.from(out);
}

function normalize(s: string | null | undefined): string {
  return (s || "").toLowerCase();
}

function makeSearchBlob(i: ItemPickRow): string {
  // Anything you want searchable goes here:
  // sku, partNumber, name, category, manufacturer, orderFrom
  return [
    i.sku,
    i.partNumber ?? "",
    i.name,
    i.category ?? "",
    i.manufacturer ?? "",
    i.orderFrom ?? "",
  ]
    .join(" | ")
    .toLowerCase();
}

function matches(itemBlob: string, query: string): boolean {
  const toks = tokenize(query);
  if (toks.length === 0) return true;

  // AND across tokens; each token can match via variants (bulb/bulbs)
  return toks.every((t) => {
    const vs = variants(t);
    return vs.some((v) => itemBlob.includes(v));
  });
}

export default function ItemPicker({
  name,
  items,
  defaultId = "",
  placeholder = "Search SKU, part #, name, category…",
}: {
  name: string; // hidden input name (itemId)
  items: ItemPickRow[];
  defaultId?: string;
  placeholder?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const [selectedId, setSelectedId] = useState<string>(defaultId);

  const byId = useMemo(() => {
    const m = new Map<string, ItemPickRow>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  // Build searchable blobs once
  const searchable = useMemo(() => {
    return items.map((it) => ({
      it,
      blob: makeSearchBlob(it),
    }));
  }, [items]);

  const results = useMemo(() => {
    const query = q.trim();
    const out = query
      ? searchable.filter(({ blob }) => matches(blob, query))
      : searchable;

    // keep it reasonable in the UI
    return out.slice(0, 40).map((x) => x.it);
  }, [q, searchable]);

  function label(it: ItemPickRow): string {
    const pn = it.partNumber ? ` • ${it.partNumber}` : "";
    const cat = it.category ? ` • ${it.category}` : "";
    return `${it.sku}${pn} • ${it.name}${cat}`;
  }

  function choose(it: ItemPickRow) {
    setSelectedId(it.id);
    setQ(label(it));
    setOpen(false);
  }

  // When we mount, if defaultId exists, show its label in the input
  useEffect(() => {
    if (!defaultId) return;
    const it = byId.get(defaultId);
    if (it) setQ(label(it));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultId]);

  // Close on outside click
  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  // Keyboard nav
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }

    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = results[activeIndex];
      if (it) choose(it);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  // If user types, clear selection until they pick again
  function onChange(v: string) {
    setQ(v);
    setSelectedId("");
    setOpen(true);
    setActiveIndex(0);
  }

  return (
    <div ref={rootRef} style={{ position: "relative", width: "100%" }}>
      {/* This is the value your server action reads */}
      <input type="hidden" name={name} value={selectedId} />

      <input
        ref={inputRef}
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid rgba(128,128,128,0.25)",
          background: "var(--background)",
          color: "var(--foreground)",
          outline: "none",
          fontSize: 14,
        }}
      />

      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
        {selected ? (
          <>
            Selected: <b>{selected.sku}</b>
            {selected.partNumber ? ` • ${selected.partNumber}` : ""} • {selected.name}
          </>
        ) : (
          <>Type to search, then click an item (or Enter) to select.</>
        )}
      </div>

      {open ? (
        <div
          style={{
            position: "absolute",
            zIndex: 30,
            left: 0,
            right: 0,
            marginTop: 8,
            borderRadius: 12,
            border: "1px solid rgba(128,128,128,0.25)",
            background: "var(--background)",
            boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
            overflow: "hidden",
            maxHeight: 360,
          }}
        >
          {results.length === 0 ? (
            <div style={{ padding: 12, opacity: 0.85 }}>No matches.</div>
          ) : (
            <div style={{ maxHeight: 360, overflow: "auto" }}>
              {results.map((it, idx) => {
                const active = idx === activeIndex;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => choose(it)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      border: "none",
                      borderBottom: "1px solid rgba(128,128,128,0.18)",
                      background: active ? "rgba(255,255,255,0.06)" : "transparent",
                      color: "var(--foreground)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>{it.sku}{it.partNumber ? ` • ${it.partNumber}` : ""}</div>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>
                      {it.name}
                      {it.category ? ` • ${it.category}` : ""}
                      {it.manufacturer ? ` • ${it.manufacturer}` : ""}
                      {it.orderFrom ? ` • ${it.orderFrom}` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}