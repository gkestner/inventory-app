// app/api/admin/items/bulk/route.ts
import type { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";
import { Permission, Prisma, Role } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getUserRole(session: Session | null): Role | null {
  const u = session?.user as unknown;
  if (!u || typeof u !== "object") return null;
  const role = (u as { role?: unknown }).role;

  if (role === Role.ADMIN || role === "ADMIN") return Role.ADMIN;
  if (role === Role.MANAGER || role === "MANAGER") return Role.MANAGER;
  if (role === Role.EMPLOYEE || role === "EMPLOYEE") return Role.EMPLOYEE;

  return null;
}

function normNullableText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s;
}

function safeUrl(raw: string | null | undefined): string | null {
  const v = (raw || "").trim();
  if (!v) return null;

  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/].*)?$/i.test(v)) return `https://${v}`;
  return null;
}

function parseNullableMoney(v: unknown): Prisma.Decimal | null {
  if (v === undefined || v === null) return null;

  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return null;
    if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error("Invalid money format");
    return new Prisma.Decimal(s);
  }

  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("Invalid money format");
    const s = String(v);
    if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error("Invalid money format");
    return new Prisma.Decimal(s);
  }

  throw new Error("Invalid money type");
}

/**
 * Very small CSV parser:
 * - Supports commas
 * - Supports quoted fields with "" escape
 * - Assumes first row is headers
 */
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  const pushField = () => {
    cur.push(field);
    field = "";
  };
  const pushRow = () => {
    // skip completely empty trailing rows
    if (cur.length === 1 && cur[0] === "") {
      cur = [];
      return;
    }
    rows.push(cur);
    cur = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ",") {
      pushField();
      i += 1;
      continue;
    }

    if (ch === "\n") {
      pushField();
      pushRow();
      i += 1;
      continue;
    }

    if (ch === "\r") {
      // ignore CR (handle CRLF)
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  pushField();
  pushRow();

  if (rows.length < 1) return [];

  const headers = rows[0].map((h) => h.trim());
  const out: Array<Record<string, string>> = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((c) => (c ?? "").trim() === "")) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c] ?? `col${c}`] = row[c] ?? "";
    }
    out.push(obj);
  }
  return out;
}

/** Normalize header keys like "Part #", "Part_Number", "part number" -> "partnumber" */
function normHeader(h: string) {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function toBool(v: unknown, fallback: boolean) {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
  if (s === "false" || s === "0" || s === "no" || s === "n") return false;
  return fallback;
}

type CsvJsonBody = { csv?: unknown };

type BulkPatchBody = {
  ids?: unknown;
  action?: unknown; // "archive" | "delete"
  active?: unknown; // boolean
};

function extractCsvFromJsonBody(body: unknown): string {
  if (!isRecord(body)) return "";
  const csv = (body as CsvJsonBody).csv;
  return typeof csv === "string" ? csv : "";
}

function parseBulkPatchBody(raw: unknown): { ids: string[]; action: "archive" | "delete" | null; active: boolean | null } {
  if (!isRecord(raw)) {
    throw new Error("Invalid JSON body");
  }
  const body = raw as BulkPatchBody;

  const idsRaw = body.ids;
  if (!Array.isArray(idsRaw) || idsRaw.length === 0 || !idsRaw.every(isNonEmptyString)) {
    throw new Error("ids must be a non-empty string[]");
  }

  // De-dupe ids to prevent weird counts
  const uniqueIds = Array.from(new Set(idsRaw.map((s) => s.trim()))).filter((s) => s.length > 0);

  if (uniqueIds.length === 0) throw new Error("ids must be a non-empty string[]");
  if (uniqueIds.length > 2000) throw new Error("Too many ids (max 2000 per request)");

  const actionRaw = body.action;
  const action = actionRaw === "archive" || actionRaw === "delete" ? actionRaw : null;

  // Determine active target for archive/toggle
  let active: boolean | null = null;
  if (action === "archive") {
    active = false;
  } else if (action === "delete") {
    active = null; // not used
  } else if (typeof body.active === "boolean") {
    active = body.active;
  } else {
    throw new Error('Provide either { active: boolean } or { action: "archive" | "delete" }');
  }

  return { ids: uniqueIds, action, active };
}

type Gate = { ok: true; session: Session; allowAll: boolean } | { ok: false; status: number; error: string };

async function gateAdminItems(required: Permission[]): Promise<Gate> {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false, status: 401, error: "Unauthorized" };

  const role = getUserRole(session);
  const perms = await loadUserPermissions(session);

  // Admin bypass (allow-all)
  if (perms.allowAll || role === Role.ADMIN) return { ok: true, session, allowAll: true };

  // Non-admin must hold required permissions
  const ok = hasAnyPermission(perms, required);
  if (!ok) return { ok: false, status: 403, error: "Forbidden" };

  return { ok: true, session, allowAll: false };
}

