"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import ItemPicker from "./ItemPicker";

type ItemLite = {
  id: string;
  sku: string;
  partNumber: string | null;
  name: string;
  category?: string | null;
  manufacturer?: string | null;
  orderFrom?: string | null;
};

type UserOption = {
  id: string;
  name: string;
  role: string;
};

type LocationOption = {
  id: string;
  name: string;
};

type Props = {
  items: ItemLite[];
  users: UserOption[];
  locations: LocationOption[];
  phases: string[];
  values: {
    q: string;
    phase: string;
    itemId: string;
    supplier: string;
    forUserId: string;
    forStoreId: string;
    from: string;
    to: string;
    perPage: number;
  };
  summary: {
    orders: number;
    total: number;
    page: number;
    pageCount: number;
  };
};

type FilterValues = Props["values"];

const LIVE_FILTER_DELAY_MS = 350;

function phaseLabel(phase: string): string {
  if (phase === "ORDERED") return "ORDERED";
  if (phase === "ARRIVED") return "ARRIVED";
  return "ADDED TO INVENTORY";
}

function hasActiveFilters(values: Props["values"]): boolean {
  return Boolean(
    values.q ||
      values.phase ||
      values.itemId ||
      values.supplier ||
      values.forUserId ||
      values.forStoreId ||
      values.from ||
      values.to ||
      values.perPage !== 25
  );
}

function sameValues(a: FilterValues, b: FilterValues): boolean {
  return (
    a.q === b.q &&
    a.phase === b.phase &&
    a.itemId === b.itemId &&
    a.supplier === b.supplier &&
    a.forUserId === b.forUserId &&
    a.forStoreId === b.forStoreId &&
    a.from === b.from &&
    a.to === b.to &&
    a.perPage === b.perPage
  );
}

function valuesKey(values: FilterValues): string {
  return [values.q, values.phase, values.itemId, values.supplier, values.forUserId, values.forStoreId, values.from, values.to, String(values.perPage)].join("\u0001");
}

function buildSearchParams(values: FilterValues): URLSearchParams {
  const nextSearch = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(values)) {
    const value = String(rawValue).trim();
    if (value && !(key === "perPage" && value === "25")) {
      nextSearch.set(key, value);
    }
  }

  nextSearch.set("page", "1");
  return nextSearch;
}

