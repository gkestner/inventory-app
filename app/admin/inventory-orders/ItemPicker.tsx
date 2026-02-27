// app/admin/inventory-orders/ItemPicker.tsx
"use client";

import React from "react";

type ItemLite = {
  id: string;
  sku: string;
  partNumber: string | null;
  name: string;
  category?: string | null;
  manufacturer?: string | null;
  orderFrom?: string | null;
};

type Props = {
  name?: string;
  items: ItemLite[];
  defaultItemId?: string;
  placeholder?: string;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
};

function normalize(s: string): string {
  return (s ?? "")
    .normalize("NFKC")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .toLowerCase();
}

function tokenize(q: string): string[] {
  const n = normalize(q).trim().replace(/\s+/g, " ");
  if (!n) return [];
  return n.split(/[ \-]+/g).filter((t) => t.length >= 2);
}

function haystack(it: ItemLite): string {
  return normalize(
    [
      it.sku,
      it.partNumber ?? "",
      it.name,
      it.category ?? "",
      it.manufacturer ?? "",
      it.orderFrom ?? "",
    ].join(" ")
  );
}

export default function ItemPicker({
  name = "itemId",
  items,
  defaultItemId,
  placeholder = "Search SKU, part #, name, category, manufacturer…",
  style,
  inputStyle,
}: Props) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const defaultItem = React.useMemo(
    () => (defaultItemId ? items.find((x) => x.id === defaultItemId) ?? null : null),
    [defaultItemId, items]
  );

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState(() => {
    if (!defaultItem) return "";
    return `${defaultItem.sku}${
      defaultItem.partNumber ? ` • ${defaultItem.partNumber}` : ""
    } • ${defaultItem.name}`;
  });
  const [selectedId, setSelectedId] = React.useState<string>(
    defaultItem?.id ?? ""
  );
  const [activeIndex, setActiveIndex] = React.useState(0);

  const filtered = React.useMemo(() => {
    const toks = tokenize(query);
    if (toks.length === 0) return items.slice(0, 80);

    const out: ItemLite[] = [];
    for (const it of items) {
      const h = haystack(it);
      let ok = true;
      for (const t of toks) {
        if (!h.includes(t)) {
          ok = false;
          break;
        }
      }
      if (ok) out.push(it);
      if (out.length >= 120) break;
    }
    return out;
  }, [items, query]);

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    setActiveIndex((i) => Math.max(0, Math.min(i, filtered.length - 1)));
  }, [open, filtered.length]);

  function selectItem(it: ItemLite) {
    setSelectedId(it.id);
    setQuery(
      `${it.sku}${it.partNumber ? ` • ${it.partNumber}` : ""} • ${it.name}`
    );
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        isolation: "isolate",
        width: "100%",
        ...style,
      }}
    >
      <input type="hidden" name={name} value={selectedId} />

      <input
        ref={inputRef}
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setSelectedId("");
          setActiveIndex(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
            setOpen(true);
            return;
          }
          if (e.key === "Escape") {
            setOpen(false);
            return;
          }
          if (!open) return;

          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) =>
              Math.min(i + 1, filtered.length - 1)
            );
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) =>
              Math.max(i - 1, 0)
            );
          } else if (e.key === "Enter") {
            e.preventDefault();
            const it = filtered[activeIndex];
            if (it) selectItem(it);
          }
        }}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 12,
          border,
          background: surface,
          color: fg,
          outline: "none",
          fontSize: 14,
          boxSizing: "border-box",
          ...inputStyle,
        }}
      />

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            right: 0,
            zIndex: 99999,
            border,
            borderRadius: 12,
            background: surface,
            boxShadow: "0 12px 30px rgba(0,0,0,0.45)",
            overflow: "hidden",
          }}
        >
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 12, opacity: 0.7 }}>
                No matches.
              </div>
            ) : (
              filtered.map((it, idx) => {
                const active = idx === activeIndex;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => selectItem(it)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: "none",
                      padding: "10px 12px",
                      background: active
                        ? "rgba(255,255,255,0.06)"
                        : "transparent",
                      color: fg,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>
                      {it.sku}
                      {it.partNumber ? ` • ${it.partNumber}` : ""} •{" "}
                      {it.name}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        opacity: 0.7,
                        marginTop: 2,
                      }}
                    >
                      {[it.category, it.manufacturer, it.orderFrom]
                        .filter(Boolean)
                        .join(" • ")}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}