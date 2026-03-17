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

type CredentialTestStatus = "ok" | "warning" | "error";

type CredentialTestResult = {
  site: string;
  status: CredentialTestStatus;
  message: string;
  checkedAt: string;
};

type CredentialTestSummary = {
  total: number;
  ok: number;
  warning: number;
  error: number;
};

const MASKED_PASSWORD = "********";

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

function toCredentialSiteUrl(site: string): string {
  const normalized = String(site || "").trim();
  if (!normalized) return "#";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return `https://${normalized}`;
}

export default function PriceLookupPage() {
  const searchParams = useSearchParams();
  const [partNumber, setPartNumber] = useState("");
  const [includeVendorsText, setIncludeVendorsText] = useState("");
  const [excludeVendorsText, setExcludeVendorsText] = useState("");
  const [newSite, setNewSite] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [editingSite, setEditingSite] = useState<string | null>(null);
  const [editSiteValue, setEditSiteValue] = useState("");
  const [editUsernameValue, setEditUsernameValue] = useState("");
  const [editPasswordValue, setEditPasswordValue] = useState("");
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [credsLoading, setCredsLoading] = useState(false);
  const [credsError, setCredsError] = useState("");
  const [credentials, setCredentials] = useState<VendorCredentialSummary[]>([]);
  const [testingAllCreds, setTestingAllCreds] = useState(false);
  const [testingSite, setTestingSite] = useState<string | null>(null);
  const [testSummary, setTestSummary] = useState<CredentialTestSummary | null>(null);
  const [testBySite, setTestBySite] = useState<Record<string, CredentialTestResult>>({});
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
      const next = Array.isArray(payload.credentials) ? payload.credentials : [];
      setCredentials(next);

      // Trim stale test statuses when list changes.
      const allowed = new Set(next.map((x) => x.site));
      setTestBySite((prev) => {
        const out: Record<string, CredentialTestResult> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (allowed.has(k)) out[k] = v;
        }
        return out;
      });
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

    const normalizedSite = newSite.trim();
    const normalizedUsername = newUsername.trim();
    const normalizedPassword = newPassword.trim();
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
      setNewPassword("");
      setNewSite("");
      setNewUsername("");
      setShowNewPassword(false);
      setTestSummary(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save credential.";
      setCredsError(msg);
    } finally {
      setCredsLoading(false);
    }
  }

  function beginEdit(row: VendorCredentialSummary) {
    setEditingSite(row.site);
    setEditSiteValue(row.site);
    setEditUsernameValue(row.username);
    setEditPasswordValue(MASKED_PASSWORD);
    setShowEditPassword(false);
    setCredsError("");
  }

  function cancelEdit() {
    setEditingSite(null);
    setEditSiteValue("");
    setEditUsernameValue("");
    setEditPasswordValue("");
    setShowEditPassword(false);
  }

  async function saveCredentialEdit(originalSite: string) {
    setCredsLoading(true);
    setCredsError("");
    const trimmedPassword = editPasswordValue.trim();
    const nextPassword = !trimmedPassword || trimmedPassword === MASKED_PASSWORD ? undefined : trimmedPassword;

    try {
      const res = await fetch("/api/admin/price-lookup/vendor-credentials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site: originalSite,
          nextSite: editSiteValue.trim(),
          username: editUsernameValue.trim(),
          password: nextPassword,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        credentials?: VendorCredentialSummary[];
        error?: string;
      };
      if (!res.ok) {
        setCredsError(payload.error || "Failed to update credential.");
        return;
      }

      setCredentials(Array.isArray(payload.credentials) ? payload.credentials : []);
      setTestSummary(null);
      cancelEdit();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update credential.";
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
      setTestSummary(null);
      setTestBySite((prev) => {
        const out = { ...prev };
        delete out[targetSite];
        return out;
      });
      if (editingSite === targetSite) {
        cancelEdit();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to remove credential.";
      setCredsError(msg);
    } finally {
      setCredsLoading(false);
    }
  }

  async function testAllCredentials() {
    setTestingAllCreds(true);
    setCredsError("");
    try {
      const res = await fetch("/api/admin/price-lookup/vendor-credentials/test", {
        method: "POST",
      });

      const payload = (await res.json().catch(() => ({}))) as {
        results?: CredentialTestResult[];
        summary?: CredentialTestSummary;
        error?: string;
      };

      if (!res.ok) {
        setCredsError(payload.error || "Failed to test credentials.");
        return;
      }

      const results = Array.isArray(payload.results) ? payload.results : [];
      const map: Record<string, CredentialTestResult> = {};
      for (const row of results) {
        if (row?.site) map[row.site] = row;
      }
      setTestBySite(map);
      setTestSummary(payload.summary ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to test credentials.";
      setCredsError(msg);
    } finally {
      setTestingAllCreds(false);
    }
  }

  async function testSingleCredential(site: string) {
    setTestingSite(site);
    setCredsError("");
    try {
      const res = await fetch("/api/admin/price-lookup/vendor-credentials/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        results?: CredentialTestResult[];
        error?: string;
      };

      if (!res.ok) {
        setCredsError(payload.error || "Failed to test credential.");
        return;
      }

      const first = Array.isArray(payload.results) ? payload.results[0] : undefined;
      if (!first?.site) return;

      setTestBySite((prev) => {
        const next = { ...prev, [first.site]: first };
        const summary = {
          total: Object.keys(next).length,
          ok: Object.values(next).filter((r) => r.status === "ok").length,
          warning: Object.values(next).filter((r) => r.status === "warning").length,
          error: Object.values(next).filter((r) => r.status === "error").length,
        };
        setTestSummary(summary);
        return next;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to test credential.";
      setCredsError(msg);
    } finally {
      setTestingSite(null);
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

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void testAllCredentials()}
              disabled={testingAllCreds || credsLoading || testingSite !== null}
              style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--button, transparent)", color: "inherit", fontWeight: 800, cursor: testingAllCreds || credsLoading ? "default" : "pointer", opacity: testingAllCreds || credsLoading ? 0.7 : 1 }}
            >
              {testingAllCreds ? "Testing credentials..." : "Test All Credentials"}
            </button>
            {testSummary ? (
              <span style={{ opacity: 0.9, fontWeight: 700 }}>
                OK: {testSummary.ok} | Warning: {testSummary.warning} | Error: {testSummary.error}
              </span>
            ) : null}
          </div>

          {editingSite ? (
            <div style={{ fontWeight: 700, opacity: 0.9 }}>
              Editing: {editingSite}. Leave password blank to keep the existing password.
            </div>
          ) : null}

          <form onSubmit={saveCredential} style={{ display: "grid", gap: 8, maxWidth: 680 }}>
            <input
              value={newSite}
              onChange={(e) => setNewSite(e.target.value)}
              placeholder="Vendor site (example: partstown.com)"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--input, transparent)", color: "inherit" }}
            />
            <input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Login username / email"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--input, transparent)", color: "inherit" }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Password"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--input, transparent)", color: "inherit", flex: 1 }}
              />
              <button
                type="button"
                onClick={() => setShowNewPassword((prev) => !prev)}
                style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--button, transparent)", color: "inherit", fontWeight: 700, cursor: "pointer" }}
                aria-label={showNewPassword ? "Hide password" : "Show password"}
              >
                {showNewPassword ? "Hide" : "Show"}
              </button>
            </div>
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
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <a
                      href={toCredentialSiteUrl(row.site)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontWeight: 800, textDecoration: "underline", textUnderlineOffset: 2, color: "inherit", wordBreak: "break-all" }}
                      title={`Open ${row.site}`}
                    >
                      {row.site}
                    </a>
                    {(() => {
                      // Match by exact site key, or fallback to any entry whose site normalizes to the same thing
                      const test =
                        testBySite[row.site] ??
                        Object.values(testBySite).find(
                          (r) => r.site.trim().toLowerCase() === row.site.trim().toLowerCase()
                        );
                      if (!test) return null;

                      const color =
                        test.status === "ok"
                          ? "#22c55e"
                          : test.status === "warning"
                            ? "#f59e0b"
                            : "#ef4444";

                      return (
                        <span
                          title={test.message}
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            display: "inline-block",
                            background: color,
                            border: "1px solid rgba(0,0,0,0.25)",
                          }}
                        />
                      );
                    })()}
                  </div>
                  <div style={{ opacity: 0.85 }}>Username: {row.username}</div>
                  <div style={{ opacity: 0.75, fontSize: 12 }}>Updated: {new Date(row.updatedAt).toLocaleString()}</div>
                  {(() => {
                    const test =
                      testBySite[row.site] ??
                      Object.values(testBySite).find(
                        (r) => r.site.trim().toLowerCase() === row.site.trim().toLowerCase()
                      );
                    if (!test) return null;
                    return (
                      <div style={{ opacity: 0.75, fontSize: 12 }}>
                        {test.message} (checked {new Date(test.checkedAt).toLocaleString()})
                      </div>
                    );
                  })()}
                </div>

                <div style={{ display: "flex", gap: 8, minWidth: 210, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => void testSingleCredential(row.site)}
                    disabled={credsLoading || testingAllCreds || testingSite === row.site}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--button, transparent)", color: "inherit", fontWeight: 800, cursor: credsLoading || testingAllCreds || testingSite === row.site ? "default" : "pointer", opacity: credsLoading || testingAllCreds || testingSite === row.site ? 0.7 : 1 }}
                  >
                    {testingSite === row.site ? "Testing..." : "Test"}
                  </button>
                  <button
                    type="button"
                    onClick={() => beginEdit(row)}
                    disabled={credsLoading}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--button, transparent)", color: "inherit", fontWeight: 800, cursor: credsLoading ? "default" : "pointer" }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeCredential(row.site)}
                    disabled={credsLoading}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--button, transparent)", color: "inherit", fontWeight: 800, cursor: credsLoading ? "default" : "pointer" }}
                  >
                    Remove
                  </button>
                </div>

                {editingSite === row.site ? (
                  <div style={{ width: "100%", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border, rgba(0,0,0,0.2))", display: "grid", gap: 8 }}>
                    <input
                      value={editSiteValue}
                      onChange={(e) => setEditSiteValue(e.target.value)}
                      placeholder="Vendor site"
                      style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--input, transparent)", color: "inherit" }}
                    />
                    <input
                      value={editUsernameValue}
                      onChange={(e) => setEditUsernameValue(e.target.value)}
                      placeholder="Login username / email"
                      style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--input, transparent)", color: "inherit" }}
                    />
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type={showEditPassword ? "text" : "password"}
                        value={editPasswordValue}
                        onChange={(e) => setEditPasswordValue(e.target.value)}
                        placeholder="Password"
                        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--input, transparent)", color: "inherit", flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!showEditPassword) {
                            // Revealing: if still showing the masked sentinel, clear it so user can type a new password
                            if (editPasswordValue === MASKED_PASSWORD) setEditPasswordValue("");
                          } else {
                            // Hiding: if field is empty, restore the sentinel to indicate "keep existing"
                            if (!editPasswordValue.trim()) setEditPasswordValue(MASKED_PASSWORD);
                          }
                          setShowEditPassword((prev) => !prev);
                        }}
                        style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--button, transparent)", color: "inherit", fontWeight: 700, cursor: "pointer" }}
                        aria-label={showEditPassword ? "Hide password" : "Show password"}
                      >
                        {showEditPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => void saveCredentialEdit(row.site)}
                        disabled={credsLoading}
                        style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--button, transparent)", color: "inherit", fontWeight: 800, cursor: credsLoading ? "default" : "pointer" }}
                      >
                        {credsLoading ? "Saving..." : "Save Changes"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={credsLoading}
                        style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", background: "var(--button, transparent)", color: "inherit", fontWeight: 800, cursor: credsLoading ? "default" : "pointer" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
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
                {row.matchedPartNumber ? (
                  <div style={{ opacity: 0.85 }}>Matched Part #: {row.matchedPartNumber}</div>
                ) : null}
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
