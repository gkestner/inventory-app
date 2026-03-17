import type { VendorCredentialForTest } from "@/app/lib/vendor-credentials";

export type PartsTownBrowserLoginResult = {
  status: "ok" | "blocked" | "failed";
  message: string;
};

export type PartsTownBrowserPriceResult = {
  status: "authenticated" | "blocked" | "failed";
  price: number | null;
  currency?: string;
  inStock?: string;
  notes: string;
};

function parseHost(input: string): string {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isPartsTownSite(input: string): boolean {
  const raw = String(input || "").trim();
  const host = /^https?:\/\//i.test(raw) ? parseHost(raw) : parseHost(`https://${raw}`);
  return host === "partstown.com" || host.endsWith(".partstown.com") || host.includes("partstown");
}

function detectBotBlock(text: string): { blocked: boolean; provider?: string } {
  const src = String(text || "").toLowerCase();
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

function looksLikeLoginPage(text: string): boolean {
  const src = String(text || "").toLowerCase();
  return (
    src.includes("forgot your password") &&
    src.includes("remember me") &&
    src.includes("create an account") &&
    src.includes("email address") &&
    src.includes("password")
  );
}

function looksLoggedIn(text: string): boolean {
  const src = String(text || "").toLowerCase();
  return (
    src.includes("my location") ||
    src.includes("track my order") ||
    src.includes("add to my parts") ||
    src.includes("your cart") ||
    src.includes("multi-sku order")
  );
}

function extractPriceFromHtml(html: string): { price: number | null; currency?: string } {
  const src = String(html || "");

  const jsonPrice = src.match(/"price"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/i);
  if (jsonPrice?.[1]) {
    const price = Number(jsonPrice[1]);
    if (Number.isFinite(price) && price >= 0) return { price, currency: "USD" };
  }

  const itemprop = src.match(/itemprop=["']price["'][^>]*content=["']([0-9]+(?:\.[0-9]{1,2})?)["']/i);
  if (itemprop?.[1]) {
    const price = Number(itemprop[1]);
    if (Number.isFinite(price) && price >= 0) return { price, currency: "USD" };
  }

  const listPrice = src.match(/list price[^$]{0,80}\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i);
  if (listPrice?.[1]) {
    const price = Number(listPrice[1].replace(/,/g, ""));
    if (Number.isFinite(price) && price >= 0) return { price, currency: "USD" };
  }

  const money = src.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/);
  if (money?.[1]) {
    const price = Number(money[1].replace(/,/g, ""));
    if (Number.isFinite(price) && price >= 0) return { price, currency: "USD" };
  }

  return { price: null };
}

function extractStockFromText(text: string): string | undefined {
  const src = String(text || "").toLowerCase();
  if (src.includes("in stock")) return "In stock";
  if (src.includes("out of stock")) return "Out of stock";
  if (src.includes("backorder")) return "Backorder";
  return undefined;
}

function isSearchUrl(url: string): boolean {
  return String(url || "").toLowerCase().includes("partstown.com/search");
}

function findProductUrl(baseUrl: string, html: string): string | null {
  const src = String(html || "");
  const anchorRegex = /<a\b[^>]*href=["'](https?:\/\/www\.partstown\.com\/[^"'#]+|\/[^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(src)) !== null) {
    const rawHref = String(match[1] || "").trim();
    const anchorText = String(match[2] || "").replace(/<[^>]+>/g, " ").trim();
    if (!rawHref || !anchorText) continue;

    try {
      const resolved = new URL(rawHref, baseUrl).toString();
      const parsed = new URL(resolved);
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (!isPartsTownSite(resolved)) continue;
      if (parts.length < 2) continue;
      if (parsed.pathname.startsWith("/search") || parsed.pathname.startsWith("/login") || parsed.pathname.startsWith("/register")) continue;
      return resolved;
    } catch {
      // Ignore malformed candidate.
    }
  }

  return null;
}

async function getBodyText(page: { locator: (selector: string) => { innerText: () => Promise<string> } }): Promise<string> {
  try {
    return await page.locator("body").innerText();
  } catch {
    return "";
  }
}

async function createBrowserSession() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 960 },
    locale: "en-US",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  return { browser, context, page };
}

async function fillAndSubmitLogin(page: any, credential: VendorCredentialForTest): Promise<void> {
  const email = page.locator('input[type="email"], input[name*="email" i], input[placeholder*="Email" i]').first();
  const password = page.locator('input[type="password"], input[name*="password" i], input[placeholder*="Password" i]').first();

  await email.waitFor({ state: "visible", timeout: 20000 });
  await password.waitFor({ state: "visible", timeout: 20000 });
  await email.fill(credential.username);
  await password.fill(credential.password);

  const submit = page.locator(
    'button:has-text("LOGIN"), button:has-text("Login"), button:has-text("Log In"), input[type="submit"][value*="LOGIN" i], input[type="submit"][value*="Login" i]'
  ).first();

  if ((await submit.count()) > 0) {
    await submit.click();
  } else {
    await password.press("Enter");
  }

  await page.waitForLoadState("domcontentloaded").catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);
}

