import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { InvoiceVendor, PartsCheckoutStatus, Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_ROWS = 500;

type CheckoutSession = {
  user?: {
    id?: string | null;
    email?: string | null;
  } | null;
} | null;

type CsvParseResult = {
  headers: string[];
  rows: string[][];
};

function redirectToHistory(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/maintenance/checkout/history", req.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url, { status: 303 });
}

function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, "").replace(/[()_#/-]/g, "");
}

function parseCsv(text: string): CsvParseResult {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };

  const pushRow = () => {
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
        if (text[i + 1] === '"') {
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
      if (text[i + 1] === "\n") i++;
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

  if (inQuotes) throw new Error("CSV contains an unterminated quoted field.");

  pushField();
  if (row.length) pushRow();

  if (rows.length === 0) return { headers: [], rows: [] };
  return {
    headers: rows[0].map((h) => h.trim()),
    rows: rows.slice(1).filter((r) => r.some((v) => String(v ?? "").trim() !== "")),
  };
}

function buildHeaderMap(headers: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  headers.forEach((h, i) => {
    out[normalizeHeader(h)] = i;
  });
  return out;
}

function resolveKey(headerMap: Record<string, number>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const key = normalizeHeader(candidate);
    if (headerMap[key] !== undefined) return key;
  }
  return null;
}

function getCell(headerMap: Record<string, number>, row: string[], key: string | null): string {
  if (!key) return "";
  const idx = headerMap[key];
  if (idx === undefined) return "";
  return String(row[idx] ?? "").trim();
}

function parseQuantity(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Quantity must be a positive whole number.");
  return n;
}

function parseBoolean(v: string): boolean {
  const s = v.trim().toLowerCase();
  if (!s) return false;
  return ["true", "t", "yes", "y", "1", "on"].includes(s);
}

function parseStatus(v: string): PartsCheckoutStatus {
  const s = v.trim().toUpperCase();
  if (!s || s === "INVOICED") return PartsCheckoutStatus.INVOICED;
  if (s === "OPEN") return PartsCheckoutStatus.OPEN;
  if (s === "VOIDED" || s === "RETURN" || s === "RETURNED") return PartsCheckoutStatus.VOIDED;
  throw new Error(`Unknown checkout status: "${v}".`);
}

function parseCreatedAt(v: string): Date {
  const s = v.trim();
  if (!s) return new Date();

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const parsed = dateOnly ? new Date(`${s}T12:00:00`) : new Date(s);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid checkout date: "${v}".`);
  return parsed;
}

function getSessionUserId(session: CheckoutSession): string | null {
  const id = session?.user?.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function getSessionEmail(session: CheckoutSession): string | null {
  const email = session?.user?.email;
  return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
}

async function loadAllowedStoreIds(session: CheckoutSession, allowAll: boolean): Promise<Set<string> | null> {
  if (allowAll) return null;

  const email = getSessionEmail(session);
  if (!email) return new Set();

  const me = await prisma.user.findUnique({
    where: { email },
    select: {
      active: true,
      locationId: true,
      allowedLocations: { select: { locationId: true } },
    },
  });

  if (!me?.active) return new Set();

  const ids = new Set<string>();
  if (me.locationId) ids.add(me.locationId);
  for (const allowed of me.allowedLocations) ids.add(allowed.locationId);
  return ids;
}

function toVendor(value: InvoiceVendor | null | undefined): InvoiceVendor {
  return value ?? InvoiceVendor.SUCCESS_PLUS;
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions)) as CheckoutSession;
  if (!session) return redirectToHistory(req, { importErr: "Unauthorized" });

  const perms = await loadUserPermissions(session);
  const canImport = perms.allowAll || hasAnyPermission(perms, [Permission.CREATE_CHECKOUT]);
  if (!canImport) return redirectToHistory(req, { importErr: "Forbidden" });

  let csvText = "";
  try {
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) return redirectToHistory(req, { importErr: 'Missing CSV file field "file".' });
    if (file.size > MAX_UPLOAD_BYTES) {
      return redirectToHistory(req, { importErr: "CSV must be 2 MB or smaller." });
    }
    csvText = await file.text();
  } catch {
    return redirectToHistory(req, { importErr: "Unable to read upload." });
  }

  if (!csvText.trim()) return redirectToHistory(req, { importErr: "Empty CSV." });

  let parsed: CsvParseResult;
  try {
    parsed = parseCsv(csvText);
  } catch (error) {
    return redirectToHistory(req, {
      importErr: error instanceof Error ? error.message : "Unable to parse CSV.",
    });
  }

  const { headers, rows } = parsed;
  if (headers.length === 0) return redirectToHistory(req, { importErr: "CSV missing header row." });
  if (rows.length > MAX_IMPORT_ROWS) {
    return redirectToHistory(req, { importErr: `CSV cannot contain more than ${MAX_IMPORT_ROWS} data rows.` });
  }

  const headerMap = buildHeaderMap(headers);
  const keys = {
    sku: resolveKey(headerMap, ["sku"]),
    store: resolveKey(headerMap, ["store", "storeName", "location", "locationName"]),
    storeNumber: resolveKey(headerMap, ["storeNumber", "locationNumber"]),
    quantity: resolveKey(headerMap, ["quantity", "qty"]),
    checkoutDate: resolveKey(headerMap, ["checkoutDate", "date", "createdAt", "created"]),
    createdBy: resolveKey(headerMap, ["createdBy", "createdByEmail", "userEmail", "employeeEmail", "employee", "user"]),
    status: resolveKey(headerMap, ["status"]),
    needToOrderMore: resolveKey(headerMap, ["needToOrderMore", "needMore", "orderMore"]),
    note: resolveKey(headerMap, ["note", "notes"]),
  };

  if (!keys.sku) return redirectToHistory(req, { importErr: "CSV must include a SKU column." });
  if (!keys.quantity) return redirectToHistory(req, { importErr: "CSV must include a Quantity column." });
  if (!keys.store && !keys.storeNumber) {
    return redirectToHistory(req, { importErr: "CSV must include Store or Store Number." });
  }

  const sessionUserId = getSessionUserId(session);
  const sessionEmail = getSessionEmail(session);
  const fallbackUser = sessionUserId
    ? await prisma.user.findUnique({ where: { id: sessionUserId }, select: { id: true, name: true, active: true } })
    : sessionEmail
      ? await prisma.user.findUnique({ where: { email: sessionEmail }, select: { id: true, name: true, active: true } })
      : null;

  if (!fallbackUser?.active) return redirectToHistory(req, { importErr: "Your user account could not be resolved." });

  const allowedStoreIds = await loadAllowedStoreIds(session, perms.allowAll);
  const job = await prisma.importJob.create({
    data: {
      type: "checkout_history",
      total: rows.length,
    },
    select: { id: true },
  });

  let created = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2;
    const sku = getCell(headerMap, row, keys.sku);

    try {
      const storeName = getCell(headerMap, row, keys.store);
      const storeNumber = getCell(headerMap, row, keys.storeNumber);
      const quantity = parseQuantity(getCell(headerMap, row, keys.quantity));
      const status = parseStatus(getCell(headerMap, row, keys.status));
      const createdAt = parseCreatedAt(getCell(headerMap, row, keys.checkoutDate));
      const needToOrderMore = parseBoolean(getCell(headerMap, row, keys.needToOrderMore));
      const rawNote = getCell(headerMap, row, keys.note);
      const createdByRaw = getCell(headerMap, row, keys.createdBy);

      if (!sku) throw new Error("SKU is required.");
      if (!storeName && !storeNumber) throw new Error("Store or Store Number is required.");

      await prisma.$transaction(async (tx) => {
        const [item, store] = await Promise.all([
          tx.item.findUnique({
            where: { sku },
            select: {
              id: true,
              sku: true,
              partNumber: true,
              vendor: true,
              name: true,
              cost: true,
              price: true,
              taxable: true,
            },
          }),
          tx.location.findFirst({
            where: {
              active: true,
              ...(storeName ? { name: { equals: storeName, mode: "insensitive" as const } } : {}),
              ...(storeNumber ? { locationNumber: storeNumber } : {}),
            },
            select: { id: true, name: true },
          }),
        ]);

        if (!item) throw new Error(`Item not found for SKU "${sku}".`);
        if (!store) throw new Error(`Store not found for "${storeName || storeNumber}".`);
        if (allowedStoreIds && !allowedStoreIds.has(store.id)) throw new Error(`You are not assigned to store "${store.name}".`);

        const createdByUser = createdByRaw
          ? await tx.user.findFirst({
              where: {
                active: true,
                OR: [
                  { email: { equals: createdByRaw, mode: "insensitive" } },
                  { name: { equals: createdByRaw, mode: "insensitive" } },
                ],
              },
              select: { id: true, name: true },
            })
          : null;

        const resolvedUser = createdByUser ?? fallbackUser;
        const importedNote = rawNote ? `[IMPORT ${job.id}] ${rawNote}` : `[IMPORT ${job.id}] Imported checkout history.`;

        await tx.partsCheckoutTicket.create({
          data: {
            status,
            itemId: item.id,
            storeId: store.id,
            storeName: store.name,
            quantity,
            needToOrderMore,
            createdByUserId: resolvedUser.id,
            createdByName: resolvedUser.name,
            note: importedNote,
            skuSnapshot: item.sku,
            partNumberSnapshot: item.partNumber,
            nameSnapshot: item.name,
            vendorSnapshot: toVendor(item.vendor),
            costSnapshot: item.cost,
            priceSnapshot: item.price,
            taxableSnapshot: item.taxable,
            createdAt,
            invoicedAt: status === PartsCheckoutStatus.INVOICED ? createdAt : null,
            voidedAt: status === PartsCheckoutStatus.VOIDED ? createdAt : null,
            voidNote: status === PartsCheckoutStatus.VOIDED ? importedNote : null,
          },
        });
      });

      created++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : "Row failed.";
      await prisma.importRowError.create({
        data: {
          jobId: job.id,
          rowNumber,
          sku: sku || null,
          message,
        },
      });
    }
  }

  await prisma.importJob.update({
    where: { id: job.id },
    data: {
      created,
      failed,
    },
  });

  return redirectToHistory(req, {
    importOk: `Imported ${created} checkout history row${created === 1 ? "" : "s"}.${failed ? ` ${failed} failed.` : ""}`,
  });
}
