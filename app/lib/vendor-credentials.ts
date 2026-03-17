import crypto from "crypto";

export type VendorVaultEntry = {
  label?: string;
  siteRaw?: string;
  usernameEnc: string;
  passwordEnc: string;
  updatedAt: string;
};

export type VendorVault = Record<string, VendorVaultEntry>;

export type VendorCredentialSummary = {
  label?: string;
  site: string;
  username: string;
  hasPassword: boolean;
  updatedAt: string;
};

export type VendorCredentialForTest = {
  label?: string;
  site: string;
  username: string;
  password: string;
};

const VAULT_KEY = "vendorAuthVault";

function getCipherKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || "";
  if (!raw.trim()) {
    throw new Error("Missing CREDENTIAL_ENCRYPTION_KEY (or NEXTAUTH_SECRET) for credential encryption.");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

function encryptText(plain: string): string {
  const key = getCipherKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${body.toString("base64")}`;
}

function decryptText(payload: string): string {
  const [ivB64, tagB64, bodyB64] = String(payload || "").split(".");
  if (!ivB64 || !tagB64 || !bodyB64) throw new Error("Invalid encrypted payload format.");

  const key = getCipherKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const body = Buffer.from(bodyB64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(body), decipher.final()]);
  return out.toString("utf8");
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function normalizeSiteKey(input: unknown): string {
  // Preserve the user-entered site/path exactly (except outer whitespace) so URLs are never rewritten.
  return String(input ?? "").trim().slice(0, 512);
}

export function getVaultFromUiPreferences(uiPreferences: unknown): VendorVault {
  const root = toObject(uiPreferences);
  const vaultRaw = toObject(root[VAULT_KEY]);
  const out: VendorVault = {};

  for (const [site, row] of Object.entries(vaultRaw)) {
    const key = normalizeSiteKey(site);
    if (!key) continue;
    const item = toObject(row);
    const label = String(item.label ?? "").trim().slice(0, 120);
    const siteRaw = String(item.siteRaw ?? site).trim();
    const usernameEnc = String(item.usernameEnc ?? "").trim();
    const passwordEnc = String(item.passwordEnc ?? "").trim();
    const updatedAt = String(item.updatedAt ?? "").trim() || new Date(0).toISOString();
    if (!usernameEnc || !passwordEnc) continue;
    out[key] = { label, siteRaw, usernameEnc, passwordEnc, updatedAt };
  }

  return out;
}

export function getConfiguredVendorSites(uiPreferences: unknown): string[] {
  return Object.values(getVaultFromUiPreferences(uiPreferences)).map((x) => String(x.siteRaw ?? "").trim()).filter(Boolean);
}

export function listVendorCredentials(uiPreferences: unknown): VendorCredentialSummary[] {
  const vault = getVaultFromUiPreferences(uiPreferences);
  const rows: VendorCredentialSummary[] = [];

  for (const [site, entry] of Object.entries(vault)) {
    try {
      const username = decryptText(entry.usernameEnc);
      const displaySite = String(entry.siteRaw ?? site).trim() || site;
      rows.push({
        label: String(entry.label ?? "").trim() || undefined,
        site: displaySite,
        username,
        hasPassword: true,
        updatedAt: entry.updatedAt,
      });
    } catch {
      // Skip unreadable entries rather than failing entire page.
    }
  }

  rows.sort((a, b) => (a.label || a.site).localeCompare(b.label || b.site));
  return rows;
}

export function listVendorCredentialsForTest(uiPreferences: unknown): VendorCredentialForTest[] {
  const vault = getVaultFromUiPreferences(uiPreferences);
  const rows: VendorCredentialForTest[] = [];

  for (const [site, entry] of Object.entries(vault)) {
    try {
      const username = decryptText(entry.usernameEnc);
      const password = decryptText(entry.passwordEnc);
      const displaySite = String(entry.siteRaw ?? site).trim() || site;
      rows.push({ label: String(entry.label ?? "").trim() || undefined, site: displaySite, username, password });
    } catch {
      // Skip unreadable entries rather than failing entire probe.
    }
  }

  rows.sort((a, b) => (a.label || a.site).localeCompare(b.label || b.site));
  return rows;
}

export function upsertVendorCredential(uiPreferences: unknown, args: { label?: string; site: string; username: string; password: string }) {
  const label = String(args.label ?? "").trim().slice(0, 120);
  const rawSite = String(args.site ?? "").trim();
  const site = normalizeSiteKey(rawSite);
  const username = String(args.username ?? "").trim();
  const password = String(args.password ?? "").trim();

  if (!site) throw new Error("Site is required.");
  if (!username) throw new Error("Username is required.");
  if (!password) throw new Error("Password is required.");

  const root = toObject(uiPreferences);
  const vault = getVaultFromUiPreferences(uiPreferences);
  vault[site] = {
    label,
    siteRaw: rawSite,
    usernameEnc: encryptText(username),
    passwordEnc: encryptText(password),
    updatedAt: new Date().toISOString(),
  };

  return {
    ...root,
    [VAULT_KEY]: vault,
  };
}

export function updateVendorCredential(
  uiPreferences: unknown,
  args: { site: string; nextSite?: string; label?: string; username?: string; password?: string }
) {
  const rawSite = String(args.site ?? "").trim();
  const rawNextSite = String(args.nextSite ?? args.site ?? "").trim();
  const nextLabel = typeof args.label === "string" ? args.label.trim().slice(0, 120) : undefined;
  const site = normalizeSiteKey(rawSite);
  const nextSite = normalizeSiteKey(rawNextSite);
  const nextUsernameRaw = typeof args.username === "string" ? args.username.trim() : "";
  const nextPasswordRaw = typeof args.password === "string" ? args.password.trim() : "";

  if (!site) throw new Error("Site is required.");
  if (!nextSite) throw new Error("Next site is required.");

  const root = toObject(uiPreferences);
  const vault = getVaultFromUiPreferences(uiPreferences);
  const existing = vault[site];
  if (!existing) throw new Error("Credential not found for site.");

  if (site !== nextSite && vault[nextSite]) {
    throw new Error("A credential already exists for that site.");
  }

  const username = nextUsernameRaw || decryptText(existing.usernameEnc);
  const password = nextPasswordRaw || decryptText(existing.passwordEnc);

  if (!username) throw new Error("Username is required.");
  if (!password) throw new Error("Password is required.");

  if (site !== nextSite) delete vault[site];

  vault[nextSite] = {
    label: nextLabel ?? String(existing.label ?? "").trim(),
    siteRaw: rawNextSite,
    usernameEnc: encryptText(username),
    passwordEnc: encryptText(password),
    updatedAt: new Date().toISOString(),
  };

  return {
    ...root,
    [VAULT_KEY]: vault,
  };
}

export function removeVendorCredential(uiPreferences: unknown, siteInput: unknown) {
  const site = normalizeSiteKey(siteInput);
  if (!site) throw new Error("Site is required.");

  const root = toObject(uiPreferences);
  const vault = getVaultFromUiPreferences(uiPreferences);
  delete vault[site];

  return {
    ...root,
    [VAULT_KEY]: vault,
  };
}
