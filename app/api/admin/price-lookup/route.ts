import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getServerSession } from "next-auth";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const runtime = "nodejs";

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

function cleanPartNumber(value: unknown): string {
  return String(value ?? "")
    .trim()
    .slice(0, 120);
}

function toFinitePrice(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
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
  const includeVendors = normalizeVendorList(body.includeVendors);
  const excludeVendors = normalizeVendorList(body.excludeVendors);

  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: "Missing OpenAI API key. Set OPENAI_API_KEY (or OPENAI_KEY) in your server environment.",
    }, { status: 500 });
  }

  const client = new OpenAI({ apiKey });

  const prompt = [
    "You are a sourcing analyst for restaurant maintenance parts.",
    `Find online offers for this exact part number: ${partNumber}`,
    "Return only valid buy-page URLs.",
    "Prefer US suppliers and include item title, vendor, price, currency, shipping (if visible), stock status (if visible).",
    includeVendors.length > 0
      ? `Prioritize these vendors when available: ${includeVendors.join(", ")}.`
      : "",
    excludeVendors.length > 0
      ? `Exclude these vendors from results: ${excludeVendors.join(", ")}.`
      : "",
    `Return up to ${maxResults} results sorted by lowest total price first.`,
    "Respond as strict JSON with this shape and no extra text:",
    '{"summary":"short text","results":[{"vendor":"","title":"","price":0,"currency":"USD","url":"https://...","shipping":"","inStock":"","notes":""}]}'
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      tools: [{ type: "web_search_preview" }],
      input: prompt,
      max_output_tokens: 1400,
    });

    const outputText = (response.output_text ?? "").trim();
    const parsed = extractJson(outputText);

    if (!parsed || !Array.isArray(parsed.results)) {
      return NextResponse.json({ error: "Unable to parse AI response." }, { status: 502 });
    }

    const normalized = parsed.results
      .map((row): PriceResult | null => {
        const url = String(row?.url ?? "").trim();
        if (!/^https?:\/\//i.test(url)) return null;

        return {
          vendor: String(row?.vendor ?? "Unknown Vendor").trim() || "Unknown Vendor",
          title: String(row?.title ?? partNumber).trim() || partNumber,
          price: toFinitePrice((row as { price?: unknown }).price),
          currency: String(row?.currency ?? "USD").trim() || "USD",
          url,
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
      .sort((a, b) => {
        if (a.price == null && b.price == null) return 0;
        if (a.price == null) return 1;
        if (b.price == null) return -1;
        return a.price - b.price;
      })
      .slice(0, maxResults);

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
    const message = error instanceof Error ? error.message : "Price lookup failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
