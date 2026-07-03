import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { Permission, Prisma } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import {
  ADMIN_VIEW_MAINTENANCE_REQUESTS,
  ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
  ADMIN_VIEW_REPORT_FLEET_TCO,
  ADMIN_VIEW_REPORT_NOTIFICATION_EFFECTIVENESS,
  ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS,
  ADMIN_VIEW_REPORT_PERMISSION_COVERAGE,
  ADMIN_VIEW_REPORT_PM_COMPLIANCE,
  ADMIN_VIEW_REPORT_SLA_BREACHES,
  ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD,
  ADMIN_VIEW_REPORT_TEMPERATURE_INCIDENTS,
} from "@/app/lib/permission-constants";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ReportValue = string | number | boolean | null;
type ReportRow = Record<string, ReportValue>;

type FieldKind = "text" | "number" | "currency" | "date" | "datetime" | "boolean" | "url";

type FieldDefinition = {
  key: string;
  label: string;
  kind: FieldKind;
};

type RequestBody = {
  source?: string;
  fields?: string[];
  sortField?: string;
  sortDir?: "asc" | "desc";
  filters?: {
    q?: string;
    from?: string;
    to?: string;
    active?: "active" | "inactive" | "all";
  };
  limit?: number;
};

type SessionShape = {
  user?: { id?: string | null; email?: string | null } | null;
} | null;

const ITEM_FIELDS: FieldDefinition[] = [
  { key: "sku", label: "SKU", kind: "text" },
  { key: "labelNumber", label: "Item #", kind: "number" },
  { key: "name", label: "Item Name", kind: "text" },
  { key: "partNumber", label: "Part Number", kind: "text" },
  { key: "manufacturer", label: "Manufacturer", kind: "text" },
  { key: "category", label: "Category", kind: "text" },
  { key: "vendor", label: "Vendor", kind: "text" },
  { key: "orderFrom", label: "Supplier", kind: "text" },
  { key: "cost", label: "Cost", kind: "currency" },
  { key: "price", label: "Price", kind: "currency" },
  { key: "onHandQty", label: "On Hand", kind: "number" },
  { key: "orderedQty", label: "Ordered", kind: "number" },
  { key: "usedQty", label: "Used", kind: "number" },
  { key: "minQty", label: "Min", kind: "number" },
  { key: "availableQty", label: "Available", kind: "number" },
  { key: "active", label: "Active", kind: "boolean" },
  { key: "webUrl", label: "Part Link", kind: "url" },
  { key: "createdAt", label: "Created", kind: "datetime" },
  { key: "updatedAt", label: "Updated", kind: "datetime" },
  { key: "lastCheckoutAt", label: "Last Checkout", kind: "datetime" },
  { key: "checkoutQty12Month", label: "Checkout Qty 12 Mo", kind: "number" },
];

const CHECKOUT_FIELDS: FieldDefinition[] = [
  { key: "id", label: "Ticket ID", kind: "text" },
  { key: "createdAt", label: "Created", kind: "datetime" },
  { key: "status", label: "Status", kind: "text" },
  { key: "storeName", label: "Store", kind: "text" },
  { key: "createdByName", label: "Created By", kind: "text" },
  { key: "skuSnapshot", label: "SKU", kind: "text" },
  { key: "partNumberSnapshot", label: "Part Number", kind: "text" },
  { key: "nameSnapshot", label: "Item Name", kind: "text" },
  { key: "vendorSnapshot", label: "Vendor", kind: "text" },
  { key: "quantity", label: "Quantity", kind: "number" },
  { key: "costSnapshot", label: "Cost", kind: "currency" },
  { key: "lineCost", label: "Line Cost", kind: "currency" },
  { key: "priceSnapshot", label: "Price", kind: "currency" },
  { key: "needToOrderMore", label: "Need More", kind: "boolean" },
  { key: "invoiceId", label: "Invoice ID", kind: "text" },
  { key: "invoicedAt", label: "Invoiced", kind: "datetime" },
  { key: "voidedAt", label: "Voided", kind: "datetime" },
  { key: "note", label: "Note", kind: "text" },
];

const FIELD_MAP: Record<string, FieldDefinition[]> = {
  items: ITEM_FIELDS,
  checkouts: CHECKOUT_FIELDS,
};

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(String(value));
  return Number.isFinite(n) ? n : 0;
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function parseLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.min(500, Math.max(1, Math.floor(n)));
}