async function loginToPartsTown(page: any, credential: VendorCredentialForTest): Promise<PartsTownBrowserLoginResult> {
  await page.goto("https://www.partstown.com/login", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);

  const initialText = await getBodyText(page);
  const initialBlock = detectBotBlock(initialText);
  if (initialBlock.blocked) {
    return {
      status: "blocked",
      message: `${initialBlock.provider || "Site security"} challenge blocked browser automation on Parts Town login.`,
    };
  }

  await fillAndSubmitLogin(page, credential);

  const afterText = await getBodyText(page);
  const afterBlock = detectBotBlock(afterText);
  if (afterBlock.blocked) {
    return {
      status: "blocked",
      message: `${afterBlock.provider || "Site security"} challenge blocked browser login on Parts Town.`,
    };
  }

  if (looksLikeLoginPage(afterText)) {
    return {
      status: "failed",
      message: `Parts Town login did not complete successfully (${page.url()}).`,
    };
  }

  if (looksLoggedIn(afterText) || !page.url().toLowerCase().includes("/login")) {
    return {
      status: "ok",
      message: `Parts Town login succeeded in browser session (${page.url()}).`,
    };
  }

  return {
    status: "failed",
    message: `Parts Town login state could not be confirmed (${page.url()}).`,
  };
}

export async function verifyPartsTownCredentialInBrowser(
  credential: VendorCredentialForTest
): Promise<PartsTownBrowserLoginResult> {
  const session = await createBrowserSession();
  try {
    return await loginToPartsTown(session.page, credential);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown browser automation error.";
    if (/Executable doesn't exist/i.test(message) || /Please run the following command to download new browsers/i.test(message)) {
      return {
        status: "blocked",
        message: "Playwright browser runtime is missing on the server. The deployment must run `npx playwright install chromium` during build.",
      };
    }
    return {
      status: "failed",
      message: `Parts Town browser verification failed: ${message}`,
    };
  } finally {
    await session.browser.close().catch(() => null);
  }
}

export async function fetchPartsTownAuthenticatedPriceInBrowser(args: {
  credential: VendorCredentialForTest;
  targetUrl: string;
}): Promise<PartsTownBrowserPriceResult> {
  const session = await createBrowserSession();

  try {
    const login = await loginToPartsTown(session.page, args.credential);
    if (login.status === "blocked") {
      return { status: "blocked", price: null, notes: login.message };
    }
    if (login.status !== "ok") {
      return { status: "failed", price: null, notes: login.message };
    }

    await session.page.goto(args.targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await session.page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);

    let workingUrl = session.page.url();
    let bodyText = await getBodyText(session.page);
    let bodyHtml = await session.page.content();

    const blocked = detectBotBlock(`${bodyText}\n${bodyHtml}`);
    if (blocked.blocked) {
      return {
        status: "blocked",
        price: null,
        notes: `${blocked.provider || "Site security"} blocked Parts Town product fetch (${workingUrl}).`,
      };
    }

    if (looksLikeLoginPage(bodyText)) {
      return {
        status: "failed",
        price: null,
        notes: `Parts Town redirected back to login while fetching pricing (${workingUrl}).`,
      };
    }

    if (isSearchUrl(workingUrl)) {
      const productUrl = findProductUrl(workingUrl, bodyHtml);
      if (productUrl) {
        await session.page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
        await session.page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);
        workingUrl = session.page.url();
        bodyText = await getBodyText(session.page);
        bodyHtml = await session.page.content();
      }
    }

    const price = extractPriceFromHtml(bodyHtml);
    const inStock = extractStockFromText(bodyText);
    if (price.price != null) {
      return {
        status: "authenticated",
        price: price.price,
        currency: price.currency || "USD",
        inStock,
        notes: `Authenticated Parts Town browser session used (${workingUrl}).`,
      };
    }

    return {
      status: "failed",
      price: null,
      inStock,
      notes: `Parts Town browser session succeeded, but no parsable price was found (${workingUrl}).`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown browser automation error.";
    if (/Executable doesn't exist/i.test(message) || /Please run the following command to download new browsers/i.test(message)) {
      return {
        status: "blocked",
        price: null,
        notes: "Playwright browser runtime is missing on the server. The deployment must run `npx playwright install chromium` during build.",
      };
    }
    return {
      status: "failed",
      price: null,
      notes: `Parts Town browser pricing failed: ${message}`,
    };
  } finally {
    await session.browser.close().catch(() => null);
  }
}