function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => String(entry ?? "").trim()).filter(Boolean)));
}

const SCANNER_COUNT_REPORT_KEY = "scannerCountReport";

export type ScannerCountReportPreferences = {
  resetAt: string | null;
  hiddenItemIds: string[];
};

export function getScannerCountReportPreferences(uiPreferences: unknown): ScannerCountReportPreferences {
  const root = asRecord(uiPreferences);
  const prefs = asRecord(root[SCANNER_COUNT_REPORT_KEY]);
  const resetAtRaw = prefs.resetAt;
  const resetAt = typeof resetAtRaw === "string" && resetAtRaw.trim() ? resetAtRaw.trim() : null;
  const hiddenItemIds = normalizeStringArray(prefs.hiddenItemIds);
  return { resetAt, hiddenItemIds };
}

export function setScannerCountReportPreferences(
  uiPreferences: unknown,
  prefs: ScannerCountReportPreferences
): Record<string, unknown> {
  const root = asRecord(uiPreferences);
  return {
    ...root,
    [SCANNER_COUNT_REPORT_KEY]: {
      resetAt: prefs.resetAt,
      hiddenItemIds: normalizeStringArray(prefs.hiddenItemIds),
    },
  };
}