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

type VendorCredentialSummary = {
  site: string;
  username: string;
  hasPassword: boolean;
  updatedAt: string;
};

type EnvStatusResponse = {
  hasOpenAiKey: boolean;
  presentVars: string[];
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
  const [site, setSite] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [credsLoading, setCredsLoading] = useState(false);
  const [credsError, setCredsError] = useState("");
  const [credentials, setCredentials] = useState<VendorCredentialSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<LookupResponse | null>(null);
  const [envStatus, setEnvStatus] = useState<EnvStatusResponse | null>(null);
  const [envLoading, setEnvLoading] = useState(false);
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

  async function loadCredentials() {
    setCredsLoading(true);
    setCredsError("");
    try {
      const res = await fetch("/api/admin/price-lookup/vendor-credentials", { method: "GET" });
      const payload = (await res.json().catch(() => ({}))) as {
        credentials?: VendorCredentialSummary[];
        error?: string;
      };
      if (!res.ok) {
        setCredsError(payload.error || "Failed to load saved vendor credentials.");
        return;
      }
      setCredentials(Array.isArray(payload.credentials) ? payload.credentials : []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load saved vendor credentials.";
      setCredsError(msg);
    } finally {
      setCredsLoading(false);
    }
  }

  async function saveCredential(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCredsError("");

    const normalizedSite = site.trim();
    const normalizedUsername = username.trim();
    const normalizedPassword = password.trim();
    if (!normalizedSite || !normalizedUsername || !normalizedPassword) {
      setCredsError("Site, username, and password are required.");
      return;
    }

    setCredsLoading(true);
    try {
      const res = await fetch("/api/admin/price-lookup/vendor-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site: normalizedSite,
          username: normalizedUsername,
          password: normalizedPassword,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        credentials?: VendorCredentialSummary[];
        error?: string;
      };
      if (!res.ok) {
        setCredsError(payload.error || "Failed to save credential.");
        return;
      }

      setCredentials(Array.isArray(payload.credentials) ? payload.credentials : []);
      setPassword("");
      setSite("");
      setUsername("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save credential.";
      setCredsError(msg);
    } finally {
      setCredsLoading(false);
    }
  }

  async function removeCredential(targetSite: string) {
    setCredsLoading(true);
    setCredsError("");
    try {
      const res = await fetch("/api/admin/price-lookup/vendor-credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site: targetSite }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        credentials?: VendorCredentialSummary[];
        error?: string;
      };
      if (!res.ok) {
        setCredsError(payload.error || "Failed to remove credential.");
        return;
      }
      setCredentials(Array.isArray(payload.credentials) ? payload.credentials : []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to remove credential.";
      setCredsError(msg);
    } finally {
      setCredsLoading(false);
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
  }, []);

  useEffect(() => {
    void loadCredentials();
  }, []);

  return (
    <main style={{ display: "grid", gap: 14, maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>AI Part Price Lookup</h1>
      <p style={{ margin: 0, opacity: 0.85 }}>
        Enter a part number to search online suppliers and compare pricing with direct links.
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

      <details style={{ border: "1px solid var(--border, rgba(0,0,0,0.2))", borderRadius: 12, padding: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 900 }}>Vendor Login Credentials (Encrypted Vault)</summary>
        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          <div style={{ opacity: 0.85 }}>
            Save vendor login credentials per site. They are encrypted server-side and never returned in plaintext.
          </div>

          <form onSubmit={saveCredential} style={{ display: "grid", gap: 8, maxWidth: 680 }}>
            <input
              value={site}
              onChange={(e) => setSite(e.target.value)}
              placeholder="Vendor site (example: partstown.com)"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--input, transparent)", color: "inherit" }}
            />
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Login username / email"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--input, transparent)", color: "inherit" }}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--input, transparent)", color: "inherit" }}
            />
            <div>
              <button
                type="submit"
                disabled={credsLoading}
                style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--button, transparent)", color: "inherit", fontWeight: 800, cursor: credsLoading ? "default" : "pointer" }}
              >
                {credsLoading ? "Saving..." : "Save Credential"}
              </button>
            </div>
          </form>

          {credsError ? <div style={{ fontWeight: 700 }}>Error: {credsError}</div> : null}

          <div style={{ display: "grid", gap: 8 }}>
            {credentials.length === 0 ? <div style={{ opacity: 0.8 }}>No vendor credentials saved yet.</div> : null}
            {credentials.map((row) => (
              <div
                key={row.site}
                style={{
                  border: "1px solid var(--border, rgba(0,0,0,0.2))",
                  borderRadius: 10,
                  padding: 10,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "grid", gap: 2 }}>
                  <div style={{ fontWeight: 800 }}>{row.site}</div>
                  <div style={{ opacity: 0.85 }}>Username: {row.username}</div>
                  <div style={{ opacity: 0.75, fontSize: 12 }}>Updated: {new Date(row.updatedAt).toLocaleString()}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void removeCredential(row.site)}
                  disabled={credsLoading}
                  style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--button, transparent)", color: "inherit", fontWeight: 800, cursor: credsLoading ? "default" : "pointer" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      </details>

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

            {data.fallbackLinks?.length ? (
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                <div style={{ fontWeight: 900 }}>Quick Vendor Search Links</div>
                {data.fallbackLinks.map((link) => (
                  <a
                    key={`${link.vendor}-${link.url}`}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ wordBreak: "break-all" }}
                  >
                    {link.vendor}: {link.url}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
