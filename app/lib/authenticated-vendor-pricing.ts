import type { VendorCredentialForTest } from "@/app/lib/vendor-credentials";
import { fetchPartsTownAuthenticatedPriceInBrowser, isPartsTownSite } from "@/app/lib/partstown-browser";

type PriceResultLite = {
  vendor: string;
  url: string;
};

export type AuthenticatedPriceOverlay = {
  status: "authenticated" | "blocked" | "failed";
  price: number | null;
  currency?: string;
  inStock?: string;
  notes: string;
};

type FormDescriptor = {
  actionUrl: string;
  method: "GET" | "POST";
  fields: Record<string, string>;
  userField: string;
  passwordField: string;
};

function isPartsTownHost(host: string): boolean {
  return isPartsTownSite(host);
}

function parseHost(input: string): string {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeSiteToHost(site: string): string {
  const raw = String(site || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return parseHost(raw);
  return parseHost(`https://${raw}`);
}

function findPartsTownCredential(url: string, creds: VendorCredentialForTest[]): VendorCredentialForTest | null {
  const targetHost = parseHost(url);
  if (!targetHost || !isPartsTownHost(targetHost)) return null;

  let best: VendorCredentialForTest | null = null;
  let bestScore = -1;

  for (const cred of creds) {
    const credHost = normalizeSiteToHost(cred.site);
    if (!credHost || !isPartsTownHost(credHost)) continue;

    let score = -1;
    if (targetHost === credHost) score = 100;
    else if (targetHost.endsWith(`.${credHost}`) || credHost.endsWith(`.${targetHost}`)) score = 80;
    else if (targetHost.includes(credHost) || credHost.includes(targetHost)) score = 60;

    if (score > bestScore) {
      best = cred;
      bestScore = score;
    }
  }

  return bestScore >= 60 ? best : null;
}

function detectBotChallenge(html: string): { blocked: boolean; provider?: string } {
  const src = String(html || "").toLowerCase();
  if (!src) return { blocked: false };

  if (
    src.includes("enable javascript and cookies to continue") ||
    src.includes("cf-challenge") ||
    src.includes("cloudflare") ||
    src.includes("/cdn-cgi/challenge-platform/")
  ) {
    return { blocked: true, provider: "Cloudflare" };
  }

  if (src.includes("perimeterx") || src.includes("px-captcha") || src.includes("distil_r_captcha")) {
    return { blocked: true, provider: "Bot protection" };
  }

  return { blocked: false };
}

function extractPartsTownPrice(html: string): { price: number | null; currency?: string } {
  const src = String(html || "");

  const jsonPrice = src.match(/"price"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/i);
  if (jsonPrice?.[1]) {
    const p = Number(jsonPrice[1]);
    if (Number.isFinite(p) && p >= 0) return { price: p, currency: "USD" };
  }

  const itemprop = src.match(/itemprop=["']price["'][^>]*content=["']([0-9]+(?:\.[0-9]{1,2})?)["']/i);
  if (itemprop?.[1]) {
    const p = Number(itemprop[1]);
    if (Number.isFinite(p) && p >= 0) return { price: p, currency: "USD" };
  }

  const partstownSpecific = src.match(/(?:our price|price)[^$]{0,80}\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i);
  if (partstownSpecific?.[1]) {
    const normalized = partstownSpecific[1].replace(/,/g, "");
    const p = Number(normalized);
    if (Number.isFinite(p) && p >= 0) return { price: p, currency: "USD" };
  }

  const money = src.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/);
  if (money?.[1]) {
    const normalized = money[1].replace(/,/g, "");
    const p = Number(normalized);
    if (Number.isFinite(p) && p >= 0) return { price: p, currency: "USD" };
  }

  return { price: null };
}

function extractStock(html: string): string | undefined {
  const src = String(html || "").toLowerCase();
  if (src.includes("in stock")) return "In stock";
  if (src.includes("out of stock")) return "Out of stock";
  if (src.includes("backorder")) return "Backorder";
  return undefined;
}

function looksLikePartsTownLoginPage(html: string): boolean {
  const src = String(html || "").toLowerCase();
  if (!src) return false;
  return (
    src.includes("forgot your password") &&
    src.includes("remember me") &&
    src.includes("create an account") &&
    src.includes("email address") &&
    src.includes("password")
  );
}

function detectPartsTownLoginState(html: string): "logged-in" | "login-page" | "unknown" {
  const src = String(html || "").toLowerCase();
  if (!src) return "unknown";

  if (looksLikePartsTownLoginPage(src)) return "login-page";

  if (
    src.includes("track my order") ||
    src.includes("add to my parts") ||
    src.includes("my location") ||
    src.includes("your cart") ||
    src.includes("multi-sku order")
  ) {
    return "logged-in";
  }

  return "unknown";
}

function isPartsTownSearchUrl(url: string): boolean {
  const normalized = String(url || "").toLowerCase();
  return normalized.includes("partstown.com/search");
}

function findPartsTownProductUrl(baseUrl: string, html: string): string | null {
  const src = String(html || "");
  if (!src) return null;

  const anchorRegex = /<a\b[^>]*href=["'](https?:\/\/www\.partstown\.com\/[^"'#]+|\/[^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(src)) !== null) {
    const rawHref = String(match[1] || "").trim();
    const anchorText = String(match[2] || "").replace(/<[^>]+>/g, " ").trim();
    if (!rawHref) continue;

    try {
      const resolved = new URL(rawHref, baseUrl).toString();
      const path = new URL(resolved).pathname.toLowerCase();
      if (!isPartsTownHost(parseHost(resolved))) continue;
      if (path === "/" || path.startsWith("/search") || path.startsWith("/login") || path.startsWith("/register")) continue;
      if (path.split("/").filter(Boolean).length < 2) continue;
      if (!anchorText || anchorText.length < 4) continue;
      return resolved;
    } catch {
      // Ignore malformed search result link.
    }
  }

  return null;
}

function parseInputAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const attrRegex = /(\w[\w:-]*)\s*=\s*["']([^"']*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(tag)) !== null) {
    out[String(match[1] || "").toLowerCase()] = String(match[2] || "");
  }
  return out;
}

function parseLoginForm(baseUrl: string, html: string): FormDescriptor | null {
  const src = String(html || "");
  if (!src) return null;

  const formRegex = /<form\b([\s\S]*?)>([\s\S]*?)<\/form>/gi;
  let formMatch: RegExpExecArray | null;

  while ((formMatch = formRegex.exec(src)) !== null) {
    const formAttrs = parseInputAttrs(String(formMatch[1] || ""));
    const body = String(formMatch[2] || "");

    const inputRegex = /<input\b[^>]*>/gi;
    let inputMatch: RegExpExecArray | null;
    const fields: Record<string, string> = {};
    let userField = "";
    let passwordField = "";

    while ((inputMatch = inputRegex.exec(body)) !== null) {
      const attrs = parseInputAttrs(String(inputMatch[0] || ""));
      const name = String(attrs.name || "").trim();
      if (!name) continue;

      const type = String(attrs.type || "text").toLowerCase();
      const value = String(attrs.value || "");
      fields[name] = value;

      if (!userField && (type === "email" || /email|user|login/i.test(name))) userField = name;
      if (!passwordField && (type === "password" || /pass/i.test(name))) passwordField = name;
    }

    if (!userField || !passwordField) continue;

    const rawAction = String(formAttrs.action || "").trim();
    const actionUrl = (() => {
      try {
        return new URL(rawAction || baseUrl, baseUrl).toString();
      } catch {
        return baseUrl;
      }
    })();

    const method = String(formAttrs.method || "POST").toUpperCase() === "GET" ? "GET" : "POST";
    return { actionUrl, method, fields, userField, passwordField };
  }

  return null;
}

function mergeCookies(existing: string, nextRaw: string[]): string {
  const map = new Map<string, string>();
  for (const chunk of existing.split(";")) {
    const pair = chunk.trim();
    if (!pair) continue;
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    map.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }

  for (const setCookie of nextRaw) {
    const first = String(setCookie || "").split(";")[0]?.trim() || "";
    if (!first) continue;
    const idx = first.indexOf("=");
    if (idx <= 0) continue;
    map.set(first.slice(0, idx).trim(), first.slice(idx + 1).trim());
  }

  return Array.from(map.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function fetchWithCookieJar(
  url: string,
  init: RequestInit,
  cookieJar: { cookie: string }
): Promise<{ response: Response; body: string }> {
  const headers = new Headers(init.headers || {});
  if (cookieJar.cookie) headers.set("cookie", cookieJar.cookie);
  if (!headers.has("user-agent")) headers.set("user-agent", "InventoryApp-AuthPrice/1.0");

  const response = await fetch(url, { ...init, headers, redirect: "follow", cache: "no-store" });
  const setCookies =
    typeof (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (response.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [];
  if (setCookies.length > 0) cookieJar.cookie = mergeCookies(cookieJar.cookie, setCookies);

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const body = contentType.includes("text/html") ? await response.text() : "";
  return { response, body };
}

function buildPartsTownLoginCandidates(site: string): string[] {
  const raw = String(site || "").trim();
  const base = raw ? (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : "https://www.partstown.com";
  const origin = (() => {
    try {
      const parsed = new URL(base);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return "https://www.partstown.com";
    }
  })();

  return [
    `${origin}/login`,
    `${origin}/register`,
    `${origin}/account/login`,
    `${origin}/customer/account/login`,
    origin,
  ];
}

async function attemptPartsTownAuthenticatedSession(
  credential: VendorCredentialForTest,
  targetUrl: string
): Promise<AuthenticatedPriceOverlay> {
  return fetchPartsTownAuthenticatedPriceInBrowser({ credential, targetUrl });
}

export async function getAuthenticatedPriceOverlay(args: {
  result: PriceResultLite;
  credentials: VendorCredentialForTest[];
}): Promise<AuthenticatedPriceOverlay | null> {
  const targetHost = parseHost(args.result.url);
  if (!isPartsTownHost(targetHost)) return null;

  const credential = findPartsTownCredential(args.result.url, args.credentials);
  if (!credential) return null;

  return attemptPartsTownAuthenticatedSession(credential, args.result.url);
}
