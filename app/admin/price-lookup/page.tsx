"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type PriceResult = {
  vendor: string;
  title: string;
  price: number | null;
  currency: string;
  url: string;
  shipping?: string;
  inStock?: string;
  notes?: string;
};

type LookupResponse = {
  partNumber: string;
  summary?: string;
  generatedAt?: string;
  filters?: {
    includeVendors?: string[];
    excludeVendors?: string[];
  };
  results: PriceResult[];
};

function formatMoney(amount: number | null, currency: string): string {
  if (amount == null) return "N/A";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export default function PriceLookupPage() {
  const searchParams = useSearchParams();
  const [partNumber, setPartNumber] = useState("");
  const [includeVendorsText, setIncludeVendorsText] = useState("");
  const [excludeVendorsText, setExcludeVendorsText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<LookupResponse | null>(null);
  const autoRanFor = useRef<string>("");

  function parseVendorCsv(input: string): string[] {
    return Array.from(
      new Set(
        input
          .split(",")
          .map((x) => x.trim())
          .filter((x) => x.length > 0)
      )
    );
  }

  const lowest = useMemo(() => {
    if (!data?.results?.length) return null;
    return data.results.find((x) => x.price != null) ?? null;
  }, [data]);

  async function runLookup(rawPartNumber: string) {
    setError("");
    setData(null);

    const normalized = rawPartNumber.trim();
    if (!normalized) {
      setError("Enter a part number first.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/price-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partNumber: normalized,
          maxResults: 8,
          includeVendors: parseVendorCsv(includeVendorsText),
          excludeVendors: parseVendorCsv(excludeVendorsText),
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as LookupResponse & { error?: string };
      if (!res.ok) {
        setError(payload.error || "Lookup failed.");
        return;
      }

      setData(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Lookup failed.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await runLookup(partNumber);
  }

  useEffect(() => {
    const queryPart = (searchParams.get("partNumber") || searchParams.get("pn") || "").trim();
    if (!queryPart) return;
    if (autoRanFor.current === queryPart) return;

    autoRanFor.current = queryPart;
    setPartNumber(queryPart);
    void runLookup(queryPart);
  }, [searchParams]);

  return (
    <main style={{ display: "grid", gap: 14, maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>AI Part Price Lookup</h1>
      <p style={{ margin: 0, opacity: 0.85 }}>
        Enter a part number to search online suppliers and compare pricing with direct links.
      </p>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6, maxWidth: 420 }}>
          <span style={{ fontWeight: 700 }}>Part Number</span>
          <input
            value={partNumber}
            onChange={(e) => setPartNumber(e.target.value)}
            placeholder="Example: 01-0756"
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--border, rgba(0,0,0,0.2))",
              background: "var(--input, transparent)",
              color: "inherit",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6, maxWidth: 620 }}>
          <span style={{ fontWeight: 700 }}>Include Vendors (optional, comma-separated)</span>
          <input
            value={includeVendorsText}
            onChange={(e) => setIncludeVendorsText(e.target.value)}
            placeholder="Example: Parts Town, Grainger, WebstaurantStore"
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--border, rgba(0,0,0,0.2))",
              background: "var(--input, transparent)",
              color: "inherit",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6, maxWidth: 620 }}>
          <span style={{ fontWeight: 700 }}>Exclude Vendors (optional, comma-separated)</span>
          <input
            value={excludeVendorsText}
            onChange={(e) => setExcludeVendorsText(e.target.value)}
            placeholder="Example: eBay, Amazon Marketplace"
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--border, rgba(0,0,0,0.2))",
              background: "var(--input, transparent)",
              color: "inherit",
            }}
          />
        </label>

        <div>
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--border, rgba(0,0,0,0.2))",
              background: "var(--button, transparent)",
              color: "inherit",
              fontWeight: 900,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Searching..." : "Find Lowest Price"}
          </button>
        </div>
      </form>

      {error ? (
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            border: "1px solid var(--border, rgba(0,0,0,0.2))",
            background: "var(--card, transparent)",
            fontWeight: 700,
          }}
        >
          Error: {error}
        </div>
      ) : null}

      {data ? (
        <section style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontWeight: 900 }}>Part: {data.partNumber}</div>
            {data.summary ? <div style={{ opacity: 0.85 }}>{data.summary}</div> : null}
            {data.filters?.includeVendors?.length ? (
              <div style={{ opacity: 0.85 }}>Include: {data.filters.includeVendors.join(", ")}</div>
            ) : null}
            {data.filters?.excludeVendors?.length ? (
              <div style={{ opacity: 0.85 }}>Exclude: {data.filters.excludeVendors.join(", ")}</div>
            ) : null}
            {lowest ? (
              <div style={{ fontWeight: 800 }}>
                Lowest found: {formatMoney(lowest.price, lowest.currency)} from {lowest.vendor}
              </div>
            ) : null}
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {data.results.length === 0 ? <div>No offers found.</div> : null}
            {data.results.map((row, idx) => (
              <article
                key={`${row.url}-${idx}`}
                style={{
                  border: "1px solid var(--border, rgba(0,0,0,0.2))",
                  borderRadius: 12,
                  padding: 12,
                  display: "grid",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <strong>{row.vendor}</strong>
                  <strong>{formatMoney(row.price, row.currency)}</strong>
                </div>
                <div>{row.title}</div>
                <a href={row.url} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all" }}>
                  {row.url}
                </a>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", opacity: 0.85 }}>
                  {row.shipping ? <span>Shipping: {row.shipping}</span> : null}
                  {row.inStock ? <span>Stock: {row.inStock}</span> : null}
                </div>
                {row.notes ? <div style={{ opacity: 0.85 }}>Notes: {row.notes}</div> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
