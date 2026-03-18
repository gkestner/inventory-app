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

function compareByIncludePriority(a: PriceResult, b: PriceResult, includeRules: string[]): number {
  const aPreferred = matchesVendorRule(a.vendor, includeRules) ? 0 : 1;
  const bPreferred = matchesVendorRule(b.vendor, includeRules) ? 0 : 1;
  if (aPreferred !== bPreferred) return aPreferred - bPreferred;
  return compareByLowestPrice(a, b);
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

function collectResponseTexts(response: unknown): string[] {
  const r = response as {
    output_text?: unknown;
    output?: Array<{
      content?: Array<{ text?: unknown }>;
    }>;
  };

  const out: string[] = [];
  if (typeof r.output_text === "string" && r.output_text.trim()) {
    out.push(r.output_text);
  }

  const output = Array.isArray(r.output) ? r.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const c of content) {
      if (typeof c?.text === "string" && c.text.trim()) {
        out.push(c.text);
      }
    }
  }

  return out;
}

function extractJsonFromResponse(response: unknown): ModelPayload | null {
  const r = response as {
    output_text?: unknown;
    output?: Array<{
      content?: Array<{ text?: unknown; json?: unknown }>;
    }>;
  };

  const candidates: string[] = [];
  if (typeof r.output_text === "string") {
    candidates.push(r.output_text);
  }

  const output = Array.isArray(r.output) ? r.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const c of content) {
      if (typeof c?.json === "object" && c.json && !Array.isArray(c.json)) {
        return c.json as ModelPayload;
      }
      if (typeof c?.text === "string") {
        candidates.push(c.text);
      }
    }
  }

  for (const text of candidates) {
    const parsed = extractJson(text);
    if (parsed) return parsed;
  }

  return null;
}

async function repairModelPayloadFromText(args: {
  client: OpenAI;
  model: string;
  partNumber: string;
  maxResults: number;
  maxOutputTokens: number;
  rawTexts: string[];
  includeVendors: string[];
}): Promise<ModelPayload | null> {
  const { client, model, partNumber, maxResults, maxOutputTokens, rawTexts, includeVendors } = args;
  if (!rawTexts.length) return null;

  const combined = rawTexts.join("\n\n").trim();
  if (!combined) return null;

  const repairPrompt = [
    "Normalize the following source text into strict JSON only.",
    `Part number: ${partNumber}`,
    `Return at most ${maxResults} results.`,
    "Do not invent offers. If price is missing, set price to null.",
    rawTexts.length > 0 && includeVendors.length > 0
      ? `Prefer results from these sites when present: ${includeVendors.join(", ")}. You may keep strong results from other sites too.`
      : "",
    "Output schema must be exactly: {\"summary\":\"\",\"results\":[{\"vendor\":\"\",\"title\":\"\",\"price\":null,\"currency\":\"USD\",\"url\":\"https://...\",\"matchType\":\"exact\",\"matchedPartNumber\":\"\",\"shipping\":\"\",\"inStock\":\"\",\"notes\":\"\"}]}",
    "Source text:",
    combined.slice(0, 12000),
  ].filter(Boolean).join("\n");

  const repairedResponse = await client.responses.create({
    model,
    input: repairPrompt,
    max_output_tokens: Math.min(2200, Math.max(900, maxOutputTokens)),
    text: {
      format: {
        type: "json_schema",
        name: "price_lookup_repair",
        schema: LOOKUP_JSON_SCHEMA,
        strict: true,
      },
    },
  });

  return extractJsonFromResponse(repairedResponse);
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
  if (v < 300) return 300;
  if (v > 4000) return 4000;
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
  const envTokenCap = parseTokenLimit(process.env.OPENAI_PRICE_LOOKUP_MAX_TOKENS, 1400);
  const dynamicTokenCap = Math.min(2200, 500 + maxResults * 150);
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
      ? `IMPORTANT: Prioritize searching these websites for this part: ${includeVendors.join(", ")}. Use site-search where helpful (e.g., site:example.com ${partNumber}) and prefer results from those sites, but you may also include strong matches from other vendors.`
      : "",
    excludeVendors.length > 0
      ? `Do NOT include any results from these vendors or domains: ${excludeVendors.join(", ")}.`
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

    const parsed = extractJsonFromResponse(response);
    const rawTexts = collectResponseTexts(response);
    const repairedParsed = !parsed
      ? await repairModelPayloadFromText({
          client,
          model,
          partNumber,
          maxResults,
          maxOutputTokens,
          rawTexts,
          includeVendors,
        }).catch(() => null)
      : null;
    const finalParsed = parsed ?? repairedParsed;
    const incompleteReason = String(
      (response as unknown as { incomplete_details?: { reason?: unknown } }).incomplete_details?.reason ?? ""
    ).trim();

    if (!finalParsed || !Array.isArray(finalParsed.results)) {
      return NextResponse.json({
        partNumber,
        summary:
          incompleteReason === "max_output_tokens"
            ? "AI response was truncated by token limit. Showing direct vendor search links as fallback."
            : "AI returned a non-standard response. Showing direct vendor search links as fallback.",
        results: [],
        fallbackLinks: getFallbackLinks(partNumber),
        warning:
          incompleteReason === "max_output_tokens"
            ? "AI output hit max token limit before finishing JSON. You can still use the links below."
            : "Unable to parse AI response. You can still use the links below.",
        filters: {
          includeVendors,
          excludeVendors,
        },
        generatedAt: new Date().toISOString(),
      });
    }

    const normalizedBase = finalParsed.results
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
        return true;
      });

    const rankedBase = [...normalizedBase].sort((a, b) => {
      if (includeVendors.length > 0) {
        return compareByIncludePriority(a, b, includeVendors);
      }
      return compareByLowestPrice(a, b);
    });

    const exactMatches = rankedBase.filter((r) => r.matchType !== "alternative");
    const alternatives = rankedBase.filter((r) => r.matchType === "alternative");
    const normalized = [...exactMatches, ...alternatives].slice(0, maxResults);
    const finalSummary =
      normalized.length === 0 && finalParsed.results.length > 0
        ? "Offers were found but filtered out by current rules. Try clearing exclude filters."
        : String(finalParsed.summary ?? "").trim();

    return NextResponse.json({
      partNumber,
      summary: finalSummary,
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