function parseDateStart(value: string | undefined): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateEnd(value: string | undefined): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(`${raw}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requestedFields(source: string, values: string[] | undefined): FieldDefinition[] {
  const available = FIELD_MAP[source] ?? ITEM_FIELDS;
  const byKey = new Map(available.map((field) => [field.key, field]));
  const requested = Array.isArray(values) ? values.map((key) => byKey.get(String(key))).filter((field): field is FieldDefinition => Boolean(field)) : [];
  if (requested.length > 0) return requested.slice(0, 30);
  return available.slice(0, source === "checkouts" ? 8 : 9);
}

function compareValues(a: ReportValue, b: ReportValue): number {
  if (typeof a === "number" || typeof b === "number") return toNumber(a) - toNumber(b);
  if (typeof a === "boolean" || typeof b === "boolean") return Number(Boolean(a)) - Number(Boolean(b));
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { sensitivity: "base" });
}

function sortRows(rows: ReportRow[], sortField: string | undefined, sortDir: "asc" | "desc" | undefined): ReportRow[] {
  const field = String(sortField ?? "").trim();
  if (!field) return rows;
  const direction = sortDir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => compareValues(a[field] ?? null, b[field] ?? null) * direction);
}

function trimRows(rows: ReportRow[], fields: FieldDefinition[]): ReportRow[] {
  return rows.map((row) => {
    const out: ReportRow = {};
    for (const field of fields) out[field.key] = row[field.key] ?? null;
    return out;
  });
}

async function requireReportAccess(): Promise<Response | null> {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) return new Response("Unauthorized", { status: 401 });

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return null;

  const ok = hasAnyPermission(perms, [
    Permission.ADMIN_VIEW_ITEMS,
    Permission.ADMIN_EDIT_ITEMS,
    ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
    ADMIN_VIEW_MAINTENANCE_REQUESTS,
    ADMIN_VIEW_REPORT_SLA_BREACHES,
    ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD,
    ADMIN_VIEW_REPORT_TEMPERATURE_INCIDENTS,
    ADMIN_VIEW_REPORT_PM_COMPLIANCE,
    ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS,
    ADMIN_VIEW_REPORT_FLEET_TCO,
    ADMIN_VIEW_REPORT_PERMISSION_COVERAGE,
    ADMIN_VIEW_REPORT_NOTIFICATION_EFFECTIVENESS,
  ]);

  return ok ? null : new Response("Forbidden", { status: 403 });
}

async function buildItemsReport(body: RequestBody, selectedFields: FieldDefinition[]): Promise<ReportRow[]> {
  const q = String(body.filters?.q ?? "").trim();
  const active = body.filters?.active ?? "active";
  const limit = parseLimit(body.limit);
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const items = await prisma.item.findMany({
    where: {
      ...(active === "active" ? { active: true } : {}),
      ...(active === "inactive" ? { active: false } : {}),
      ...(q
        ? {
            OR: [
              { sku: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
              { partNumber: { contains: q, mode: "insensitive" } },
              { manufacturer: { contains: q, mode: "insensitive" } },
              { category: { contains: q, mode: "insensitive" } },
              { orderFrom: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ sku: "asc" }, { name: "asc" }],
    take: limit,
    select: {
      id: true,
      sku: true,
      labelNumber: true,
      name: true,
      partNumber: true,
      manufacturer: true,
      category: true,
      vendor: true,
      orderFrom: true,
      cost: true,
      price: true,
      onHandQty: true,
      orderedQty: true,
      usedQty: true,
      minQty: true,
      active: true,
      webUrl: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const itemIds = items.map((item) => item.id);
  const [lastCheckouts, checkoutQty] = await Promise.all([
    itemIds.length
      ? prisma.partsCheckoutTicket.findMany({
          where: { itemId: { in: itemIds }, status: { not: "VOIDED" } },
          distinct: ["itemId"],
          orderBy: [{ itemId: "asc" }, { createdAt: "desc" }],
          select: { itemId: true, createdAt: true },
        })
      : [],
    itemIds.length
      ? prisma.partsCheckoutTicket.groupBy({
          by: ["itemId"],
          where: { itemId: { in: itemIds }, status: { not: "VOIDED" }, createdAt: { gte: twelveMonthsAgo } },
          _sum: { quantity: true },
        })
      : [],
  ]);

  const lastMap = new Map(lastCheckouts.map((row) => [row.itemId, row.createdAt]));
  const qtyMap = new Map(checkoutQty.map((row) => [row.itemId, row._sum.quantity ?? 0]));

  const rows = items.map((item) => ({
    sku: item.sku,
    labelNumber: item.labelNumber,
    name: item.name,
    partNumber: item.partNumber,
    manufacturer: item.manufacturer,
    category: item.category,
    vendor: item.vendor,
    orderFrom: item.orderFrom,
    cost: toNumber(item.cost),
    price: toNumber(item.price),
    onHandQty: item.onHandQty,
    orderedQty: item.orderedQty,
    usedQty: item.usedQty,
    minQty: item.minQty,
    availableQty: item.onHandQty + item.orderedQty,
    active: item.active,
    webUrl: item.webUrl,
    createdAt: toIso(item.createdAt),
    updatedAt: toIso(item.updatedAt),
    lastCheckoutAt: toIso(lastMap.get(item.id) ?? null),
    checkoutQty12Month: qtyMap.get(item.id) ?? 0,
  }));

  return trimRows(sortRows(rows, body.sortField, body.sortDir), selectedFields);
}

async function buildCheckoutReport(body: RequestBody, selectedFields: FieldDefinition[]): Promise<ReportRow[]> {
  const q = String(body.filters?.q ?? "").trim();
  const from = parseDateStart(body.filters?.from);
  const to = parseDateEnd(body.filters?.to);
  const limit = parseLimit(body.limit);

  const where: Prisma.PartsCheckoutTicketWhereInput = {
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q
      ? {
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { skuSnapshot: { contains: q, mode: "insensitive" } },
            { partNumberSnapshot: { contains: q, mode: "insensitive" } },
            { nameSnapshot: { contains: q, mode: "insensitive" } },
            { storeName: { contains: q, mode: "insensitive" } },
            { createdByName: { contains: q, mode: "insensitive" } },
            { note: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const tickets = await prisma.partsCheckoutTicket.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      status: true,
      storeName: true,
      createdByName: true,
      skuSnapshot: true,
      partNumberSnapshot: true,
      nameSnapshot: true,
      vendorSnapshot: true,
      quantity: true,
      costSnapshot: true,
      priceSnapshot: true,
      needToOrderMore: true,
      invoiceId: true,
      invoicedAt: true,
      voidedAt: true,
      note: true,
    },
  });

  const rows = tickets.map((ticket) => {
    const cost = toNumber(ticket.costSnapshot);
    return {
      id: ticket.id,
      createdAt: toIso(ticket.createdAt),
      status: ticket.status,
      storeName: ticket.storeName,
      createdByName: ticket.createdByName,
      skuSnapshot: ticket.skuSnapshot,
      partNumberSnapshot: ticket.partNumberSnapshot,
      nameSnapshot: ticket.nameSnapshot,
      vendorSnapshot: ticket.vendorSnapshot,
      quantity: ticket.quantity,
      costSnapshot: cost,
      lineCost: cost * ticket.quantity,
      priceSnapshot: toNumber(ticket.priceSnapshot),
      needToOrderMore: ticket.needToOrderMore,
      invoiceId: ticket.invoiceId,
      invoicedAt: toIso(ticket.invoicedAt),
      voidedAt: toIso(ticket.voidedAt),
      note: ticket.note,
    };
  });

  return trimRows(sortRows(rows, body.sortField, body.sortDir), selectedFields);
}

export async function POST(req: NextRequest) {
  const accessError = await requireReportAccess();
  if (accessError) return accessError;

  const body = (await req.json().catch(() => ({}))) as RequestBody;
  const source = body.source === "checkouts" ? "checkouts" : "items";
  const selectedFields = requestedFields(source, body.fields);

  const rows = source === "checkouts" ? await buildCheckoutReport(body, selectedFields) : await buildItemsReport(body, selectedFields);

  return Response.json({
    source,
    columns: selectedFields,
    rows,
    rowCount: rows.length,
    generatedAt: new Date().toISOString(),
  });
}
