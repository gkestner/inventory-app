// app/api/admin/items/import/route.ts
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma, Role, InvoiceVendor } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function getUserRole(session: unknown): Role | null {
  if (!session || typeof session !== "object") return null;
  const user = (session as { user?: unknown }).user;
  if (!user || typeof user !== "object") return null;
  const role = (user as { role?: unknown }).role;
  if (role === Role.ADMIN || role === "ADMIN") return Role.ADMIN;
  if (role === Role.MANAGER || role === "MANAGER") return Role.MANAGER;
  if (role === Role.EMPLOYEE || role === "EMPLOYEE") return Role.EMPLOYEE;
  return null;
}

// --- CSV helpers ---

function normalizeHeader(h: string): string {
  // normalize to compare columns consistently
  return h.trim().toLowerCase().replace(/\s+/g, "").replace(/[()]/g, "");
}

/**
 * Minimal RFC4180-ish CSV parser:
 * - commas
 * - quoted fields
 * - quotes escaped as ""
 * - CRLF/LF newlines
 */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };

  const pushRow = () => {
    // skip totally empty rows
    if (row.length === 1 && row[0] === "") {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      continue;
    }

    if (c === ",") {
      pushField();
      continue;
    }

    if (c === "\r") {
      const next = text[i + 1];
      if (next === "\n") i++;
      pushField();
      pushRow();
      continue;
    }

    if (c === "\n") {
      pushField();
      pushRow();
      continue;
    }

    field += c;
  }

  pushField();
  if (row.length) pushRow();

  if (rows.length === 0) return { headers: [], rows: [] };

  const headers = rows[0].map((h) => h.trim());
  const bodyRows = rows.slice(1).filter((r) => r.some((v) => String(v ?? "").trim() !== ""));

  return { headers, rows: bodyRows };
}

function getCell(map: Record<string, number>, row: string[], key: string): string {
  const idx = map[key];
  if (idx === undefined) return "";
  return String(row[idx] ?? "").trim();
}

function parseBool(v: string, fieldName: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (["true", "t", "yes", "y", "1", "on"].includes(s)) return true;
  if (["false", "f", "no", "n", "0", "off"].includes(s)) return false;
  throw new Error(`Invalid boolean for ${fieldName}: "${v}"`);
}

function parseMoney(v: string, fieldName: string): Decimal | null {
  const s0 = v.trim();
  if (!s0) return null;

  const cleaned = s0.replace(/\$/g, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`Invalid money for ${fieldName}: "${v}"`);
  }
  return new Decimal(cleaned);
}