export default function SearchFilters({ items, users, locations, phases, values, summary }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(() => hasActiveFilters(values));
  const [filters, setFilters] = useState<FilterValues>(values);
  const lastNavigatedKeyRef = useRef<string>(valuesKey(values));

  useEffect(() => {
    if (hasActiveFilters(values)) setIsOpen(true);
  }, [values]);

  useEffect(() => {
    setFilters(values);
    lastNavigatedKeyRef.current = valuesKey(values);
  }, [values]);

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";

  const controlLabel: CSSProperties = { display: "grid", gap: 6, fontSize: 12, opacity: 0.9, fontWeight: 900 };
  const controlBase: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 12,
    border,
    background: surface,
    color: fg,
    outline: "none",
    fontSize: 14,
    minWidth: 0,
  };
  const btn: CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border,
    background: surface,
    color: fg,
    fontWeight: 900,
    cursor: isPending ? "progress" : "pointer",
    lineHeight: 1,
    whiteSpace: "nowrap",
  };
  const wrapRow: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "end",
    width: "100%",
    minWidth: 0,
  };
  const flexItem = (basis: number, grow = 1): CSSProperties => ({
    flex: `${grow} 1 ${basis}px`,
    minWidth: 0,
  });

  function navigate(nextSearch: URLSearchParams, nextKey: string) {
    const qs = nextSearch.toString();
    const nextUrl = qs ? `${pathname}?${qs}` : pathname;
    lastNavigatedKeyRef.current = nextKey;
    startTransition(() => {
      router.replace(nextUrl, { scroll: false });
    });
  }

  function submitFilters(nextValues: FilterValues) {
    setIsOpen(true);
    navigate(buildSearchParams(nextValues), valuesKey(nextValues));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitFilters(filters);
  }

  function handleClear() {
    setIsOpen(false);
    const clearedValues: FilterValues = {
      q: "",
      phase: "",
      itemId: "",
      supplier: "",
      forUserId: "",
      forStoreId: "",
      from: "",
      to: "",
      perPage: 25,
    };
    setFilters(clearedValues);
    lastNavigatedKeyRef.current = valuesKey(clearedValues);
    startTransition(() => {
      router.replace(pathname, { scroll: false });
    });
  }

  useEffect(() => {
    if (sameValues(filters, values)) return;

    const nextKey = valuesKey(filters);
    if (nextKey === lastNavigatedKeyRef.current) return;

    const timeoutId = window.setTimeout(() => {
      submitFilters(filters);
    }, LIVE_FILTER_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [filters, pathname, router, values]);

  function updateFilter<K extends keyof FilterValues>(key: K, value: FilterValues[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <details open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)} style={{ marginTop: 14 }}>
      <summary
        style={{
          cursor: "pointer",
          userSelect: "none",
          fontWeight: 900,
          padding: 12,
          border,
          borderRadius: 14,
          background: surface,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span>Search & Filters</span>
        <span style={{ fontSize: 12, opacity: 0.75 }}>{isPending ? "Updating..." : "Click to expand"}</span>
      </summary>

      <div style={{ marginTop: 10, border, borderRadius: 14, background: surface, padding: 12 }}>
        <div style={{ fontWeight: 900, marginBottom: 8, fontSize: 14 }}>Search & Filters</div>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10 }}>
          <div style={wrapRow}>
            <label style={{ ...controlLabel, ...flexItem(240, 2) }}>
              Search
              <input
                name="q"
                value={filters.q}
                onChange={(event) => updateFilter("q", event.target.value)}
                placeholder="Search ID, SKU, part #, name, category, supplier, mfg, order from..."
                style={controlBase}
              />
            </label>

            <label style={{ ...controlLabel, ...flexItem(170, 0) }}>
              Phase
              <select name="phase" value={filters.phase} onChange={(event) => updateFilter("phase", event.target.value)} style={controlBase}>
                <option value="">All</option>
                {phases.map((phase) => (
                  <option key={phase} value={phase}>
                    {phaseLabel(phase)}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ ...controlLabel, ...flexItem(320, 2) }}>
              Item
              <div style={{ marginTop: 2 }}>
                <ItemPicker
                  name="itemId"
                  items={items}
                  defaultId={filters.itemId}
                  placeholder="Search item (sku, part #, name...)"
                  onSelectedIdChange={(id) => updateFilter("itemId", id)}
                />
              </div>
            </label>

            <label style={{ ...controlLabel, ...flexItem(220, 1) }}>
              Supplier
              <input
                name="supplier"
                value={filters.supplier}
                onChange={(event) => updateFilter("supplier", event.target.value)}
                placeholder="Supplier..."
                style={controlBase}
              />
            </label>

            <label style={{ ...controlLabel, ...flexItem(220, 1) }}>
              For Tech
              <select
                name="forUserId"
                value={filters.forUserId}
                onChange={(event) => updateFilter("forUserId", event.target.value)}
                style={controlBase}
              >
                <option value="">All</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.role})
                  </option>
                ))}
              </select>
            </label>

            <label style={{ ...controlLabel, ...flexItem(220, 1) }}>
              For Store
              <select
                name="forStoreId"
                value={filters.forStoreId}
                onChange={(event) => updateFilter("forStoreId", event.target.value)}
                style={controlBase}
              >
                <option value="">All</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={wrapRow}>
            <label style={{ ...controlLabel, ...flexItem(150, 0) }}>
              From
              <input type="date" name="from" value={filters.from} onChange={(event) => updateFilter("from", event.target.value)} style={controlBase} />
            </label>

            <label style={{ ...controlLabel, ...flexItem(150, 0) }}>
              To
              <input type="date" name="to" value={filters.to} onChange={(event) => updateFilter("to", event.target.value)} style={controlBase} />
            </label>

            <label style={{ ...controlLabel, ...flexItem(130, 0) }}>
              Per page
              <select
                name="perPage"
                value={String(filters.perPage)}
                onChange={(event) => updateFilter("perPage", Number(event.target.value))}
                style={controlBase}
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ ...flexItem(260, 1), display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="submit" style={btn} disabled={isPending}>
                Apply
              </button>
              <button type="button" onClick={handleClear} style={btn} disabled={isPending}>
                Clear
              </button>
            </div>
          </div>

          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Showing <b>{summary.orders}</b> of <b>{summary.total}</b> results • Page <b>{summary.page}</b> / <b>{summary.pageCount}</b>
          </div>
        </form>
      </div>
    </details>
  );
}