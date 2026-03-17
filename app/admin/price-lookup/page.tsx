"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type PriceResult = {
  vendor: string;
  title: string;
  price: number | null;
  currency: string;
  url: string;
  matchType?: "exact" | "alternative";
  matchedPartNumber?: string;
  shipping?: string;
  inStock?: string;
  notes?: string;
};

type FallbackLink = {
  vendor: string;
  url: string;
};

type LookupResponse = {
  partNumber: string;
  summary?: string;
  generatedAt?: string;
  warning?: string;
  fallbackLinks?: FallbackLink[];
  filters?: {
    includeVendors?: string[];
    excludeVendors?: string[];
  };
  results: PriceResult[];
};

type EnvStatusResponse = {
  hasOpenAiKey: boolean;
  presentVars: string[];
  error?: string;
};

type LookupPreferencesResponse = {
  includeVendors?: string[];
  excludeVendors?: string[];
  error?: string;
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
  const [envStatus, setEnvStatus] = useState<EnvStatusResponse | null>(null);
  const [envLoading, setEnvLoading] = useState(false);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [prefsError, setPrefsError] = useState("");
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

  const alternativesCount = useMemo(() => {
    if (!data?.results?.length) return 0;
    return data.results.filter((r) => r.matchType === "alternative").length;
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

  async function checkEnvStatus() {
    setEnvLoading(true);
    try {
      const res = await fetch("/api/admin/price-lookup/env-status", { method: "GET" });
      const payload = (await res.json().catch(() => ({}))) as EnvStatusResponse;
      if (!res.ok) {
        setEnvStatus({ hasOpenAiKey: false, presentVars: [], error: payload.error || "Unable to check key status." });
        return;
      }
      setEnvStatus(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to check key status.";
      setEnvStatus({ hasOpenAiKey: false, presentVars: [], error: msg });
    } finally {
      setEnvLoading(false);
    }
  }

  async function loadLookupPreferences() {
    setPrefsLoading(true);
    setPrefsError("");
    try {
      const res = await fetch("/api/admin/price-lookup/preferences", { method: "GET" });
      const payload = (await res.json().catch(() => ({}))) as LookupPreferencesResponse;
      if (!res.ok) {
        setPrefsError(payload.error || "Failed to load saved vendor filters.");
        return;
      }

      const include = Array.isArray(payload.includeVendors) ? payload.includeVendors : [];
      const exclude = Array.isArray(payload.excludeVendors) ? payload.excludeVendors : [];
      setIncludeVendorsText(include.join(", "));
      setExcludeVendorsText(exclude.join(", "));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load saved vendor filters.";
      setPrefsError(msg);
    } finally {
      setPrefsLoading(false);
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

  useEffect(() => {
    void checkEnvStatus();
    void loadLookupPreferences();
  }, []);

  return (
    <main style={{ display: "grid", gap: 14, maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>AI Part Price Lookup</h1>
      <p style={{ margin: 0, opacity: 0.85 }}>
        Enter a part number to search the web for the lowest exact match price and available alternatives.
      </p>
      <p style={{ margin: 0, opacity: 0.75, fontSize: 13 }}>
        Include/Exclude vendor lists are saved per user and reused on every run until you change or clear them.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => void checkEnvStatus()}
          disabled={envLoading}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid var(--border, rgba(0,0,0,0.2))",
            background: "var(--button, transparent)",
            color: "inherit",
            fontWeight: 800,
            cursor: envLoading ? "default" : "pointer",
            opacity: envLoading ? 0.7 : 1,
          }}
        >
          {envLoading ? "Checking key..." : "Check API Key Setup"}
        </button>

        {envStatus ? (
          <span style={{ opacity: 0.9, fontWeight: 700 }}>
            {envStatus.hasOpenAiKey
              ? `OpenAI key detected (${envStatus.presentVars.join(", ")}).`
              : envStatus.error || "No OpenAI key env var detected in server runtime."}
          </span>
        ) : null}
      </div>

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

        {prefsLoading ? <div style={{ opacity: 0.75, fontSize: 13 }}>Loading saved vendor filters...</div> : null}
        {prefsError ? <div style={{ opacity: 0.9, fontSize: 13, fontWeight: 700 }}>Vendor filter load error: {prefsError}</div> : null}

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
            {data.warning ? <div style={{ fontWeight: 800 }}>Warning: {data.warning}</div> : null}
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
            {data.results.length > 0 ? (
              <div style={{ opacity: 0.85 }}>
                Exact matches: {data.results.length - alternativesCount} | Alternatives: {alternativesCount}
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
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong>{row.vendor}</strong>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        border: "1px solid var(--border, rgba(0,0,0,0.2))",
                        fontSize: 12,
                        fontWeight: 700,
                        opacity: 0.9,
                      }}
                    >
                      {row.matchType === "alternative" ? "Alternative" : "Exact"}
                    </span>
                  </div>
                  <strong>{formatMoney(row.price, row.currency)}</strong>
                </div>

                <div>{row.title}</div>
                {row.matchedPartNumber ? <div style={{ opacity: 0.85 }}>Matched part #: {row.matchedPartNumber}</div> : null}
                {row.shipping ? <div style={{ opacity: 0.85 }}>Shipping: {row.shipping}</div> : null}
                {row.inStock ? <div style={{ opacity: 0.85 }}>Stock: {row.inStock}</div> : null}
                {row.notes ? <div style={{ opacity: 0.8 }}>Notes: {row.notes}</div> : null}

                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontWeight: 800, textDecoration: "underline", textUnderlineOffset: 2, color: "inherit" }}
                >
                  Open offer
                </a>
              </article>
            ))}
          </div>

          {data.fallbackLinks?.length ? (
            <section style={{ display: "grid", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>Fallback Vendor Search Links</h3>
              <div style={{ display: "grid", gap: 6 }}>
                {data.fallbackLinks.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontWeight: 800, textDecoration: "underline", textUnderlineOffset: 2, color: "inherit" }}
                  >
                    {link.vendor}
                  </a>
                ))}
              </div>
            </section>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
