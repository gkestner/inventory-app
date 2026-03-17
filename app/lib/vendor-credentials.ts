import crypto from "crypto";

export type VendorVaultEntry = {
  usernameEnc: string;
  passwordEnc: string;
  updatedAt: string;
};

export type VendorVault = Record<string, VendorVaultEntry>;

export type VendorCredentialSummary = {
  site: string;
  username: string;
  hasPassword: boolean;
  updatedAt: string;
};

export type VendorCredentialForTest = {
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
  const raw = String(input ?? "").trim().toLowerCase();
  if (!raw) return "";

  // Accept full URLs and normalize them to just the hostname for stable keys.
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let host = "";
  try {
    host = new URL(withProtocol).hostname.toLowerCase();
  } catch {
    host = raw;
  }

  return host
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
}

export function getVaultFromUiPreferences(uiPreferences: unknown): VendorVault {
  const root = toObject(uiPreferences);
  const vaultRaw = toObject(root[VAULT_KEY]);
  const out: VendorVault = {};

  for (const [site, row] of Object.entries(vaultRaw)) {
    const key = normalizeSiteKey(site);
    if (!key) continue;
    const item = toObject(row);
    const usernameEnc = String(item.usernameEnc ?? "").trim();
    const passwordEnc = String(item.passwordEnc ?? "").trim();
    const updatedAt = String(item.updatedAt ?? "").trim() || new Date(0).toISOString();
    if (!usernameEnc || !passwordEnc) continue;
    out[key] = { usernameEnc, passwordEnc, updatedAt };
  }

  return out;
}

export function getConfiguredVendorSites(uiPreferences: unknown): string[] {
  return Object.keys(getVaultFromUiPreferences(uiPreferences));
}

export function listVendorCredentials(uiPreferences: unknown): VendorCredentialSummary[] {
  const vault = getVaultFromUiPreferences(uiPreferences);
  const rows: VendorCredentialSummary[] = [];

  for (const [site, entry] of Object.entries(vault)) {
    try {
      const username = decryptText(entry.usernameEnc);
      rows.push({
        site,
        username,
        hasPassword: true,
        updatedAt: entry.updatedAt,
      });
    } catch {
      // Skip unreadable entries rather than failing entire page.
    }
  }

  rows.sort((a, b) => a.site.localeCompare(b.site));
  return rows;
}

export function listVendorCredentialsForTest(uiPreferences: unknown): VendorCredentialForTest[] {
  const vault = getVaultFromUiPreferences(uiPreferences);
  const rows: VendorCredentialForTest[] = [];

  for (const [site, entry] of Object.entries(vault)) {
    try {
      const username = decryptText(entry.usernameEnc);
      const password = decryptText(entry.passwordEnc);
      rows.push({ site, username, password });
    } catch {
      // Skip unreadable entries rather than failing entire probe.
    }
  }

  rows.sort((a, b) => a.site.localeCompare(b.site));
  return rows;
}

export function upsertVendorCredential(uiPreferences: unknown, args: { site: string; username: string; password: string }) {
  const site = normalizeSiteKey(args.site);
  const username = String(args.username ?? "").trim();
  const password = String(args.password ?? "").trim();

  if (!site) throw new Error("Site is required.");
  if (!username) throw new Error("Username is required.");
  if (!password) throw new Error("Password is required.");

  const root = toObject(uiPreferences);
  const vault = getVaultFromUiPreferences(uiPreferences);
  vault[site] = {
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
  args: { site: string; nextSite?: string; username?: string; password?: string }
) {
  const site = normalizeSiteKey(args.site);
  const nextSite = normalizeSiteKey(args.nextSite ?? args.site);
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
