import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { listVendorCredentialsForTest, normalizeSiteKey } from "@/app/lib/vendor-credentials";
import { isPartsTownSite, verifyPartsTownCredentialInBrowser } from "@/app/lib/partstown-browser";

export const runtime = "nodejs";

type TestStatus = "ok" | "warning" | "error";

type CredentialTestResult = {
  site: string;
  status: TestStatus;
  message: string;
  checkedAt: string;
};

async function requireLookupAccess() {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("Unauthorized");

  const perms = await loadUserPermissions(session);
  const canUse = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!canUse) throw new Error("Forbidden");

  return session;
}

async function resolveCurrentUser() {
  const session = await requireLookupAccess();
  const userId = (session.user as unknown as { id?: string | null } | null)?.id ?? null;
  const email = (session.user as unknown as { email?: string | null } | null)?.email ?? null;

  if (userId) {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, uiPreferences: true } });
    if (row) return row;
  }

  if (email) {
    const row = await prisma.user.findUnique({ where: { email }, select: { id: true, uiPreferences: true } });
    if (row) return row;
  }

  throw new Error("User not found");
}

async function fetchHtml(url: string, timeoutMs: number): Promise<{ status: number; finalUrl: string; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "InventoryApp-CredentialProbe/1.0",
      },
      cache: "no-store",
    });

    const contentType = String(res.headers.get("content-type") ?? "").toLowerCase();
    const body = contentType.includes("text/html") ? (await res.text()).slice(0, 250000) : "";

    return {
      status: res.status,
      finalUrl: String(res.url || url),
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

type LoginDetection = {
  hasUser: boolean;
  hasPassword: boolean;
  twoStep: boolean;
  /** Page has JS-SPA markers (Next.js, React, etc) — form fields are rendered client-side */
  isSpa: boolean;
  /** Page body contains login-intent keywords even if no form fields found in HTML */
  hasLoginKeywords: boolean;
};

function hasLoginFields(html: string): LoginDetection {
  const src = String(html || "").toLowerCase();

  const hasPassword = /type\s*=\s*["']password["']/.test(src) || /name\s*=\s*["']password["']/.test(src);
  const hasUser =
    /name\s*=\s*["'](email|username|login|userid|user_name|user)["']/.test(src) ||
    /type\s*=\s*["']email["']/.test(src);
  // Two-step: only email/username present, password on next page after submit
  const twoStep = hasUser && !hasPassword;

  // SPA indicators — form fields are injected by JS so won't appear in raw HTML
  const isSpa =
    /__next_data__/.test(src) ||
    /__remix_manifest/.test(src) ||
    /window\.__initial_state__/.test(src) ||
    /react-root/.test(src) ||
    /<div id=["']root["']/.test(src) ||
    /<div id=["']app["']/.test(src) ||
    /data-reactroot/.test(src);

  // Login-intent keywords visible in HTML even for SPAs (title, headings, aria labels)
  const hasLoginKeywords =
    /\bsign[\s-]?in\b/.test(src) ||
    /\blog[\s-]?in\b/.test(src) ||
    /\bcreate an account\b/.test(src) ||
    /\bcreate account\b/.test(src) ||
    /\bemail address\b/.test(src) ||
    /\bforgot.{0,20}password\b/.test(src) ||
    /\bremember me\b/.test(src) ||
    /type=["']email["']/.test(src) ||
    /placeholder=["'][^"']*email/.test(src);

  return { hasUser, hasPassword, twoStep, isSpa, hasLoginKeywords };
}

function discoverLoginCandidates(baseUrl: string, html: string): string[] {
  const src = String(html || "");
  const found = new Set<string>();
  const currentOrigin = (() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return "";
    }
  })();

  const loginHint = /(login|log[-_ ]?in|signin|sign[-_ ]?in|account|my-account|customer|auth|identity)/i;
  const hrefRegex = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>/gi;
  const actionRegex = /<form\b[^>]*\baction\s*=\s*["']([^"'#]+)["'][^>]*>/gi;

  for (const regex of [hrefRegex, actionRegex]) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(src)) !== null) {
      const raw = String(match[1] || "").trim();
      if (!raw || raw.startsWith("javascript:")) continue;
      if (!loginHint.test(raw)) continue;

      try {
        const resolved = new URL(raw, baseUrl);
        // Prefer same-origin pages when exploring login links.
        if (currentOrigin && resolved.origin !== currentOrigin) continue;
        if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
        found.add(resolved.toString());
      } catch {
        // Skip malformed link candidates.
      }
    }
  }

  return Array.from(found).slice(0, 8);
}

function discoverLoginCandidatesFromScripts(baseUrl: string, html: string): string[] {
  const src = String(html || "");
  const found = new Set<string>();
  const currentOrigin = (() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return "";
    }
  })();

  // Capture script blocks where route strings may appear for JS-only login buttons.
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null;

  while ((scriptMatch = scriptRegex.exec(src)) !== null) {
    const scriptBody = String(scriptMatch[1] || "");
    if (!scriptBody) continue;

    const routeRegex = /(["'`])((?:https?:\/\/[^"'`\s]+)|(?:\/[a-z0-9\-_/]*?(?:login|log-in|signin|sign-in|account|auth|identity)[a-z0-9\-_/]*))(\1)/gi;
    let routeMatch: RegExpExecArray | null;

    while ((routeMatch = routeRegex.exec(scriptBody)) !== null) {
      const raw = String(routeMatch[2] || "").trim();
      if (!raw) continue;

      try {
        const resolved = new URL(raw, baseUrl);
        if (currentOrigin && resolved.origin !== currentOrigin) continue;
        if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
        found.add(resolved.toString());
      } catch {
        // Ignore malformed script route.
      }
    }
  }

  return Array.from(found).slice(0, 8);
}

function buildInitialLoginCandidates(base: string): string[] {
  const out = new Set<string>();
  const cleanBase = base.replace(/\/+$/, "");
  out.add(base);

  const commonPaths = [
    "/login",
    "/signin",
    "/sign-in",
    "/account/login",
    "/account/signin",
    "/customer/login",
    "/customer/account/login",
    "/users/sign_in",
    "/user/login",
    "/auth/login",
    "/identity/login",
    "/my-account",
    "/my-account/login",
  ];

  for (const path of commonPaths) {
    out.add(`${cleanBase}${path}`);
  }

  try {
    const hostname = new URL(base).hostname.toLowerCase();
    const hostHints: Array<{ hint: RegExp; paths: string[] }> = [
      {
        hint: /(shopify|store)/,
        paths: ["/account/login", "/account"],
      },
      {
        hint: /(woocommerce|wordpress|wp)/,
        paths: ["/my-account", "/wp-login.php"],
      },
      {
        hint: /(magento|adobecommerce)/,
        paths: ["/customer/account/login", "/customer/account"],
      },
      {
        hint: /(parts|supply|equipment|restaurant|kitchen)/,
        paths: ["/account", "/customer/login", "/user/login"],
      },
    ];

    for (const rule of hostHints) {
      if (!rule.hint.test(hostname)) continue;
      for (const path of rule.paths) {
        out.add(`${cleanBase}${path}`);
      }
    }
  } catch {
    // Ignore hostname-specific candidate generation when URL parsing fails.
  }

  return Array.from(out).slice(0, 20);
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

  if (src.includes("distil_r_captcha") || src.includes("perimeterx") || src.includes("px-captcha")) {
    return { blocked: true, provider: "Bot protection" };
  }

  return { blocked: false };
}

async function probeCredential(siteInput: string, username: string, password: string): Promise<CredentialTestResult> {
  const checkedAt = new Date().toISOString();
  const site = String(siteInput ?? "").trim();
  if (!site) {
    return { site: String(siteInput || ""), status: "error", message: "Invalid site value.", checkedAt };
  }

  if (!username.trim() || !password.trim()) {
    return { site, status: "error", message: "Username/password missing.", checkedAt };
  }

  if (isPartsTownSite(site)) {
    const browserResult = await verifyPartsTownCredentialInBrowser({ site, username, password });
    return {
      site,
      status:
        browserResult.status === "ok"
          ? "ok"
          : browserResult.status === "blocked"
            ? "warning"
            : "error",
      message: browserResult.message,
      checkedAt,
    };
  }

  const hasProtocol = /^https?:\/\//i.test(site);
  const base = hasProtocol ? site : `https://${site}`;
  const queue = buildInitialLoginCandidates(base);
  const visited = new Set<string>();
  let reachableUrl = "";

  while (queue.length > 0 && visited.size < 12) {
    const url = String(queue.shift() || "").trim();
    if (!url || visited.has(url)) continue;
    visited.add(url);

    try {
      const { status, finalUrl, body } = await fetchHtml(url, 8000);
      reachableUrl = finalUrl;

      const botChallenge = detectBotChallenge(body);
      if (botChallenge.blocked) {
        const provider = botChallenge.provider || "site security";
        return {
          site,
          status: "warning",
          message: `${provider} challenge blocked automated verification (${finalUrl}). Credentials may still be valid in a normal browser session.`,
          checkedAt,
        };
      }

      if (status >= 400) {
        const { hasUser, hasPassword, twoStep, isSpa, hasLoginKeywords } = hasLoginFields(body);
        if (hasUser && hasPassword) {
          return {
            site,
            status: "ok",
            message: `Login form detected (${finalUrl}).`,
            checkedAt,
          };
        }

        if (twoStep) {
          return {
            site,
            status: "ok",
            message: `Two-step login detected (email first, then password) — site reachable (${finalUrl}).`,
            checkedAt,
          };
        }

        if (isSpa && hasLoginKeywords) {
          return {
            site,
            status: "ok",
            message: `Login page detected — JavaScript-rendered site, form fields loaded in browser (${finalUrl}).`,
            checkedAt,
          };
        }

        if (hasLoginKeywords) {
          return {
            site,
            status: "warning",
            message: `Login page is reachable but returned HTTP ${status} (${finalUrl}). Credentials may still be valid in a browser session.`,
            checkedAt,
          };
        }

        continue;
      }

      const { hasUser, hasPassword, twoStep, isSpa, hasLoginKeywords } = hasLoginFields(body);
      if (hasUser && hasPassword) {
        return {
          site,
          status: "ok",
          message: `Login form detected (${finalUrl}).`,
          checkedAt,
        };
      }

      if (twoStep) {
        return {
          site,
          status: "ok",
          message: `Two-step login detected (email first, then password) — site reachable (${finalUrl}).`,
          checkedAt,
        };
      }

      if (isSpa && hasLoginKeywords) {
        return {
          site,
          status: "ok",
          message: `Login page detected — JavaScript-rendered site, form fields loaded in browser (${finalUrl}).`,
          checkedAt,
        };
      }

      if (isSpa) {
        return {
          site,
          status: "ok",
          message: `Site reachable — JavaScript-rendered, credentials stored and ready (${finalUrl}).`,
          checkedAt,
        };
      }

      if (hasLoginKeywords) {
        return {
          site,
          status: "ok",
          message: `Login page detected via keywords (${finalUrl}).`,
          checkedAt,
        };
      }

      if (body.length > 0) {
        const discovered = discoverLoginCandidates(finalUrl, body);
        for (const candidate of discovered) {
          if (!visited.has(candidate) && !queue.includes(candidate)) {
            queue.push(candidate);
          }
        }

        const scriptDiscovered = discoverLoginCandidatesFromScripts(finalUrl, body);
        for (const candidate of scriptDiscovered) {
          if (!visited.has(candidate) && !queue.includes(candidate)) {
            queue.push(candidate);
          }
        }
      }

      if (body.length > 0) {
        continue;
      }
    } catch {
      // Try next candidate endpoint.
    }
  }

  if (reachableUrl) {
    return {
      site,
      status: "warning",
      message: `Site reachable, but no login endpoint was detected after scanning likely links (${reachableUrl}).`,
      checkedAt,
    };
  }

  return {
    site,
    status: "error",
    message: "Could not reach login page or connection timed out.",
    checkedAt,
  };
}

export async function POST(req: Request) {
  try {
    const user = await resolveCurrentUser();
    const allCreds = listVendorCredentialsForTest(user.uiPreferences);

    let requestedSiteRaw = "";
    let requestedSiteKey = "";
    try {
      const body = (await req.json().catch(() => null)) as { site?: unknown } | null;
      requestedSiteRaw = String(body?.site ?? "").trim();
      requestedSiteKey = normalizeSiteKey(requestedSiteRaw);
    } catch {
      requestedSiteRaw = "";
      requestedSiteKey = "";
    }

    const creds = requestedSiteRaw
      ? allCreds.filter((c) => c.site === requestedSiteRaw || normalizeSiteKey(c.site) === requestedSiteKey)
      : allCreds;

    if (requestedSiteRaw && creds.length === 0) {
      return NextResponse.json({ error: `Credential not found for site: ${requestedSiteRaw}` }, { status: 404 });
    }

    if (creds.length === 0) {
      return NextResponse.json({
        results: [] as CredentialTestResult[],
        summary: { total: 0, ok: 0, warning: 0, error: 0 },
      });
    }

    const results = await Promise.all(creds.map((c) => probeCredential(c.site, c.username, c.password)));

    const summary = {
      total: results.length,
      ok: results.filter((r) => r.status === "ok").length,
      warning: results.filter((r) => r.status === "warning").length,
      error: results.filter((r) => r.status === "error").length,
    };

    return NextResponse.json({ results, summary });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to test credentials.";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
