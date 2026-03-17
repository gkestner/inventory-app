type PriceLookupPreferences = {
  includeVendors: string[];
  excludeVendors: string[];
};

const PRICE_LOOKUP_PREFS_KEY = "priceLookupPreferences";

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeVendorList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const raw of value) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    out.add(v.toLowerCase().slice(0, 120));
  }
  return Array.from(out);
}

export function getPriceLookupPreferences(uiPreferences: unknown): PriceLookupPreferences {
  const root = toObject(uiPreferences);
  const prefs = toObject(root[PRICE_LOOKUP_PREFS_KEY]);

  return {
    includeVendors: normalizeVendorList(prefs.includeVendors),
    excludeVendors: normalizeVendorList(prefs.excludeVendors),
  };
}

export function setPriceLookupPreferences(
  uiPreferences: unknown,
  args: { includeVendors?: unknown; excludeVendors?: unknown }
): Record<string, unknown> {
  const root = toObject(uiPreferences);
  const current = getPriceLookupPreferences(uiPreferences);

  const next: PriceLookupPreferences = {
    includeVendors:
      typeof args.includeVendors === "undefined" ? current.includeVendors : normalizeVendorList(args.includeVendors),
    excludeVendors:
      typeof args.excludeVendors === "undefined" ? current.excludeVendors : normalizeVendorList(args.excludeVendors),
  };

  return {
    ...root,
    [PRICE_LOOKUP_PREFS_KEY]: next,
  };
}
