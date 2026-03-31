export type SkuRoomParts = {
  location: string;
  shelf: string;
  bin: string;
};

export type StructuredSkuParts = SkuRoomParts & {
  zone: string;
  itemKey: string;
};

export function normalizeSkuPartInput(value: string): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 2);
}

export function normalizeSkuLocationInput(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  // Allow users to type "Vault" for the maintenance location.
  if ("vault".startsWith(raw.toLowerCase())) return raw.slice(0, 5);

  return raw.replace(/\D/g, "").slice(0, 2);
}

export function isValidTwoDigitSkuPart(value: string): boolean {
  return /^\d{1,2}$/.test(String(value ?? "").trim());
}

export function isValidSkuLocationPart(value: string): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "vault" || /^\d{1,2}$/.test(normalized);
}

export function inferSkuZone(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  const inferred = digits.slice(0, 2);
  return inferred.length === 2 ? inferred : "01";
}

export function parseStructuredSkuParts(sku: string): StructuredSkuParts | null {
  const raw = String(sku ?? "").trim();
  if (!raw) return null;

  // Check for vault format: VT<shelf><bin> - <key>
  const vaultRoomMatch = raw.match(/^VT(\d{4})\s*-\s*(.+)$/);
  if (vaultRoomMatch) {
    const shelfBin = vaultRoomMatch[1];
    const itemKey = String(vaultRoomMatch[2] ?? "").trim();
    if (itemKey) {
      return {
        zone: "VT",
        location: "vault",
        shelf: shelfBin.slice(0, 2),
        bin: shelfBin.slice(2, 4),
        itemKey,
      };
    }
  }

  const compactRoomMatch = raw.match(/^(\d{6})\s*-\s*(.+)$/);
  if (compactRoomMatch) {
    const middleDigits = compactRoomMatch[1];
    const itemKey = String(compactRoomMatch[2] ?? "").trim();
    if (itemKey) {
      return {
        zone: middleDigits.slice(0, 2),
        location: middleDigits.slice(0, 2),
        shelf: middleDigits.slice(2, 4),
        bin: middleDigits.slice(4, 6),
        itemKey,
      };
    }
  }

  const segments = raw.split("-");
  if (segments.length >= 2) {
    const firstHyphen = raw.indexOf("-");
    const lastHyphen = raw.lastIndexOf("-");
    const zone = inferSkuZone(String(segments[0] ?? ""));
    const middleRaw = lastHyphen > firstHyphen ? raw.slice(firstHyphen + 1, lastHyphen) : "";
    const middleDigits = middleRaw.replace(/\D/g, "");
    const reversed = [...segments].reverse().map((segment) => String(segment ?? "").trim());
    const itemKey = reversed.find((segment) => segment.length > 0) ?? "";

    if (itemKey) {
      return {
        zone,
        location: middleDigits.slice(0, 2),
        shelf: middleDigits.slice(2, 4),
        bin: middleDigits.slice(4, 6),
        itemKey,
      };
    }
  }

  return {
    zone: inferSkuZone(raw),
    location: "",
    shelf: "",
    bin: "",
    itemKey: raw,
  };
}

export function buildStructuredSku(zone: string, location: string, shelf: string, bin: string, itemKey: string): string {
  void zone;
  
  // Handle vault location specially
  if (location.toLowerCase() === "vault") {
    const shelfCode = String(shelf ?? "").padStart(2, "0");
    const binCode = String(bin ?? "").padStart(2, "0");
    return `VT${shelfCode}${binCode} - ${itemKey}`;
  }
  
  // Handle normal numeric locations
  const locCode = String(location ?? "").padStart(2, "0");
  const shelfCode = String(shelf ?? "").padStart(2, "0");
  const binCode = String(bin ?? "").padStart(2, "0");
  return `${locCode}${shelfCode}${binCode} - ${itemKey}`;
}

export function parseSkuRoomParts(sku: string): SkuRoomParts | null {
  const parsed = parseStructuredSkuParts(sku);
  if (!parsed) return null;
  return {
    location: parsed.location,
    shelf: parsed.shelf,
    bin: parsed.bin,
  };
}