/**
 * CSV IMPORT CONTRACT (POST):
 * Body can be:
 *  - { csv: "...." }  (recommended)
 *  - or raw text/csv in body (Content-Type: text/csv) -> we’ll read text()
 *
 * Required columns (by normalized header):
 *  - sku
 *  - name
 *
 * Optional:
 *  - partnumber, description, category, cost, price, taxable, active
 *  - manufacturer, orderfrom, weburl
 *
 * NOTE: Unit/UOM is intentionally not supported (everything is per-each).
 */
export async function POST(req: NextRequest) {
  const gate = await gateAdminItems([Permission.ADMIN_IMPORT_EXPORT_ITEMS]);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  let csvText = "";

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    csvText = extractCsvFromJsonBody(raw);
  } else {
    // text/csv or anything else: attempt raw text
    csvText = await req.text();
  }

  if (!csvText.trim()) return json({ error: "CSV is required" }, 400);

  const rawRows = parseCsv(csvText);
  if (rawRows.length === 0) return json({ error: "CSV has no rows" }, 400);

  // Normalize headers per row
  const rows = rawRows.map((r) => {
    const obj: Record<string, string> = {};
    for (const k of Object.keys(r)) obj[normHeader(k)] = r[k];
    return obj;
  });

  // Safety limit (production guardrail)
  if (rows.length > 2000) {
    return json({ error: "CSV too large (max 2000 rows per import)" }, 400);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let created = 0;
      let updated = 0;

      for (const r of rows) {
        const sku = (r["sku"] ?? "").trim();
        const name = (r["name"] ?? "").trim();

        if (!sku) throw new Error("CSV row missing required sku");
        if (!name) throw new Error(`CSV row missing required name for sku ${sku}`);

        const partNumber = normNullableText(r["partnumber"]);
        const description = normNullableText(r["description"]);
        const category = normNullableText(r["category"]);

        const cost = parseNullableMoney(r["cost"]);
        const price = parseNullableMoney(r["price"]);

        const taxable = toBool(r["taxable"], true);
        const active = toBool(r["active"], true);

        // Optional reference fields
        const manufacturer = normNullableText(r["manufacturer"]);
        const orderFrom = normNullableText(r["orderfrom"]);

        const rawWeb = normNullableText(r["weburl"]);
        const webUrl = rawWeb ? safeUrl(rawWeb) : null;
        if (rawWeb && !webUrl) {
          throw new Error(`Invalid webUrl for sku ${sku}`);
        }

        const existing = await tx.item.findUnique({
          where: { sku },
          select: {
            id: true,
            sku: true,
            partNumber: true,
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

        if (!existing) {
          const item = await tx.item.create({
            data: {
              sku,
              partNumber,
              name,
              description,
              category,
              manufacturer,
              orderFrom,
              webUrl,
              cost,
              price,
              taxable,
              active,
            },
            select: {
              id: true,
              sku: true,
              partNumber: true,
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

          // Snapshot version 1 for created item (includes qty fields)
          await tx.itemVersion.create({
            data: {
              itemId: item.id,
              sku: item.sku,
              partNumber: item.partNumber,
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
              version: 1,
              onHandQty: item.onHandQty,
              orderedQty: item.orderedQty,
              usedQty: item.usedQty,
              minQty: item.minQty,
            },
          });

          created += 1;
          continue;
        }

        // ✅ HARDENING: serialize per-item updates to avoid racing PATCH/rollback/import
        await tx.$queryRaw`SELECT id FROM "Item" WHERE id = ${existing.id} FOR UPDATE`;

        // Existing -> snapshot current (pre-update) -> update
        const latest = await tx.itemVersion.findFirst({
          where: { itemId: existing.id },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        const nextVersion = (latest?.version ?? 0) + 1;

        await tx.itemVersion.create({
          data: {
            itemId: existing.id,
            sku: existing.sku,
            partNumber: existing.partNumber,
            name: existing.name,
            description: existing.description,
            category: existing.category,
            manufacturer: existing.manufacturer,
            orderFrom: existing.orderFrom,
            webUrl: existing.webUrl,
            cost: existing.cost,
            price: existing.price,
            taxable: existing.taxable,
            active: existing.active,
            version: nextVersion,
            onHandQty: existing.onHandQty,
            orderedQty: existing.orderedQty,
            usedQty: existing.usedQty,
            minQty: existing.minQty,
          },
        });

        await tx.item.update({
          where: { id: existing.id },
          data: {
            // SKU is key; keep same SKU to avoid accidental SKU changes from CSV
            partNumber,
            name,
            description,
            category,
            manufacturer,
            orderFrom,
            webUrl,
            cost,
            price,
            taxable,
            active,
          },
        });

        updated += 1;
      }

      return { created, updated, total: rows.length };
    });

    return json({ ok: true, ...result }, 200);
  } catch (e: unknown) {
    return json({ error: errorMessage(e, "Import failed") }, 400);
  }
}

/**
 * BULK ACTION (PATCH):
 * Body accepted:
 *  - { ids: string[], active: boolean }                 (toggle active)
 *  - { ids: string[], action: "archive" }              (sets active=false)
 *  - { ids: string[], action: "delete" }               (hard delete)
 *
 * Atomic.
 * Guardrails:
 *  - max 2000 ids per request
 *
 * NOTE (atomic correctness):
 * For destructive actions (delete/archive/toggle), we require that all ids exist.
 * If any ids are missing, we fail the request (no partial updates).
 */
export async function PATCH(req: NextRequest) {
  const gate = await gateAdminItems([Permission.ADMIN_EDIT_ITEMS, Permission.ADMIN_IMPORT_EXPORT_ITEMS]);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  let parsed: { ids: string[]; action: "archive" | "delete" | null; active: boolean | null };
  try {
    parsed = parseBulkPatchBody(raw);
  } catch (e: unknown) {
    return json({ error: errorMessage(e, "Invalid request") }, 400);
  }

  const uniqueIds = parsed.ids;
  const action = parsed.action;
  const active = parsed.active;

  // Hard delete: atomic (all ids must exist) and in a single transaction.
  if (action === "delete") {
    // Stronger gate for delete
    const delGate = await gateAdminItems([Permission.ADMIN_EDIT_ITEMS]);
    if (!delGate.ok) return json({ error: delGate.error }, delGate.status);

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Ensure all ids exist (atomic correctness: no partial delete)
        const existing = await tx.item.findMany({
          where: { id: { in: uniqueIds } },
          select: { id: true },
        });

        const found = new Set(existing.map((x) => x.id));
        const missingIds = uniqueIds.filter((id) => !found.has(id));
        if (missingIds.length > 0) {
          throw new Error(
            `Some ids were not found; no changes were made. Missing: ${missingIds.slice(0, 20).join(", ")}${
              missingIds.length > 20 ? "…" : ""
            }`
          );
        }

        // ✅ HARDENING: lock all affected rows for this transaction
        await tx.$queryRaw`SELECT id FROM "Item" WHERE id IN (${Prisma.join(uniqueIds)}) FOR UPDATE`;

        // Load full snapshot for versions before delete
        const items = await tx.item.findMany({
          where: { id: { in: uniqueIds } },
          select: {
            id: true,
            sku: true,
            partNumber: true,
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

        // Snapshot pre-delete state for each item (append-only audit)
        for (const it of items) {
          const latest = await tx.itemVersion.findFirst({
            where: { itemId: it.id },
            orderBy: { version: "desc" },
            select: { version: true },
          });
          const nextVersion = (latest?.version ?? 0) + 1;

          await tx.itemVersion.create({
            data: {
              itemId: it.id,
              sku: it.sku,
              partNumber: it.partNumber,
              name: it.name,
              description: it.description,
              category: it.category,
              manufacturer: it.manufacturer,
              orderFrom: it.orderFrom,
              webUrl: it.webUrl,
              cost: it.cost,
              price: it.price,
              taxable: it.taxable,
              active: it.active,
              version: nextVersion,
              onHandQty: it.onHandQty,
              orderedQty: it.orderedQty,
              usedQty: it.usedQty,
              minQty: it.minQty,
            },
          });
        }

        const del = await tx.item.deleteMany({
          where: { id: { in: uniqueIds } },
        });

        // With the existence check above, this should match exactly.
        if (del.count !== uniqueIds.length) {
          throw new Error("Bulk delete did not delete all requested rows");
        }

        return { deletedCount: del.count };
      });

      return json({ ok: true, ...result }, 200);
    } catch (e: unknown) {
      const msg = errorMessage(e, "Bulk delete failed");
      const status = msg.includes("no changes were made") ? 400 : 500;
      return json({ error: msg }, status);
    }
  }

  // Archive / active toggle: snapshot pre-change into ItemVersion, then update.
  try {
    const result = await prisma.$transaction(async (tx) => {
      const items = await tx.item.findMany({
        where: { id: { in: uniqueIds } },
        select: {
          id: true,
          sku: true,
          partNumber: true,
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

      const foundIds = new Set(items.map((i) => i.id));
      const missingIds = uniqueIds.filter((id) => !foundIds.has(id));
      if (missingIds.length > 0) {
        throw new Error(
          `Some ids were not found; no changes were made. Missing: ${missingIds.slice(0, 20).join(", ")}${
            missingIds.length > 20 ? "…" : ""
          }`
        );
      }

      if (active === null) {
        // Should never happen due to parseBulkPatchBody, but keep it defensive.
        throw new Error("Invalid active value");
      }

      // ✅ HARDENING: lock all affected rows for this transaction
      await tx.$queryRaw`SELECT id FROM "Item" WHERE id IN (${Prisma.join(uniqueIds)}) FOR UPDATE`;

      for (const it of items) {
        const latest = await tx.itemVersion.findFirst({
          where: { itemId: it.id },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        const nextVersion = (latest?.version ?? 0) + 1;

        // Snapshot current state before changing active
        await tx.itemVersion.create({
          data: {
            itemId: it.id,
            sku: it.sku,
            partNumber: it.partNumber,
            name: it.name,
            description: it.description,
            category: it.category,
            manufacturer: it.manufacturer,
            orderFrom: it.orderFrom,
            webUrl: it.webUrl,
            cost: it.cost,
            price: it.price,
            taxable: it.taxable,
            active: it.active,
            version: nextVersion,
            onHandQty: it.onHandQty,
            orderedQty: it.orderedQty,
            usedQty: it.usedQty,
            minQty: it.minQty,
          },
        });

        await tx.item.update({
          where: { id: it.id },
          data: { active },
        });
      }

      return { updatedCount: items.length, active };
    });

    return json({ ok: true, ...result }, 200);
  } catch (e: unknown) {
    const msg = errorMessage(e, "Bulk update failed");
    const status = msg.includes("no changes were made") ? 400 : 500;
    return json({ error: msg }, status);
  }
}