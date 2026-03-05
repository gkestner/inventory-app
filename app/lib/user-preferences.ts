export type ThemeMode = "system" | "light" | "dark";
export type DensityMode = "comfortable" | "compact";

export type UserPreferences = {
  theme: ThemeMode;
  density: DensityMode;
  reducedMotion: boolean;
  labelsDefaultCopies: number;
  labelsAutoprint: boolean;
  labelsAutoclose: boolean;
};

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: "system",
  density: "comfortable",
  reducedMotion: false,
  labelsDefaultCopies: 1,
  labelsAutoprint: false,
  labelsAutoclose: false,
};

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function toTheme(v: unknown): ThemeMode {
  return v === "light" || v === "dark" || v === "system" ? v : DEFAULT_USER_PREFERENCES.theme;
}

function toDensity(v: unknown): DensityMode {
  return v === "compact" || v === "comfortable" ? v : DEFAULT_USER_PREFERENCES.density;
}

function toBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "1" || v === 1 || v === "true") return true;
  if (v === "0" || v === 0 || v === "false") return false;
  return fallback;
}

function toCopies(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_USER_PREFERENCES.labelsDefaultCopies;
  return Math.max(1, Math.min(20, Math.floor(n)));
}

export function normalizeUserPreferences(raw: unknown): UserPreferences {
  const obj = asRecord(raw);
  return {
    theme: toTheme(obj.theme),
    density: toDensity(obj.density),
    reducedMotion: toBool(obj.reducedMotion, DEFAULT_USER_PREFERENCES.reducedMotion),
    labelsDefaultCopies: toCopies(obj.labelsDefaultCopies),
    labelsAutoprint: toBool(obj.labelsAutoprint, DEFAULT_USER_PREFERENCES.labelsAutoprint),
    labelsAutoclose: toBool(obj.labelsAutoclose, DEFAULT_USER_PREFERENCES.labelsAutoclose),
  };
}
