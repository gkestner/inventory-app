import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getServerSession } from "next-auth";
import { Permission, type Prisma } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { getPriceLookupPreferences, setPriceLookupPreferences } from "@/app/lib/price-lookup-preferences";

export const runtime = "nodejs";

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

type ModelPayload = {
  summary?: string;
  results?: PriceResult[];
};

type LookupBody = {
  partNumber?: unknown;
  maxResults?: unknown;
  includeVendors?: unknown;
  excludeVendors?: unknown;
};

const LOOKUP_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          vendor: { type: "string" },
          title: { type: "string" },
          price: { anyOf: [{ type: "number" }, { type: "null" }] },
          currency: { type: "string" },
          url: { type: "string" },
          matchType: { type: "string", enum: ["exact", "alternative"] },
          matchedPartNumber: { anyOf: [{ type: "string" }, { type: "null" }] },
          shipping: { anyOf: [{ type: "string" }, { type: "null" }] },
          inStock: { anyOf: [{ type: "string" }, { type: "null" }] },
          notes: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: [
          "vendor",
          "title",
          "price",
          "currency",
          "url",
          "matchType",
          "matchedPartNumber",
          "shipping",
          "inStock",
          "notes",
        ],
      },
    },
  },
  required: ["summary", "results"],
} as const;

function cleanPartNumber(value: unknown): string {
  return String(value ?? "")
    .trim()
    .slice(0, 120);
}

function toFinitePrice(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function compareByLowestPrice(a: PriceResult, b: PriceResult): number {
  if (a.price == null && b.price == null) return 0;
  if (a.price == null) return 1;
  if (b.price == null) return -1;
  return a.price - b.price;
}

function normalizeVendorList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const raw of value) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    out.add(v.toLowerCase());
  }
  return Array.from(out);
}

function matchesVendorRule(vendor: string, rules: string[]): boolean {
  const v = vendor.toLowerCase();
  return rules.some((r) => v.includes(r));
}

function extractJson(text: string): ModelPayload | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch?.[1] ?? trimmed;

  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < 0 || lastBrace <= firstBrace) return null;

  const jsonText = candidate.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonText) as ModelPayload;
  } catch {
    return null;
  }
}

function getFallbackLinks(partNumber: string): FallbackLink[] {
  const q = encodeURIComponent(partNumber.trim());
  return [
    { vendor: "Parts Town", url: `https://www.partstown.com/search?q=${q}` },
    { vendor: "WebstaurantStore", url: `https://www.webstaurantstore.com/search/${q}.html` },
    { vendor: "Grainger", url: `https://www.grainger.com/search?searchQuery=${q}` },
    { vendor: "KaTom", url: `https://www.katom.com/search?w=${q}` },
    { vendor: "Parts FPS", url: `https://www.partsfps.com/search?type=product&q=${q}` },
  ];
}

function detectQuotaOrRateLimit(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: unknown; code?: unknown; message?: unknown; error?: { code?: unknown; type?: unknown } };
  const status = Number(e.status);
  if (status === 429) return true;

  const code = String(e.code ?? e.error?.code ?? "").toLowerCase();
  if (code.includes("insufficient_quota") || code.includes("rate_limit")) return true;

  const message = String(e.message ?? "").toLowerCase();
  return message.includes("exceeded your current quota") || message.includes("rate limit");
}

