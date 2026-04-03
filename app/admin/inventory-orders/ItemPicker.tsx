// app/admin/inventory-orders/ItemPicker.tsx
"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getItemLabelNumberDisplay } from "@/app/lib/item-label-number";

type ItemLite = {
  id: string;
  labelNumber?: number | null;
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
  defaultId?: string;
  defaultItemId?: string;
  placeholder?: string;
  style?: CSSProperties;
  inputStyle?: CSSProperties;
  onSelectedIdChange?: (id: string) => void;
  enableGlobalScannerCapture?: boolean;
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

function label(it: ItemLite): string {
  const itemNumber = getItemLabelNumberDisplay(it.labelNumber);
  const itemNumberText = itemNumber ? `ITEM# ${itemNumber} • ` : "";
  return `${itemNumberText}${it.sku}${it.partNumber ? ` • ${it.partNumber}` : ""} • ${it.name}`;
}

function haystack(it: ItemLite): string {
  const itemNumber = getItemLabelNumberDisplay(it.labelNumber) ?? "";
  return normalize([it.id, it.labelNumber ?? "", itemNumber, `item#${itemNumber}`, it.sku, it.partNumber ?? "", it.name, it.category ?? "", it.manufacturer ?? "", it.orderFrom ?? ""].join(" "));
}

function compactSearchValue(value: string): string {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}

function exactScannerCandidates(it: ItemLite): string[] {
  const itemNumber = getItemLabelNumberDisplay(it.labelNumber) ?? "";
  const rawItemNumber = typeof it.labelNumber === "number" ? String(it.labelNumber) : "";

  return [it.id, it.sku, it.partNumber ?? "", itemNumber, rawItemNumber, itemNumber ? `ITEM# ${itemNumber}` : ""].filter(Boolean);
}

function findExactScannerMatch(items: ItemLite[], scanValue: string): ItemLite | null {
  const compactScanValue = compactSearchValue(scanValue);
  if (!compactScanValue) return null;

  let match: ItemLite | null = null;
  for (const item of items) {
    const isMatch = exactScannerCandidates(item).some((candidate) => compactSearchValue(candidate) === compactScanValue);
    if (!isMatch) continue;
    if (match) return null;
    match = item;
  }

  return match;
}

function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT";
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
  placeholder = "Search item #, ID, SKU, part #, name, category, manufacturer…",
  style,
  inputStyle,
  onSelectedIdChange,
  enableGlobalScannerCapture = false,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scannerBufferRef = useRef("");
  const scannerTimeoutRef = useRef<number | null>(null);

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
  const menuDomId = useMemo(() => `itempicker-menu-${Math.random().toString(16).slice(2)}`, []);

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

  useEffect(() => {
    setMounted(true);
  }, []);

  function computeMenuPos() {
    const el = inputRef.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const gap = 8;
    const spaceBelow = window.innerHeight - r.bottom - gap;
    const spaceAbove = r.top - gap;
    const placeAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
    const top = placeAbove ? Math.max(8, r.top - gap) : r.bottom + gap;

    setMenuPos({
      top,
      left: Math.max(8, r.left),
      width: Math.max(240, r.width),
      placeAbove,
    });
  }

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
  }, [menuDomId]);

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

  function applyScannedValue(rawValue: string) {
    const nextValue = rawValue.trim();
    if (!nextValue) return;

    const exactMatch = findExactScannerMatch(items, nextValue);
    if (exactMatch) {
      selectItem(exactMatch);
      return;
    }

    setQuery(nextValue);
    setSelectedId("");
    onSelectedIdChange?.("");
    setActiveIndex(0);
    setOpen(true);

    requestAnimationFrame(() => {
      inputRef.current?.focus();
      computeMenuPos();
    });
  }

  useEffect(() => {
    if (!enableGlobalScannerCapture) return;

    function clearScannerTimeout() {
      if (scannerTimeoutRef.current !== null) {
        window.clearTimeout(scannerTimeoutRef.current);
        scannerTimeoutRef.current = null;
      }
    }

    function finalizeScan(forceFinalize: boolean) {
      clearScannerTimeout();

      const captured = scannerBufferRef.current.trim();
      scannerBufferRef.current = "";
      if (!captured) return;
      if (!forceFinalize && captured.length < 3) return;

      applyScannedValue(captured);
    }

    function scheduleFinalize() {
      clearScannerTimeout();
      scannerTimeoutRef.current = window.setTimeout(() => finalizeScan(false), 90);
    }

    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;

      const activeElement = document.activeElement;
      if (activeElement === inputRef.current) return;
      if (isEditableElement(activeElement)) return;

      if ((event.key === "Enter" || event.key === "Tab") && scannerBufferRef.current) {
        event.preventDefault();
        finalizeScan(true);
        return;
      }

      if (event.key.length !== 1 || !event.key.trim()) return;

      event.preventDefault();
      scannerBufferRef.current += event.key;
      scheduleFinalize();
    }

    window.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => {
      clearScannerTimeout();
      scannerBufferRef.current = "";
      window.removeEventListener("keydown", handleGlobalKeyDown, true);
    };
  }, [enableGlobalScannerCapture, items, onSelectedIdChange]);

  useEffect(() => {
    if (!open) return;

    computeMenuPos();

    function onScrollOrResize() {
      computeMenuPos();
    }

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
            top: menuPos.top,
            transform: menuPos.placeAbove ? "translateY(calc(-100%))" : "none",
            zIndex: 2147483647,
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
      <input type="hidden" name={name} value={selectedId} />

      <input
        ref={inputRef}
        value={query}
        placeholder={placeholder}
        data-item-picker-input={name}
        onFocus={() => {
          setOpen(true);
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