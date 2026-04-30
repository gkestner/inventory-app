function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const SCANNER_COUNT_REPORT_KEY = "scannerCountReport";

export type ScannerCountReportPreferences = {
  resetAt: string | null;
};

export function getScannerCountReportPreferences(uiPreferences: unknown): ScannerCountReportPreferences {
  const root = asRecord(uiPreferences);
  const prefs = asRecord(root[SCANNER_COUNT_REPORT_KEY]);
  const resetAtRaw = prefs.resetAt;
  const resetAt = typeof resetAtRaw === "string" && resetAtRaw.trim() ? resetAtRaw.trim() : null;
  return { resetAt };
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
    },
  };
}