function parseIntSafe(v: string, fieldName: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${fieldName}: "${v}"`);
  return Math.trunc(n);
}

function parseVendor(v: string): InvoiceVendor | null {
  const s = v.trim().toUpperCase();
  if (!s) return null;

  if (s === "SUCCESS_PLUS" || s === "SUCCESSPLUS" || s === "SUCCESS") return InvoiceVendor.SUCCESS_PLUS;
  if (s === "AMERICAN_PLUS" || s === "AMERICANPLUS" || s === "AMERICAN") return InvoiceVendor.AMERICAN_PLUS;

  throw new Error(`Invalid vendor: "${v}"`);
}

function normalizeWebUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/].*)?$/i.test(v)) return `https://${v}`;
  return null;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return json({ error: "Unauthorized" }, 401);
  const role = getUserRole(session);
  if (role !== Role.ADMIN) return json({ error: "Forbidden" }, 403);

  // Accept:
  // - multipart/form-data with field "file"
  // - raw text/csv body
  let csvText = "";
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  try {
    if (ct.includes("multipart/form-data")) {
      const fd = await req.formData();
      const f = fd.get("file");
      if (!(f instanceof File)) return json({ error: 'Missing file (expected form field "file").' }, 400);
      csvText = await f.text();
    } else {
      csvText = await req.text();
    }
  } catch {
    return json({ error: "Unable to read upload." }, 400);
  }

  if (!csvText.trim()) return json({ error: "Empty CSV." }, 400);

  const { headers, rows } = parseCsv(csvText);
  if (headers.length === 0) return json({ error: "CSV missing header row." }, 400);

  // normalized header -> index
  const headerMap: Record<string, number> = {};
  headers.forEach((h, i) => {
    headerMap[normalizeHeader(h)] = i;
  });

  // Resolve canonical keys from common header spellings.
  // NOTE: unit/uom is intentionally ignored.
  const keyCandidates = {
    sku: ["sku"],
    partNumber: ["partnumber", "part#", "partno", "partnum"],
    vendor: ["vendor"],
    name: ["name"],
    description: ["description", "desc"],
    category: ["category"],
    manufacturer: ["manufacturer", "mfg"],
    orderFrom: ["orderfrom", "supplier", "vendorname"],
    webUrl: ["weburl", "url", "link"],
    cost: ["cost"],
    price: ["price"],
    taxable: ["taxable"],
    active: ["active"],
    onHandQty: ["onhandqty", "onhand", "onhandquantity"],
    orderedQty: ["orderedqty", "ordered", "orderedquantity"],
    usedQty: ["usedqty", "used", "usedquantity"],
    minQty: ["minqty", "min", "minimum", "minimumqty"],

    // ignored:
    unit: ["unit", "uom", "unituom"],
  } as const;

  // ✅ FIX: accept readonly string[] so Object.entries() doesn’t require casting to mutable string[]
  function resolveKey(candidates: readonly string[]): string | null {
    for (const c of candidates) {
      const k = normalizeHeader(c);
      if (headerMap[k] !== undefined) return k;
    }
    return null;
  }

  const skuKey = resolveKey(keyCandidates.sku);
  const nameKey = resolveKey(keyCandidates.name);

  if (!skuKey) return json({ error: "CSV must include a SKU column." }, 400);
  if (!nameKey) return json({ error: "CSV must include a Name column." }, 400);

  // Canonical -> actual key in this CSV (or null)
  const present: Record<string, string | null> = {};
  for (const [canonical, candidates] of Object.entries(keyCandidates)) {
    // ✅ FIX: candidates is readonly; resolveKey accepts readonly now
    present[canonical] = resolveKey(candidates);
  }

  // Stage
  type Staged = {
    sku: string;
    partNumber: string | null;
    vendor: InvoiceVendor | null;
    name: string;
    description: string | null;
    category: string | null;

    manufacturer: string | null;
    orderFrom: string | null;
    webUrl: string | null;

    cost: Decimal | null;
    price: Decimal | null;
    taxable: boolean;
    active: boolean;

    onHandQty: number | null;
    orderedQty: number | null;
    usedQty: number | null;
    minQty: number | null;
  };

  const staged: Staged[] = [];
  const seenSku = new Set<string>();

  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // header is row 1

      const sku = getCell(headerMap, row, skuKey);
      const name = getCell(headerMap, row, nameKey);

      if (!sku) throw new Error(`Row ${rowNum}: SKU is required.`);
      if (!name) throw new Error(`Row ${rowNum}: Name is required.`);

      const skuLower = sku.toLowerCase();
      if (seenSku.has(skuLower)) throw new Error(`Row ${rowNum}: Duplicate SKU in file: "${sku}".`);
      seenSku.add(skuLower);

      const partNumber = present.partNumber ? getCell(headerMap, row, present.partNumber) : "";
      const vendorRaw = present.vendor ? getCell(headerMap, row, present.vendor) : "";
      const desc = present.description ? getCell(headerMap, row, present.description) : "";
      const cat = present.category ? getCell(headerMap, row, present.category) : "";

      const manufacturer = present.manufacturer ? getCell(headerMap, row, present.manufacturer) : "";
      const orderFrom = present.orderFrom ? getCell(headerMap, row, present.orderFrom) : "";
      const webRaw = present.webUrl ? getCell(headerMap, row, present.webUrl) : "";

      // Unit/UOM ignored even if present

      const costRaw = present.cost ? getCell(headerMap, row, present.cost) : "";
      const priceRaw = present.price ? getCell(headerMap, row, present.price) : "";

      const taxableRaw = present.taxable ? getCell(headerMap, row, present.taxable) : "";
      const activeRaw = present.active ? getCell(headerMap, row, present.active) : "";

      const onHandRaw = present.onHandQty ? getCell(headerMap, row, present.onHandQty) : "";
      const orderedRaw = present.orderedQty ? getCell(headerMap, row, present.orderedQty) : "";
      const usedRaw = present.usedQty ? getCell(headerMap, row, present.usedQty) : "";
      const minRaw = present.minQty ? getCell(headerMap, row, present.minQty) : "";

      const vendor = vendorRaw ? parseVendor(vendorRaw) : null;

      const webUrl = webRaw ? normalizeWebUrl(webRaw) : null;
      if (webRaw && !webUrl) throw new Error(`Row ${rowNum}: Invalid WebUrl: "${webRaw}".`);

      const taxableParsed = taxableRaw ? parseBool(taxableRaw, "Taxable") : null;
      const activeParsed = activeRaw ? parseBool(activeRaw, "Active") : null;

      staged.push({
        sku,
        name,
        partNumber: partNumber ? partNumber : null,
        vendor,
        description: desc ? desc : null,
        category: cat ? cat : null,

        manufacturer: manufacturer ? manufacturer : null,
        orderFrom: orderFrom ? orderFrom : null,
        webUrl,

        cost: costRaw ? parseMoney(costRaw, "Cost") : null,
        price: priceRaw ? parseMoney(priceRaw, "Price") : null,

        taxable: taxableParsed ?? true,
        active: activeParsed ?? true,

        onHandQty: onHandRaw ? parseIntSafe(onHandRaw, "OnHandQty") : null,
        orderedQty: orderedRaw ? parseIntSafe(orderedRaw, "OrderedQty") : null,
        usedQty: usedRaw ? parseIntSafe(usedRaw, "UsedQty") : null,
        minQty: minRaw ? parseIntSafe(minRaw, "MinQty") : null,
      });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Invalid CSV.";
    return json({ error: msg }, 400);
  }

  // Atomic import
  try {
    const result = await prisma.$transaction(async (tx) => {
      let created = 0;

      for (const s of staged) {
        const item = await tx.item.create({
          data: {
            sku: s.sku,
            partNumber: s.partNumber,
            vendor: s.vendor ?? undefined,
            name: s.name,
            description: s.description,
            category: s.category,

            manufacturer: s.manufacturer,
            orderFrom: s.orderFrom,
            webUrl: s.webUrl,

            cost: s.cost,
            price: s.price,
            taxable: s.taxable,
            active: s.active,

            ...(s.onHandQty !== null ? { onHandQty: s.onHandQty } : {}),
            ...(s.orderedQty !== null ? { orderedQty: s.orderedQty } : {}),
            ...(s.usedQty !== null ? { usedQty: s.usedQty } : {}),
            ...(s.minQty !== null ? { minQty: s.minQty } : {}),
          },
          select: {
            id: true,
            sku: true,
            partNumber: true,
            vendor: true,
            name: true,
            description: true,
            category: true,

            manufacturer: true,
            orderFrom: true,
            webUrl: true,

            cost: true,
            price: true,
            taxable: true,
            active: true,

            onHandQty: true,
            orderedQty: true,
            usedQty: true,
            minQty: true,
          },
        });

        // Version snapshot v1
        await tx.itemVersion.create({
          data: {
            itemId: item.id,
            version: 1,

            sku: item.sku,
            partNumber: item.partNumber,
            vendor: item.vendor,
            name: item.name,
            description: item.description,
            category: item.category,

            manufacturer: item.manufacturer,
            orderFrom: item.orderFrom,
            webUrl: item.webUrl,

            cost: item.cost,
            price: item.price,
            taxable: item.taxable,
            active: item.active,

            onHandQty: item.onHandQty,
            orderedQty: item.orderedQty,
            usedQty: item.usedQty,
            minQty: item.minQty,
          },
        });

        created++;
      }

      return { created };
    });

    return json(
      {
        ok: true,
        created: result.created,
        ignoredColumnsIfPresent: ["Unit", "UOM", "Unit (UOM)"],
      },
      200
    );
  } catch (e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return json({ error: "Import failed: a SKU in this file already exists." }, 409);
    }
    const msg = e instanceof Error ? e.message : "Import failed.";
    return json({ error: msg }, 500);
  }
}