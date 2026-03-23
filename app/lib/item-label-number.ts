export const ITEM_LABEL_NUMBER_MIN_WIDTH = 4;

function toPositiveInteger(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

export function getItemLabelNumberDisplay(value: unknown, minWidth = ITEM_LABEL_NUMBER_MIN_WIDTH): string | null {
  const numeric = toPositiveInteger(value);
  if (numeric === null) return null;
  return String(numeric).padStart(minWidth, "0");
}

export function parseItemLabelNumberSearchTerm(value: string): number | null {
  const trimmed = String(value ?? "").trim();
  if (!/^#?\d+$/.test(trimmed)) return null;
  return toPositiveInteger(trimmed.replace(/^#/, ""));
}