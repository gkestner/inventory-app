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

export type AdminSidebarItemPreference =
  | { type: "preset"; key: string }
  | { type: "custom"; label: string; href: string };

export type AdminSidebarPreferences = {
  items: AdminSidebarItemPreference[];
};

export type ReportHubPreferences = {
  sectionOrder: Record<string, string[]>;
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

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
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

function normalizeInternalHref(v: unknown): string | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  if (/^(https?:|mailto:|tel:)/i.test(raw)) return null;
  if (raw.startsWith("/")) return raw;
  return `/${raw.replace(/^\/+/, "")}`;
}

function normalizeAdminSidebarItem(raw: unknown): AdminSidebarItemPreference | null {
  const obj = asRecord(raw);
  const type = String(obj.type ?? "").trim();

  if (type === "preset") {
    const key = String(obj.key ?? "").trim();
    if (!key) return null;
    return { type: "preset", key };
  }

  if (type === "custom") {
    const label = String(obj.label ?? "").trim();
    const href = normalizeInternalHref(obj.href);
    if (!label || !href) return null;
    return { type: "custom", label, href };
  }

  return null;
}

/**
 * Keys used to hide a user from specific dropdowns across the app.
 * Stored as `uiPreferences.hiddenFromDropdowns` (string[]).
 */
export const DROPDOWN_KEYS = {
  receipts: "receipts",
  checkout: "checkout",
} as const;

export type DropdownKey = (typeof DROPDOWN_KEYS)[keyof typeof DROPDOWN_KEYS];

/** Parse which dropdowns a user is hidden from (stored in uiPreferences JSON). */
export function parseHiddenFromDropdowns(raw: unknown): DropdownKey[] {
  const root = asRecord(raw);
  const arr = root.hiddenFromDropdowns;
  if (!Array.isArray(arr)) return [];
  const valid = new Set<string>(Object.values(DROPDOWN_KEYS));
  return arr.map((x) => String(x ?? "").trim()).filter((x): x is DropdownKey => valid.has(x));
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

export function setNormalizedUserPreferences(raw: unknown, prefs: UserPreferences): Record<string, unknown> {
  const root = asRecord(raw);
  root.theme = prefs.theme;
  root.density = prefs.density;
  root.reducedMotion = prefs.reducedMotion;
  root.labelsDefaultCopies = prefs.labelsDefaultCopies;
  root.labelsAutoprint = prefs.labelsAutoprint;
  root.labelsAutoclose = prefs.labelsAutoclose;
  return root;
}

export function parseAdminSidebarPreferences(raw: unknown): AdminSidebarPreferences | null {
  const root = asRecord(raw);
  if (!hasOwn(root, "adminSidebar")) return null;

  const sidebar = asRecord(root.adminSidebar);
  const items = Array.isArray(sidebar.items)
    ? sidebar.items.map((item) => normalizeAdminSidebarItem(item)).filter((item): item is AdminSidebarItemPreference => item !== null)
    : [];

  return { items };
}

export function setAdminSidebarPreferences(raw: unknown, prefs: AdminSidebarPreferences): Record<string, unknown> {
  const root = asRecord(raw);
  root.adminSidebar = {
    items: prefs.items.map((item) =>
      item.type === "preset"
        ? { type: "preset", key: item.key }
        : { type: "custom", label: item.label, href: item.href },
    ),
  };
  return root;
}

function normalizeReportHubSectionOrder(raw: unknown): Record<string, string[]> {
  const obj = asRecord(raw);
  const out: Record<string, string[]> = {};

  for (const [sectionKey, value] of Object.entries(obj)) {
    const key = String(sectionKey ?? "").trim();
    if (!key || !Array.isArray(value)) continue;
    out[key] = value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }

  return out;
}

export function parseReportHubPreferences(raw: unknown): ReportHubPreferences | null {
  const root = asRecord(raw);
  if (!hasOwn(root, "reportHub")) return null;

  const reportHub = asRecord(root.reportHub);
  return {
    sectionOrder: normalizeReportHubSectionOrder(reportHub.sectionOrder),
  };
}

export function setReportHubPreferences(raw: unknown, prefs: ReportHubPreferences): Record<string, unknown> {
  const root = asRecord(raw);
  root.reportHub = {
    sectionOrder: normalizeReportHubSectionOrder(prefs.sectionOrder),
  };
  return root;
}