function parseTokenLimit(raw: string | undefined, fallback: number): number {
  const n = Number(raw ?? "");
  if (!Number.isFinite(n)) return fallback;
  const v = Math.trunc(n);
  if (v < 200) return 200;
  if (v > 2000) return 2000;
  return v;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadUserPermissions(session);
  const canUse = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!canUse) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as LookupBody;
  const partNumber = cleanPartNumber(body.partNumber);
  if (!partNumber) {
    return NextResponse.json({ error: "Part number is required." }, { status: 400 });
  }

  const maxResultsRaw = Number(body.maxResults);
  const maxResults = Number.isFinite(maxResultsRaw) ? Math.min(12, Math.max(1, Math.trunc(maxResultsRaw))) : 8;
  const includeVendorsInput = normalizeVendorList(body.includeVendors);
  const excludeVendorsInput = normalizeVendorList(body.excludeVendors);

  const sessionUserId = (session.user as unknown as { id?: string | null } | null)?.id ?? null;
  const sessionEmail = (session.user as unknown as { email?: string | null } | null)?.email ?? null;
  const currentUser = sessionUserId
    ? await prisma.user.findUnique({ where: { id: sessionUserId }, select: { id: true, uiPreferences: true } })
    : sessionEmail
      ? await prisma.user.findUnique({ where: { email: sessionEmail }, select: { id: true, uiPreferences: true } })
      : null;

  const savedPrefs = getPriceLookupPreferences(currentUser?.uiPreferences);
  const includeVendors = includeVendorsInput.length > 0 ? includeVendorsInput : savedPrefs.includeVendors;
  const excludeVendors = excludeVendorsInput.length > 0 ? excludeVendorsInput : savedPrefs.excludeVendors;

  if (currentUser?.id) {
    const nextUiPreferences = setPriceLookupPreferences(currentUser.uiPreferences, {
      includeVendors: includeVendorsInput,
      excludeVendors: excludeVendorsInput,
    });
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { uiPreferences: nextUiPreferences as Prisma.InputJsonValue },
      select: { id: true },
    });
  }

  const apiKey =
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_KEY ||
    process.env.OPENAI_APIKEY ||
    process.env.OPENAIKEY ||
    process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error:
        "Missing OpenAI API key. Set OPENAI_API_KEY (or OPENAI_KEY). Also accepted: OPENAI_APIKEY, OPENAIKEY.",
    }, { status: 500 });
  }

  const client = new OpenAI({ apiKey });
  const model = String(process.env.OPENAI_PRICE_LOOKUP_MODEL || "gpt-4.1-mini").trim() || "gpt-4.1-mini";
  const envTokenCap = parseTokenLimit(process.env.OPENAI_PRICE_LOOKUP_MAX_TOKENS, 700);
  const dynamicTokenCap = Math.min(900, 260 + maxResults * 70);
  const maxOutputTokens = Math.min(envTokenCap, dynamicTokenCap);

  const prompt = [
    "You are a sourcing analyst for restaurant maintenance parts.",
    `Find online offers for this exact part number: ${partNumber}.`,
    "Also include compatible alternatives / replacements when available.",
    "Set matchType='exact' for direct part matches and matchType='alternative' for substitutes.",
    "If alternative, include matchedPartNumber with the alternative/replacement number.",
    "If exact and part number is clear, matchedPartNumber can repeat the same part number.",
    "Return only valid buy-page URLs.",
    "If a page does not show a real price, set price to null. Never use 0 as a placeholder price.",
    "Prefer US suppliers and include item title, vendor, price, currency, shipping (if visible), stock status (if visible).",
    includeVendors.length > 0
      ? `Prioritize these vendors when available: ${includeVendors.join(", ")}.`
      : "",
    excludeVendors.length > 0
      ? `Exclude these vendors from results: ${excludeVendors.join(", ")}.`
      : "",
    "Keep the summary under 20 words and keep notes concise.",
    `Return up to ${maxResults} results sorted by lowest total price first.`,
    "Respond as strict JSON with this shape and no extra text:",
    '{"summary":"short text","results":[{"vendor":"","title":"","price":0,"currency":"USD","url":"https://...","matchType":"exact","matchedPartNumber":"","shipping":"","inStock":"","notes":""}]}'
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await client.responses.create({
      model,
      tools: [{ type: "web_search_preview" }],
      input: prompt,
      max_output_tokens: maxOutputTokens,
      text: {
        format: {
          type: "json_schema",
          name: "price_lookup",
          schema: LOOKUP_JSON_SCHEMA,
          strict: true,
        },
      },
    });

    const outputText = (response.output_text ?? "").trim();
    const parsed = extractJson(outputText);

    if (!parsed || !Array.isArray(parsed.results)) {
      return NextResponse.json({
        partNumber,
        summary: "AI returned a non-standard response. Showing direct vendor search links as fallback.",
        results: [],
        fallbackLinks: getFallbackLinks(partNumber),
        warning: "Unable to parse AI response. You can still use the links below.",
        filters: {
          includeVendors,
          excludeVendors,
        },
        generatedAt: new Date().toISOString(),
      });
    }

    const normalizedBase = parsed.results
      .map((row): PriceResult | null => {
        const url = String(row?.url ?? "").trim();
        if (!/^https?:\/\//i.test(url)) return null;

        return {
          vendor: String(row?.vendor ?? "Unknown Vendor").trim() || "Unknown Vendor",
          title: String(row?.title ?? partNumber).trim() || partNumber,
          price: toFinitePrice((row as { price?: unknown }).price),
          currency: String(row?.currency ?? "USD").trim() || "USD",
          url,
          matchType:
            String((row as { matchType?: unknown }).matchType ?? "exact").trim().toLowerCase() === "alternative"
              ? "alternative"
              : "exact",
          matchedPartNumber: String((row as { matchedPartNumber?: unknown }).matchedPartNumber ?? "").trim() || undefined,
          shipping: String(row?.shipping ?? "").trim() || undefined,
          inStock: String(row?.inStock ?? "").trim() || undefined,
          notes: String(row?.notes ?? "").trim() || undefined,
        };
      })
      .filter((row): row is PriceResult => row !== null)
      .filter((row) => {
        if (excludeVendors.length > 0 && matchesVendorRule(row.vendor, excludeVendors)) return false;
        if (includeVendors.length > 0 && !matchesVendorRule(row.vendor, includeVendors)) return false;
        return true;
      })
      .sort(compareByLowestPrice);

    const exactMatches = normalizedBase.filter((r) => r.matchType !== "alternative").sort(compareByLowestPrice);
    const alternatives = normalizedBase.filter((r) => r.matchType === "alternative").sort(compareByLowestPrice);
    const normalized = [...exactMatches, ...alternatives].slice(0, maxResults);

    return NextResponse.json({
      partNumber,
      summary: String(parsed.summary ?? "").trim(),
      results: normalized,
      filters: {
        includeVendors,
        excludeVendors,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (detectQuotaOrRateLimit(error)) {
      return NextResponse.json({
        partNumber,
        summary: "OpenAI quota/rate limit reached. Showing direct vendor search links as fallback.",
        results: [],
        fallbackLinks: getFallbackLinks(partNumber),
        warning:
          "OpenAI quota exceeded or rate-limited. Add billing/credits or wait for reset. You can still use the links below.",
        filters: {
          includeVendors,
          excludeVendors,
        },
        generatedAt: new Date().toISOString(),
      });
    }

    const message = error instanceof Error ? error.message : "Price lookup failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
