// app/admin/inventory-orders/ItemPicker.tsx
"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

  /**
   * Support BOTH names so your page can pass either one:
   * - defaultId (what your page.tsx currently uses)
   * - defaultItemId (what your old picker used)
   */
  defaultId?: string;
  defaultItemId?: string;

  placeholder?: string;
  style?: CSSProperties;
  inputStyle?: CSSProperties;
  onSelectedIdChange?: (id: string) => void;
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
  // split on spaces + hyphens so "SATCO-ESCENT" can be found by "satco" or "escent"
  return n.split(/[ \-]+/g).filter((t) => t.length >= 2);
}

function label(it: ItemLite): string {
  return `${it.sku}${it.partNumber ? ` • ${it.partNumber}` : ""} • ${it.name}`;
}

function haystack(it: ItemLite): string {
  return normalize([it.id, it.sku, it.partNumber ?? "", it.name, it.category ?? "", it.manufacturer ?? "", it.orderFrom ?? ""].join(" "));
}

type MenuPos = {
  top: number;
  left: number;
  width: number;
  placeAbove: boolean;
};

export default function ItemPicker({
  name = "itemId",
  items,
  defaultId,
  defaultItemId,
  placeholder = "Search ID, SKU, part #, name, category, manufacturer…",
  style,
  inputStyle,
  onSelectedIdChange,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const initialId = (defaultId ?? defaultItemId ?? "").trim();

  const defaultItem = useMemo(() => {
    if (!initialId) return null;
    return items.find((x) => x.id === initialId) ?? null;
  }, [initialId, items]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string>(() => (defaultItem ? label(defaultItem) : ""));
  const [selectedId, setSelectedId] = useState<string>(() => defaultItem?.id ?? "");
  const [activeIndex, setActiveIndex] = useState(0);

  const [mounted, setMounted] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);

  // If the URL filter changes (defaultId changes), update selection + input label.
  useEffect(() => {
    if (!defaultItem) {
      if (initialId === "") {
        setSelectedId("");
        setQuery("");
      }
      return;
    }
    setSelectedId(defaultItem.id);
    setQuery(label(defaultItem));
  }, [defaultItem, initialId]);

  const filtered = useMemo(() => {
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

  // Track mounting for createPortal safety.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on outside click (works even with portal, because we check rootRef + the menu container id).
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const root = rootRef.current;
      if (!root) return;

      const menuEl = document.getElementById(menuDomId);
      const target = e.target as Node | null;

      if (!target) return;

      const inRoot = root.contains(target);
      const inMenu = menuEl ? menuEl.contains(target) : false;

      if (!inRoot && !inMenu) setOpen(false);
    }

    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    setActiveIndex((i) => Math.max(0, Math.min(i, filtered.length - 1)));
  }, [open, filtered.length]);

  function selectItem(it: ItemLite) {
    setSelectedId(it.id);
    setQuery(label(it));
    setOpen(false);
    onSelectedIdChange?.(it.id);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // --- Portal positioning ---
  const menuDomId = useMemo(() => `itempicker-menu-${Math.random().toString(16).slice(2)}`, []);

  function computeMenuPos() {
    const el = inputRef.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const gap = 8;
    const maxMenuH = 320;

    const spaceBelow = window.innerHeight - r.bottom - gap;
    const spaceAbove = r.top - gap;

    const placeAbove = spaceBelow < 160 && spaceAbove > spaceBelow; // if tight below, and above is better
    const top = placeAbove ? Math.max(8, r.top - gap) : r.bottom + gap;

    setMenuPos({
      top,
      left: Math.max(8, r.left),
      width: Math.max(240, r.width),
      placeAbove,
    });
  }

  useEffect(() => {
    if (!open) return;

    computeMenuPos();

    function onScrollOrResize() {
      computeMenuPos();
    }

    // capture scroll from any ancestor scrollers too
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";

  const isShowingSelectedLabel = useMemo(() => {
    if (!selectedId) return false;
    const it = items.find((x) => x.id === selectedId);
    if (!it) return false;
    return query === label(it);
  }, [items, query, selectedId]);

  const menu = open && mounted && menuPos
    ? createPortal(
        <div
          id={menuDomId}
          style={{
            position: "fixed",
            left: menuPos.left,
            width: menuPos.width,
            // If we place above, we anchor the menu's bottom to input's top by using translate.
            top: menuPos.top,
            transform: menuPos.placeAbove ? "translateY(calc(-100%))" : "none",
            zIndex: 2147483647, // max practical z-index
            border,
            borderRadius: 12,
            background: surface,
            boxShadow: "0 12px 30px rgba(0,0,0,0.45)",
            overflow: "hidden",
          }}
        >
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 12, opacity: 0.7 }}>No matches.</div>
            ) : (
              filtered.map((it, idx) => {
                const active = idx === activeIndex;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseDown={(e) => {
                      // keep focus in the input while clicking options
                      e.preventDefault();
                    }}
                    onClick={() => selectItem(it)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: "none",
                      padding: "10px 12px",
                      background: active ? "rgba(255,255,255,0.06)" : "transparent",
                      color: fg,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>{label(it)}</div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                      {[it.category, it.manufacturer, it.orderFrom].filter(Boolean).join(" • ")}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div ref={rootRef} style={{ width: "100%", ...style }}>
      {/* Hidden input the server action reads */}
      <input type="hidden" name={name} value={selectedId} />

      <input
        ref={inputRef}
        value={query}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);

          // if a selection exists and the textbox is showing that label, select-all
          if (isShowingSelectedLabel) {
            requestAnimationFrame(() => inputRef.current?.select());
          }
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setSelectedId("");
          onSelectedIdChange?.("");
          setActiveIndex(0);
          requestAnimationFrame(() => computeMenuPos());
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
            setOpen(true);
            requestAnimationFrame(() => computeMenuPos());
            return;
          }
          if (e.key === "Escape") {
            setOpen(false);
            return;
          }
          if (!open) return;

          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
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

      {menu}
    </div>
  );
}