import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { listVendorCredentialsForTest, normalizeSiteKey } from "@/app/lib/vendor-credentials";

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

function hasLoginFields(html: string): { hasUser: boolean; hasPassword: boolean } {
  const src = String(html || "").toLowerCase();
  const hasPassword = /type\s*=\s*["']password["']/.test(src) || /name\s*=\s*["']password["']/.test(src);
  const hasUser =
    /name\s*=\s*["'](email|username|login|userid|user_name|user)["']/.test(src) ||
    /type\s*=\s*["']email["']/.test(src);

  return { hasUser, hasPassword };
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

  const hasProtocol = /^https?:\/\//i.test(site);
  const base = hasProtocol ? site : `https://${site}`;
  const candidates = [base, `${base.replace(/\/+$/, "")}/login`, `${base.replace(/\/+$/, "")}/account/login`];

  for (const url of candidates) {
    try {
      const { status, finalUrl, body } = await fetchHtml(url, 8000);
      if (status >= 400) continue;

      const { hasUser, hasPassword } = hasLoginFields(body);
      if (hasUser && hasPassword) {
        return {
          site,
          status: "ok",
          message: `Login form detected (${finalUrl}).`,
          checkedAt,
        };
      }

      if (body.length > 0) {
        return {
          site,
          status: "warning",
          message: `Site reachable but login form not detected (${finalUrl}).`,
          checkedAt,
        };
      }

      return {
        site,
        status: "warning",
        message: `Site reachable (${finalUrl}) but returned non-HTML content.`,
        checkedAt,
      };
    } catch {
      // Try next candidate endpoint.
    }
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
