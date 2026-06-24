import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { Permission, PartsCheckoutStatus, Prisma } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { excelResponse } from "@/app/lib/excel-export";
import { getInventoryDemandRecommendations } from "@/app/lib/inventory-demand";
import { parseSkuRoomParts } from "@/app/lib/item-sku";
import { computeAverageResolutionHours } from "@/app/lib/maintenance-requests";
import { PREVENTATIVE_MAINTENANCE_FIELD_LABELS, normalizePmYear } from "@/app/lib/preventative-maintenance";
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
import { getScannerCountReportPreferences } from "@/app/lib/scanner-count-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ExcelValue = string | number | boolean | Date | null | undefined;
type Row = Record<string, ExcelValue>;

type SessionShape = {
  user?: { id?: string | null; email?: string | null } | null;
} | null;

const REPORT_PERMISSIONS: Record<string, Permission[]> = {
  "checkout-orders": [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS],
  "needs-ordering": [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS],
  "min-qty-differences": [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS],
  "item-cost-history": [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS],
  "scanner-count-untouched": [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS],
  "parts-consumption-costs": [ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS, Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS],
  "work-order-costs": [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS],
  "maintenance-requests": [ADMIN_VIEW_MAINTENANCE_REQUESTS],
  "sla-breaches": [ADMIN_VIEW_REPORT_SLA_BREACHES],
  "technician-workload": [ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD, ADMIN_VIEW_MAINTENANCE_REQUESTS, Permission.ADMIN_VIEW_WORK_ORDERS],
  "preventative-maintenance": [ADMIN_VIEW_PREVENTATIVE_MAINTENANCE],
  "pm-compliance": [ADMIN_VIEW_REPORT_PM_COMPLIANCE, ADMIN_VIEW_PREVENTATIVE_MAINTENANCE],
  "temperature-incidents": [ADMIN_VIEW_REPORT_TEMPERATURE_INCIDENTS],
  "fleet-tco": [ADMIN_VIEW_REPORT_FLEET_TCO],
  "permission-coverage": [ADMIN_VIEW_REPORT_PERMISSION_COVERAGE],
  "notification-effectiveness": [ADMIN_VIEW_REPORT_NOTIFICATION_EFFECTIVENESS],
};

const PM_FIELDS = [
  "ovenCleaning",
  "exhaustFanMotor",
  "tanklessWaterHeater",
  "iceMaker",
  "greaseTrapGallons",
  "greaseTrapTankSize",
  "greaseTrapDatePumped",
  "greaseTrapCompany",
  "greaseTrapCost",
  "backflowDateChecked",
  "backflowCompany",
  "backflowAmount",
  "boilerInspectionDatePrimary",
  "boilerInspectionCompany",
  "boilerInspectionDateSecondary",
] as const;

function parseNum(value: string | null, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number(String(value ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, n);
}

function parseDateStart(value: string | null): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateEnd(value: string | null): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(`${raw}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function boolParam(value: string | null): boolean {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function personLabel(person: { name: string | null; email: string | null } | null | undefined, fallback = "Unknown"): string {
  if (!person) return fallback;
  return String(person.name ?? "").trim() || String(person.email ?? "").trim() || fallback;
}

function fileStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function hoursBetween(start: Date, end: Date): number {
  return Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60));
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60));
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(String(value));
  return Number.isFinite(n) ? n : 0;
}

function prettyCode(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}

function formatScannerLocation(sku: string): string {
  const room = parseSkuRoomParts(sku);
  if (!room) return "Unassigned";
  const location = room.location === "vault" ? "Vault" : `Loc ${prettyCode(room.location)}`;
  return `${location} / Shelf ${prettyCode(room.shelf)} / Bin ${prettyCode(room.bin)}`;
}

function exportWorkbook(filename: string, title: string, rows: Row[], columns: Array<{ key: string; header: string; kind?: "text" | "number" | "currency" | "date" | "datetime" | "boolean"; width?: number }>, metadata?: Array<[string, ExcelValue]>, totals?: Partial<Record<string, ExcelValue>>) {
  return excelResponse({
    filename,
    sheets: [
      {
        name: title,
        title,
        columns,
        rows,
        metadata: [["Rows", rows.length], ...(metadata ?? [])],
        totals,
      },
    ],
  });
}

async function requireReportAccess(report: string) {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) return new Response("Unauthorized", { status: 401 });

  const perms = await loadUserPermissions(session);
  const allowed = REPORT_PERMISSIONS[report];
  if (!allowed) return new Response("Unknown report", { status: 404 });
  if (!perms.allowAll && !hasAnyPermission(perms, allowed)) return new Response("Forbidden", { status: 403 });
  return null;
}

async function checkoutOrders(sp: URLSearchParams) {
  const q = String(sp.get("q") ?? "").trim();
  const statusRaw = String(sp.get("status") ?? "all").trim().toUpperCase();
  const status = statusRaw === "OPEN" || statusRaw === "INVOICED" || statusRaw === "VOIDED" ? statusRaw : "all";
  const storeId = String(sp.get("storeId") ?? "").trim();
  const itemId = String(sp.get("itemId") ?? "").trim();
  const createdByUserId = String(sp.get("createdByUserId") ?? "").trim();
  const needRaw = String(sp.get("needToOrderMore") ?? "all").trim().toLowerCase();
  const quantity = parseNum(sp.get("quantity"), 0);
  const from = parseDateStart(sp.get("from"));
  const to = parseDateEnd(sp.get("to"));
  const where: Prisma.PartsCheckoutTicketWhereInput = {
    ...(status === "all" ? {} : { status: status as PartsCheckoutStatus }),
    ...(storeId ? { storeId } : {}),
    ...(itemId ? { itemId } : {}),
    ...(createdByUserId ? { createdByUserId } : {}),
    ...(needRaw === "yes" || needRaw === "true" || needRaw === "1" ? { needToOrderMore: true } : {}),
    ...(needRaw === "no" || needRaw === "false" || needRaw === "0" ? { needToOrderMore: false } : {}),
    ...(quantity > 0 ? { quantity } : {}),
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
            { voidNote: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const tickets = await prisma.partsCheckoutTicket.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 10000,
    select: {
      id: true,
      status: true,
      invoiceId: true,
      storeName: true,
      quantity: true,
      needToOrderMore: true,
      createdByName: true,
      note: true,
      skuSnapshot: true,
      partNumberSnapshot: true,
      nameSnapshot: true,
      vendorSnapshot: true,
      costSnapshot: true,
      priceSnapshot: true,
      createdAt: true,
      invoicedAt: true,
      voidedAt: true,
      voidNote: true,
    },
  });
  const rows = tickets.map((r) => ({
    id: r.id,
    status: r.status,
    invoiceId: r.invoiceId,
    createdAt: r.createdAt,
    store: r.storeName,
    tech: r.createdByName,
    sku: r.skuSnapshot,
    partNumber: r.partNumberSnapshot,
    item: r.nameSnapshot,
    vendor: r.vendorSnapshot,
    quantity: r.quantity,
    cost: toNumber(r.costSnapshot),
    lineCost: toNumber(r.costSnapshot) * r.quantity,
    price: toNumber(r.priceSnapshot),
    needToOrderMore: r.needToOrderMore,
    invoicedAt: r.invoicedAt,
    voidedAt: r.voidedAt,
    note: r.note,
    voidNote: r.voidNote,
  }));
  return exportWorkbook(
    `checkout-orders_${fileStamp()}`,
    "Checkout Orders",
    rows,
    [
      { key: "id", header: "Ticket ID", width: 210 },
      { key: "status", header: "Status" },
      { key: "invoiceId", header: "Invoice ID", width: 210 },
      { key: "createdAt", header: "Created", kind: "datetime", width: 160 },
      { key: "store", header: "Store", width: 180 },
      { key: "tech", header: "Created By", width: 160 },
      { key: "sku", header: "SKU" },
      { key: "partNumber", header: "Part Number" },
      { key: "item", header: "Item", width: 240 },
      { key: "vendor", header: "Vendor" },
      { key: "quantity", header: "Qty", kind: "number" },
      { key: "cost", header: "Cost", kind: "currency" },
      { key: "lineCost", header: "Line Cost", kind: "currency" },
      { key: "price", header: "Price", kind: "currency" },
      { key: "needToOrderMore", header: "Need Order More", kind: "boolean" },
      { key: "invoicedAt", header: "Invoiced", kind: "datetime" },
      { key: "voidedAt", header: "Voided", kind: "datetime" },
      { key: "note", header: "Note", width: 260 },
      { key: "voidNote", header: "Void Note", width: 260 },
    ],
    [["Search", q], ["Status", status]],
    { lineCost: rows.reduce((sum, row) => sum + Number(row.lineCost ?? 0), 0) }
  );
}

async function needsOrdering(sp: URLSearchParams) {
  const q = String(sp.get("q") ?? "").trim();
  const includeIgnored = boolParam(sp.get("includeIgnored"));
  const like = `%${q}%`;
  type NeedsRow = Row & {
    id: string;
    sku: string;
    partNumber: string | null;
    name: string;
    cost: Prisma.Decimal | null;
    orderFrom: string | null;
    manufacturer: string | null;
    webUrl: string | null;
    onHandQty: number;
    orderedQty: number;
    minQty: number;
    reorderIgnored: boolean;
    openTechRequests: number;
    techRequestDetails: string | null;
  };
  const rowsRaw = await prisma.$queryRaw<NeedsRow[]>(Prisma.sql`
    WITH tech_req AS (
      SELECT ia."itemId", COUNT(*)::int AS "openTechRequests",
        COALESCE(STRING_AGG(DISTINCT CONCAT(COALESCE(NULLIF(BTRIM(COALESCE(ia."createdByName", u."name", u."email", '')), ''), 'Unknown'), ' (', TO_CHAR(ia."createdAt" AT TIME ZONE 'America/New_York', 'MM/DD/YYYY'), ')'), ', '), '') AS "techRequestDetails"
      FROM "InventoryAlert" ia
      INNER JOIN "PartsCheckoutTicket" pct ON pct."id" = ia."checkoutId"
      LEFT JOIN "User" u ON u."id" = ia."createdByUserId"
      WHERE ia."type" = 'TECH_REQUEST_ORDER'::"InventoryAlertType"
        AND ia."resolvedAt" IS NULL
        AND pct."needToOrderMore" = true
      GROUP BY ia."itemId"
    ),
    active_order_history AS (
      SELECT DISTINCT io."itemId"
      FROM "InventoryOrder" io
      WHERE io."status" IN ('ORDERED'::"InventoryOrderStatus", 'ARRIVED'::"InventoryOrderStatus")
    )
    SELECT i."id", i."sku", i."partNumber", i."name", i."cost", i."orderFrom", i."manufacturer", i."webUrl", i."onHandQty", i."orderedQty", i."minQty", i."reorderIgnored",
      COALESCE(t."openTechRequests", 0) AS "openTechRequests",
      COALESCE(t."techRequestDetails", '') AS "techRequestDetails"
    FROM "Item" i
    LEFT JOIN tech_req t ON t."itemId" = i."id"
    LEFT JOIN active_order_history aoh ON aoh."itemId" = i."id"
    WHERE "active" = true
      AND aoh."itemId" IS NULL
      AND (i."minQty" > (i."onHandQty" + i."orderedQty") OR COALESCE(t."openTechRequests", 0) > 0)
      AND ${
        q
          ? Prisma.sql`(i."sku" ILIKE ${like} OR i."name" ILIKE ${like} OR COALESCE(i."partNumber", '') ILIKE ${like} OR COALESCE(i."orderFrom", '') ILIKE ${like} OR COALESCE(i."manufacturer", '') ILIKE ${like})`
          : Prisma.sql`TRUE`
      }
      AND ${includeIgnored ? Prisma.sql`TRUE` : Prisma.sql`i."reorderIgnored" = false`}
    ORDER BY i."reorderIgnored" ASC, i."sku" ASC
  `);
  const rows = rowsRaw.map((r) => {
    const available = r.onHandQty + r.orderedQty;
    const shortBy = Math.max(0, r.minQty - available);
    const techRequest = r.openTechRequests > 0;
    const status = r.reorderIgnored ? "Ignored" : techRequest && shortBy === 0 ? `Tech Requested: ${r.techRequestDetails || "Unknown"}` : available <= 0 ? "Out" : "Below Min";
    return {
      sku: r.sku,
      partNumber: r.partNumber,
      item: r.name,
      supplier: r.orderFrom,
      manufacturer: r.manufacturer,
      webUrl: r.webUrl,
      onHand: r.onHandQty,
      ordered: r.orderedQty,
      available,
      min: r.minQty,
      shortBy,
      techRequests: r.openTechRequests,
      requestedByDate: r.techRequestDetails,
      status,
      ignored: r.reorderIgnored,
      cost: toNumber(r.cost),
      estimatedReorder: toNumber(r.cost) * Math.max(shortBy, techRequest ? 1 : 0),
    };
  });
  return exportWorkbook(
    `needs-ordering_${fileStamp()}`,
    "Needs Ordering",
    rows,
    [
      { key: "sku", header: "SKU" },
      { key: "partNumber", header: "Part Number" },
      { key: "item", header: "Item", width: 260 },
      { key: "supplier", header: "Supplier" },
      { key: "manufacturer", header: "Manufacturer" },
      { key: "onHand", header: "On Hand", kind: "number" },
      { key: "ordered", header: "Ordered", kind: "number" },
      { key: "available", header: "Available", kind: "number" },
      { key: "min", header: "Min", kind: "number" },
      { key: "shortBy", header: "Short By", kind: "number" },
      { key: "techRequests", header: "Tech Requests", kind: "number" },
      { key: "requestedByDate", header: "Requested By / Date", width: 240 },
      { key: "status", header: "Status", width: 240 },
      { key: "ignored", header: "Ignored", kind: "boolean" },
      { key: "cost", header: "Cost", kind: "currency" },
      { key: "estimatedReorder", header: "Estimated Reorder", kind: "currency" },
      { key: "webUrl", header: "Web URL", width: 260 },
    ],
    [["Search", q], ["Include Ignored", includeIgnored ? "Yes" : "No"]],
    { estimatedReorder: rows.reduce((sum, row) => sum + Number(row.estimatedReorder ?? 0), 0) }
  );
}

async function minQtyDifferences(sp: URLSearchParams) {
  const query = String(sp.get("q") ?? "").trim().toLowerCase();
  const items = await prisma.item.findMany({
    where: { active: true },
    select: { id: true, name: true, partNumber: true, sku: true, vendor: true, orderFrom: true, webUrl: true, onHandQty: true, minQty: true },
    orderBy: [{ name: "asc" }, { sku: "asc" }],
  });
  const recs = await getInventoryDemandRecommendations({ itemIds: items.map((i) => i.id) });
  const map = new Map(recs.map((r) => [r.itemId, r]));
  const rows = items
    .map((item) => {
      const rec = map.get(item.id);
      if (!rec?.compareMinQty || item.minQty === rec.suggestedMinQty30Day) return null;
      const row = {
        sku: item.sku,
        partNumber: item.partNumber,
        item: item.name,
        vendor: item.vendor === "AMERICAN_PLUS" ? "American Plus" : "Success Plus",
        supplier: item.orderFrom,
        onHand: item.onHandQty,
        currentMin: item.minQty,
        suggestedMin: rec.suggestedMinQty30Day,
        delta: rec.suggestedMinQty30Day - item.minQty,
        webUrl: item.webUrl,
      };
      if (!query) return row;
      const haystack = Object.values(row).join(" ").toLowerCase();
      return query.split(/\s+/).every((token) => haystack.includes(token)) ? row : null;
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  return exportWorkbook(`min-qty-differences_${fileStamp()}`, "Min Qty Differences", rows, [
    { key: "sku", header: "SKU" },
    { key: "partNumber", header: "Part Number" },
    { key: "item", header: "Item", width: 260 },
    { key: "vendor", header: "Vendor" },
    { key: "supplier", header: "Supplier" },
    { key: "onHand", header: "On Hand", kind: "number" },
    { key: "currentMin", header: "Current Min", kind: "number" },
    { key: "suggestedMin", header: "Suggested Min", kind: "number" },
    { key: "delta", header: "Delta", kind: "number" },
    { key: "webUrl", header: "Web URL", width: 260 },
  ], [["Search", query]]);
}

async function partsConsumption(sp: URLSearchParams) {
  const now = new Date();
  const from = parseDateStart(sp.get("from")) ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = parseDateEnd(sp.get("to")) ?? now;
  const includeVoided = boolParam(sp.get("includeVoided"));
  const tickets = await prisma.partsCheckoutTicket.findMany({
    where: { createdAt: { gte: from, lte: to }, ...(includeVoided ? {} : { status: { not: "VOIDED" } }) },
    orderBy: { createdAt: "desc" },
    take: 10000,
    select: { id: true, status: true, createdAt: true, storeName: true, createdByName: true, skuSnapshot: true, partNumberSnapshot: true, nameSnapshot: true, quantity: true, costSnapshot: true, needToOrderMore: true },
  });
  const rows = tickets.map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt,
    store: r.storeName,
    tech: r.createdByName,
    sku: r.skuSnapshot,
    partNumber: r.partNumberSnapshot,
    item: r.nameSnapshot,
    quantity: r.quantity,
    cost: toNumber(r.costSnapshot),
    lineCost: toNumber(r.costSnapshot) * r.quantity,
    needToOrderMore: r.needToOrderMore,
  }));
  return exportWorkbook(`parts-consumption-costs_${fileStamp()}`, "Parts Consumption + Cost", rows, [
    { key: "id", header: "Ticket ID", width: 210 },
    { key: "status", header: "Status" },
    { key: "createdAt", header: "Created", kind: "datetime" },
    { key: "store", header: "Store" },
    { key: "tech", header: "Tech" },
    { key: "sku", header: "SKU" },
    { key: "partNumber", header: "Part Number" },
    { key: "item", header: "Item", width: 240 },
    { key: "quantity", header: "Qty", kind: "number" },
    { key: "cost", header: "Cost", kind: "currency" },
    { key: "lineCost", header: "Line Cost", kind: "currency" },
    { key: "needToOrderMore", header: "Need Order More", kind: "boolean" },
  ], [["From", from], ["To", to], ["Include Voided", includeVoided ? "Yes" : "No"]], { lineCost: rows.reduce((sum, row) => sum + Number(row.lineCost ?? 0), 0) });
}

async function workOrderCosts(sp: URLSearchParams) {
  const from = parseDateStart(sp.get("from"));
  const to = parseDateEnd(sp.get("to"));
  const hourlyRate = parseNum(sp.get("hourlyRate"), 28);
  const mileageRate = parseNum(sp.get("mileageRate"), 0.67);
  type WorkOrderRow = { location: { name: string } | null; startTime: Date | null; endTime: Date | null; startingMileage: number | null; endingMileage: number | null };
  const rowsRaw = (await prisma.workOrder.findMany({
    where: { status: { in: ["SUBMITTED", "FINALIZED"] }, ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    take: 3000,
    select: { location: { select: { name: true } }, startTime: true, endTime: true, startingMileage: true, endingMileage: true },
  })) as WorkOrderRow[];
  const checkoutRows = await prisma.partsCheckoutTicket.findMany({
    where: { status: { not: PartsCheckoutStatus.VOIDED }, ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    select: { storeName: true, quantity: true, costSnapshot: true },
    take: 6000,
  });
  const byLocation = new Map<string, { orders: number; hours: number; miles: number; labor: number; mileageCost: number; checkoutLines: number; checkoutQty: number; checkoutCost: number; total: number }>();
  const bucket = (name: string) => {
    const existing = byLocation.get(name);
    if (existing) return existing;
    const created = { orders: 0, hours: 0, miles: 0, labor: 0, mileageCost: 0, checkoutLines: 0, checkoutQty: 0, checkoutCost: 0, total: 0 };
    byLocation.set(name, created);
    return created;
  };
  for (const r of rowsRaw) {
    const b = bucket(r.location?.name ?? "Unknown");
    const hours = r.startTime && r.endTime ? hoursBetween(r.startTime, r.endTime) : 0;
    const miles = typeof r.startingMileage === "number" && typeof r.endingMileage === "number" ? Math.max(0, r.endingMileage - r.startingMileage) : 0;
    b.orders += 1;
    b.hours += hours;
    b.miles += miles;
    b.labor += hours * hourlyRate;
    b.mileageCost += miles * mileageRate;
    b.total += hours * hourlyRate + miles * mileageRate;
  }
  for (const r of checkoutRows) {
    const b = bucket(r.storeName || "Unknown");
    const line = toNumber(r.costSnapshot) * r.quantity;
    b.checkoutLines += 1;
    b.checkoutQty += r.quantity;
    b.checkoutCost += line;
    b.total += line;
  }
  const rows = Array.from(byLocation.entries()).map(([location, r]) => ({ location, ...r })).sort((a, b) => b.total - a.total);
  return exportWorkbook(`work-order-costs_${fileStamp()}`, "Work Order Cost Rollup", rows, [
    { key: "location", header: "Location", width: 220 },
    { key: "orders", header: "Orders", kind: "number" },
    { key: "hours", header: "Hours", kind: "number" },
    { key: "miles", header: "Miles", kind: "number" },
    { key: "labor", header: "Labor Cost", kind: "currency" },
    { key: "mileageCost", header: "Mileage Cost", kind: "currency" },
    { key: "checkoutLines", header: "Checkout Lines", kind: "number" },
    { key: "checkoutQty", header: "Checkout Qty", kind: "number" },
    { key: "checkoutCost", header: "Checkout Cost", kind: "currency" },
    { key: "total", header: "Total", kind: "currency" },
  ], [["Hourly Rate", hourlyRate], ["Mileage Rate", mileageRate]], { total: rows.reduce((sum, row) => sum + row.total, 0) });
}

async function maintenanceRequests(sp: URLSearchParams) {
  const from = parseDateStart(sp.get("from"));
  const to = parseDateEnd(sp.get("to"));
  const q = String(sp.get("q") ?? "").trim();
  const rowsRaw = await prisma.maintenanceRequest.findMany({
    where: {
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: {
      id: true,
      status: true,
      title: true,
      description: true,
      createdAt: true,
      resolvedAt: true,
      archivedAt: true,
      updatedAt: true,
      resolutionNotes: true,
      location: { select: { name: true } },
      requestedByUser: { select: { name: true, email: true } },
      assignedMaintenanceUser: { select: { name: true, email: true } },
      resolvedByUser: { select: { name: true, email: true } },
    },
  });
  const rows = rowsRaw.map((r) => ({
    id: r.id,
    status: r.status,
    location: r.location.name,
    title: r.title,
    description: r.description,
    requestedBy: personLabel(r.requestedByUser),
    assignedTo: personLabel(r.assignedMaintenanceUser, "Unassigned"),
    resolvedBy: personLabel(r.resolvedByUser, ""),
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    archivedAt: r.archivedAt,
    updatedAt: r.updatedAt,
    resolutionNotes: r.resolutionNotes,
  }));
  const avgResolutionHours = computeAverageResolutionHours(rowsRaw.map((r) => ({ createdAt: r.createdAt, resolvedAt: r.resolvedAt })));
  return exportWorkbook(`maintenance-requests_${fileStamp()}`, "Maintenance Request Reports", rows, [
    { key: "id", header: "ID", width: 210 },
    { key: "status", header: "Status" },
    { key: "location", header: "Location" },
    { key: "title", header: "Title", width: 260 },
    { key: "description", header: "Description", width: 320 },
    { key: "requestedBy", header: "Requested By" },
    { key: "assignedTo", header: "Assigned To" },
    { key: "resolvedBy", header: "Resolved By" },
    { key: "createdAt", header: "Created", kind: "datetime" },
    { key: "resolvedAt", header: "Resolved", kind: "datetime" },
    { key: "archivedAt", header: "Archived", kind: "datetime" },
    { key: "updatedAt", header: "Updated", kind: "datetime" },
    { key: "resolutionNotes", header: "Resolution Notes", width: 320 },
  ], [["Search", q], ["Average Resolution Hours", avgResolutionHours == null ? "" : avgResolutionHours.toFixed(2)]]);
}

async function slaBreaches(sp: URLSearchParams) {
  const days = parseNum(sp.get("days"), 30, 365);
  const responseHours = parseNum(sp.get("responseHours"), 4);
  const closeHours = parseNum(sp.get("closeHours"), 48);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const data = await prisma.maintenanceRequest.findMany({
    where: { createdAt: { gte: since } },
    take: 5000,
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, status: true, createdAt: true, resolvedAt: true, archivedAt: true, location: { select: { name: true } }, assignedMaintenanceUser: { select: { name: true, email: true } }, requestedByUser: { select: { name: true, email: true } } },
  });
  const now = new Date();
  const rows = data
    .map((r) => {
      const end = r.resolvedAt ?? r.archivedAt ?? now;
      const ageHours = hoursBetween(r.createdAt, end);
      const responseBreached = r.status === "OPEN" && ageHours > responseHours;
      const closeBreached = r.status !== "OPEN" && ageHours > closeHours;
      if (!responseBreached && !closeBreached) return null;
      return { id: r.id, breachType: responseBreached ? "RESPONSE" : "CLOSE", ageHours, status: r.status, location: r.location.name, assigned: personLabel(r.assignedMaintenanceUser, "Unassigned"), title: r.title, requestedBy: personLabel(r.requestedByUser), createdAt: r.createdAt, resolvedAt: r.resolvedAt, archivedAt: r.archivedAt };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  return exportWorkbook(`sla-breaches_${fileStamp()}`, "SLA Breaches", rows, [
    { key: "id", header: "ID", width: 210 },
    { key: "breachType", header: "Breach Type" },
    { key: "ageHours", header: "Age Hours", kind: "number" },
    { key: "status", header: "Status" },
    { key: "location", header: "Location" },
    { key: "assigned", header: "Assigned" },
    { key: "title", header: "Title", width: 260 },
    { key: "requestedBy", header: "Requested By" },
    { key: "createdAt", header: "Created", kind: "datetime" },
    { key: "resolvedAt", header: "Resolved", kind: "datetime" },
    { key: "archivedAt", header: "Archived", kind: "datetime" },
  ], [["Window Days", days], ["Response Hours", responseHours], ["Close Hours", closeHours]]);
}

async function technicianWorkload(sp: URLSearchParams) {
  const days = parseNum(sp.get("days"), 30, 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [requests, workOrders] = await Promise.all([
    prisma.maintenanceRequest.findMany({ where: { createdAt: { gte: since } }, take: 5000, select: { status: true, resolvedAt: true, archivedAt: true, assignedMaintenanceUser: { select: { name: true, email: true } } } }),
    prisma.workOrder.findMany({ where: { createdAt: { gte: since } }, take: 5000, select: { status: true, createdByUser: { select: { name: true, email: true } } } }),
  ]);
  const map = new Map<string, { technician: string; requestOpen: number; requestClosed: number; workOrderOpen: number; workOrderClosed: number }>();
  const bucket = (name: string) => {
    const existing = map.get(name);
    if (existing) return existing;
    const created = { technician: name, requestOpen: 0, requestClosed: 0, workOrderOpen: 0, workOrderClosed: 0 };
    map.set(name, created);
    return created;
  };
  for (const r of requests) {
    const b = bucket(personLabel(r.assignedMaintenanceUser, "Unassigned"));
    if (r.resolvedAt || r.archivedAt || r.status !== "OPEN") b.requestClosed += 1;
    else b.requestOpen += 1;
  }
  for (const r of workOrders) {
    const b = bucket(personLabel(r.createdByUser));
    if (r.status === "SUBMITTED" || r.status === "FINALIZED") b.workOrderClosed += 1;
    else b.workOrderOpen += 1;
  }
  const rows = Array.from(map.values()).map((r) => ({ ...r, openTotal: r.requestOpen + r.workOrderOpen, closedTotal: r.requestClosed + r.workOrderClosed })).sort((a, b) => b.openTotal - a.openTotal);
  return exportWorkbook(`technician-workload_${fileStamp()}`, "Technician Workload", rows, [
    { key: "technician", header: "Technician", width: 220 },
    { key: "requestOpen", header: "Request Open", kind: "number" },
    { key: "requestClosed", header: "Request Closed", kind: "number" },
    { key: "workOrderOpen", header: "Work Order Open", kind: "number" },
    { key: "workOrderClosed", header: "Work Order Closed", kind: "number" },
    { key: "openTotal", header: "Open Total", kind: "number" },
    { key: "closedTotal", header: "Closed Total", kind: "number" },
  ], [["Window Days", days]]);
}

async function preventativeMaintenance(sp: URLSearchParams) {
  const year = normalizePmYear(sp.get("year") ?? undefined);
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const rowsRaw = await prisma.auditLog.findMany({
    where: { module: "PREVENTATIVE_MAINTENANCE", createdAt: { gte: start, lt: end } },
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: { id: true, action: true, message: true, createdAt: true, metadata: true, actorUser: { select: { name: true, email: true } } },
  });
  const rows = rowsRaw.map((r) => {
    const md = typeof r.metadata === "object" && r.metadata !== null ? (r.metadata as Record<string, unknown>) : {};
    return { id: r.id, createdAt: r.createdAt, actor: personLabel(r.actorUser), action: r.action, location: typeof md.locationName === "string" ? md.locationName : "Unknown", year: typeof md.year === "number" ? md.year : year, message: r.message };
  });
  return exportWorkbook(`preventative-maintenance_${year}`, "PM Audit & Activity", rows, [
    { key: "id", header: "ID", width: 210 },
    { key: "createdAt", header: "Created", kind: "datetime" },
    { key: "actor", header: "Actor" },
    { key: "action", header: "Action" },
    { key: "location", header: "Location" },
    { key: "year", header: "Year", kind: "number" },
    { key: "message", header: "Message", width: 360 },
  ], [["Year", year]]);
}

async function pmCompliance(sp: URLSearchParams) {
  const year = normalizePmYear(sp.get("year") ?? undefined);
  const data = await prisma.preventativeMaintenanceEntry.findMany({
    where: { year },
    orderBy: { location: { name: "asc" } },
    select: {
      id: true,
      location: { select: { name: true } },
      updatedAt: true,
      updatedByUser: { select: { name: true, email: true } },
      ovenCleaning: true,
      exhaustFanMotor: true,
      tanklessWaterHeater: true,
      iceMaker: true,
      greaseTrapGallons: true,
      greaseTrapTankSize: true,
      greaseTrapDatePumped: true,
      greaseTrapCompany: true,
      greaseTrapCost: true,
      backflowDateChecked: true,
      backflowCompany: true,
      backflowAmount: true,
      boilerInspectionDatePrimary: true,
      boilerInspectionCompany: true,
      boilerInspectionDateSecondary: true,
    },
  });
  const rows = data.map((r) => {
    const base: Row = { id: r.id, location: r.location.name, year, updatedAt: r.updatedAt, updatedBy: personLabel(r.updatedByUser) };
    let filled = 0;
    for (const key of PM_FIELDS) {
      const value = r[key];
      if (String(value ?? "").trim()) filled += 1;
      base[key] = value;
    }
    base.filledCount = filled;
    base.completionPct = (filled / PM_FIELDS.length) * 100;
    return base;
  });
  return exportWorkbook(`pm-compliance_${year}`, "PM Compliance Scorecard", rows, [
    { key: "id", header: "ID", width: 210 },
    { key: "location", header: "Location", width: 220 },
    { key: "year", header: "Year", kind: "number" },
    { key: "completionPct", header: "Completion %", kind: "number" },
    { key: "filledCount", header: "Filled Count", kind: "number" },
    { key: "updatedAt", header: "Updated", kind: "datetime" },
    { key: "updatedBy", header: "Updated By" },
    ...PM_FIELDS.map((key) => ({ key, header: PREVENTATIVE_MAINTENANCE_FIELD_LABELS[key] ?? key, width: 180 })),
  ], [["Year", year]]);
}

async function temperatureIncidents(sp: URLSearchParams) {
  const days = parseNum(sp.get("days"), 14, 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const data = await prisma.mocreoTemperatureReading.findMany({
    where: { recordedAt: { gte: since }, alertState: { in: ["HIGH", "LOW"] } },
    orderBy: { recordedAt: "desc" },
    take: 6000,
    select: { id: true, recordedAt: true, alertState: true, tempF: true, batteryPct: true, signalPct: true, hub: { select: { name: true, location: { select: { name: true } } } }, device: { select: { name: true } } },
  });
  const rows = data.map((r) => ({ id: r.id, recordedAt: r.recordedAt, hub: r.hub.name, location: r.hub.location?.name, device: r.device?.name, alertState: r.alertState, tempF: toNumber(r.tempF), batteryPct: r.batteryPct, signalPct: r.signalPct }));
  return exportWorkbook(`temperature-incidents_${fileStamp()}`, "Temperature Incident Timeline", rows, [
    { key: "id", header: "ID", width: 210 },
    { key: "recordedAt", header: "Recorded", kind: "datetime" },
    { key: "hub", header: "Hub" },
    { key: "location", header: "Location" },
    { key: "device", header: "Device" },
    { key: "alertState", header: "Alert" },
    { key: "tempF", header: "Temp F", kind: "number" },
    { key: "batteryPct", header: "Battery %", kind: "number" },
    { key: "signalPct", header: "Signal %", kind: "number" },
  ], [["Window Days", days]]);
}

async function fleetTco(sp: URLSearchParams) {
  const days = parseNum(sp.get("days"), 180, 730);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const vehicles = await prisma.companyVehicle.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, vinNumber: true, assignedUser: { select: { name: true, email: true } }, serviceLogs: { where: { serviceAt: { gte: since } }, select: { odometer: true, cost: true } }, reminders: { where: { active: true }, select: { lastCompletedAt: true } } },
  });
  const rows = vehicles.map((v) => {
    const costs = v.serviceLogs.reduce((sum, r) => sum + toNumber(r.cost), 0);
    const mileage = v.serviceLogs.map((r) => r.odometer).filter((m): m is number => typeof m === "number");
    const delta = mileage.length ? Math.max(...mileage) - Math.min(...mileage) : 0;
    return { vehicleId: v.id, vehicle: v.name, vin: v.vinNumber, assigned: personLabel(v.assignedUser, "Unassigned"), serviceLogs: v.serviceLogs.length, totalCost: costs, milesDelta: Math.max(0, delta), costPerMile: delta > 0 ? costs / delta : null, remindersCompleted: v.reminders.filter((r) => r.lastCompletedAt && r.lastCompletedAt >= since).length, remindersActive: v.reminders.length };
  });
  return exportWorkbook(`fleet-tco_${fileStamp()}`, "Fleet TCO", rows, [
    { key: "vehicleId", header: "Vehicle ID", width: 210 },
    { key: "vehicle", header: "Vehicle" },
    { key: "vin", header: "VIN" },
    { key: "assigned", header: "Assigned" },
    { key: "serviceLogs", header: "Service Logs", kind: "number" },
    { key: "totalCost", header: "Total Cost", kind: "currency" },
    { key: "milesDelta", header: "Miles Delta", kind: "number" },
    { key: "costPerMile", header: "Cost Per Mile", kind: "currency" },
    { key: "remindersCompleted", header: "Reminders Completed", kind: "number" },
    { key: "remindersActive", header: "Active Reminders", kind: "number" },
  ], [["Window Days", days]], { totalCost: rows.reduce((sum, row) => sum + row.totalCost, 0) });
}

async function permissionCoverage() {
  const perms: Array<[string, Permission]> = [
    ["SLA Breaches", ADMIN_VIEW_REPORT_SLA_BREACHES],
    ["Technician Workload", ADMIN_VIEW_REPORT_TECHNICIAN_WORKLOAD],
    ["Temperature Incidents", ADMIN_VIEW_REPORT_TEMPERATURE_INCIDENTS],
    ["PM Compliance", ADMIN_VIEW_REPORT_PM_COMPLIANCE],
    ["Parts Consumption", ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS],
    ["Fleet TCO", ADMIN_VIEW_REPORT_FLEET_TCO],
    ["Permission Coverage", ADMIN_VIEW_REPORT_PERMISSION_COVERAGE],
    ["Notification Effectiveness", ADMIN_VIEW_REPORT_NOTIFICATION_EFFECTIVENESS],
  ];
  const users = await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, role: true, permissions: { select: { permission: true } } } });
  const rows = users.map((u) => {
    const userPerms = new Set(u.permissions.map((p) => String(p.permission)));
    const row: Row = { user: personLabel(u), email: u.email, role: u.role };
    for (const [label, perm] of perms) row[label] = userPerms.has(String(perm)) ? "Allowed" : "";
    return row;
  });
  return exportWorkbook(`permission-coverage_${fileStamp()}`, "Permission Coverage", rows, [
    { key: "user", header: "User", width: 220 },
    { key: "email", header: "Email", width: 240 },
    { key: "role", header: "Role" },
    ...perms.map(([label]) => ({ key: label, header: label, width: 170 })),
  ]);
}

async function notificationEffectiveness(sp: URLSearchParams) {
  const days = parseNum(sp.get("days"), 30, 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const data = await prisma.notification.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 6000, select: { id: true, type: true, title: true, createdAt: true, readAt: true, user: { select: { id: true, name: true, email: true } } } });
  const rows = data.map((r) => ({ id: r.id, type: String(r.type), title: r.title, user: personLabel(r.user), createdAt: r.createdAt, readAt: r.readAt, minutesToRead: r.readAt ? minutesBetween(r.createdAt, r.readAt) : null, unread: !r.readAt }));
  return exportWorkbook(`notification-effectiveness_${fileStamp()}`, "Notification Effectiveness", rows, [
    { key: "id", header: "ID", width: 210 },
    { key: "type", header: "Type" },
    { key: "title", header: "Title", width: 280 },
    { key: "user", header: "User" },
    { key: "createdAt", header: "Created", kind: "datetime" },
    { key: "readAt", header: "Read", kind: "datetime" },
    { key: "minutesToRead", header: "Minutes To Read", kind: "number" },
    { key: "unread", header: "Unread", kind: "boolean" },
  ], [["Window Days", days]]);
}

async function scannerCountUntouched(session: SessionShape) {
  const sessionUserId = String(session?.user?.id ?? "").trim();
  const email = String(session?.user?.email ?? "").trim().toLowerCase();
  const user = sessionUserId
    ? await prisma.user.findUnique({ where: { id: sessionUserId }, select: { id: true, active: true, uiPreferences: true } })
    : email
      ? await prisma.user.findUnique({ where: { email }, select: { id: true, active: true, uiPreferences: true } })
      : null;
  if (!user?.id || !user.active) return new Response("Unauthorized", { status: 401 });

  const prefs = getScannerCountReportPreferences(user.uiPreferences);
  const resetAt = prefs.resetAt ? new Date(prefs.resetAt) : null;
  const touchedRows = await prisma.auditLog.findMany({
    where: {
      actorUserId: user.id,
      module: "INVENTORY_COUNT",
      action: { in: ["SCANNER_COUNT_VIEW", "SCANNER_COUNT_SAVE"] },
      entityType: "Item",
      entityId: { not: null },
      ...(resetAt ? { createdAt: { gte: resetAt } } : {}),
    },
    distinct: ["entityId"],
    select: { entityId: true },
  });
  const touchedIds = new Set(touchedRows.map((row) => row.entityId).filter((value): value is string => Boolean(value)));
  const hiddenIds = new Set(prefs.hiddenItemIds);
  const untouchedItems = await prisma.item.findMany({
    where: { active: true, ...(touchedIds.size > 0 ? { id: { notIn: [...touchedIds] } } : {}) },
    orderBy: [{ sku: "asc" }, { name: "asc" }],
    take: 10000,
    select: { id: true, sku: true, partNumber: true, name: true, onHandQty: true, webUrl: true },
  });
  const rows = untouchedItems
    .filter((item) => !hiddenIds.has(item.id))
    .map((item) => ({ sku: item.sku, partNumber: item.partNumber, item: item.name, location: formatScannerLocation(item.sku), onHand: item.onHandQty, link: item.webUrl }));
  return exportWorkbook(`scanner-count-untouched_${fileStamp()}`, "Scanner Count Untouched Parts", rows, [
    { key: "sku", header: "SKU" },
    { key: "partNumber", header: "Part Number" },
    { key: "item", header: "Item", width: 260 },
    { key: "location", header: "Location", width: 220 },
    { key: "onHand", header: "On Hand", kind: "number" },
    { key: "link", header: "Web URL", width: 260 },
  ], [["Reset At", prefs.resetAt], ["Hidden Count", hiddenIds.size]]);
}

async function itemCostHistory(sp: URLSearchParams) {
  const itemId = String(sp.get("itemId") ?? "").trim();
  const supplier = String(sp.get("supplier") ?? "").trim();
  const months = parseNum(sp.get("months"), 6, 60);
  const asOf = parseDateEnd(sp.get("asOf")) ?? new Date();
  const windowStart = new Date(asOf);
  windowStart.setMonth(windowStart.getMonth() - months);
  const items = await prisma.item.findMany({
    where: { active: true, ...(itemId ? { id: itemId } : {}) },
    orderBy: { sku: "asc" },
    take: 10000,
    select: { id: true, sku: true, partNumber: true, name: true, cost: true, orderFrom: true },
  });
  const orderRows = await prisma.inventoryOrder.groupBy({
    by: ["itemId"],
    where: { itemId: { in: items.map((i) => i.id) }, orderedAt: { gte: windowStart, lte: asOf }, ...(supplier ? { supplierName: { contains: supplier, mode: "insensitive" } } : {}) },
    _avg: { unitPrice: true },
    _max: { orderedAt: true },
  });
  const orderMap = new Map(orderRows.map((r) => [r.itemId, r]));
  const rows = items.map((item) => {
    const order = orderMap.get(item.id);
    const historicCost = toNumber(order?._avg.unitPrice);
    const currentCost = toNumber(item.cost);
    return { sku: item.sku, partNumber: item.partNumber, item: item.name, supplier: item.orderFrom, currentCost, historicCost, delta: currentCost - historicCost, deltaPct: historicCost ? ((currentCost - historicCost) / historicCost) * 100 : null, lastOrderAt: order?._max.orderedAt ?? null };
  });
  return exportWorkbook(`item-cost-history_${fileStamp()}`, "Item Cost History", rows, [
    { key: "sku", header: "SKU" },
    { key: "partNumber", header: "Part Number" },
    { key: "item", header: "Item", width: 260 },
    { key: "supplier", header: "Supplier" },
    { key: "currentCost", header: "Current Cost", kind: "currency" },
    { key: "historicCost", header: "Historic Cost", kind: "currency" },
    { key: "delta", header: "Delta", kind: "currency" },
    { key: "deltaPct", header: "Delta %", kind: "number" },
    { key: "lastOrderAt", header: "Last Order", kind: "date" },
  ], [["Months", months], ["Supplier", supplier], ["As Of", asOf]]);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const report = String(url.searchParams.get("report") ?? "").trim();
  const session = (await getServerSession(authOptions)) as SessionShape;
  const accessError = await requireReportAccess(report);
  if (accessError) return accessError;

  switch (report) {
    case "checkout-orders":
      return checkoutOrders(url.searchParams);
    case "needs-ordering":
      return needsOrdering(url.searchParams);
    case "min-qty-differences":
      return minQtyDifferences(url.searchParams);
    case "parts-consumption-costs":
      return partsConsumption(url.searchParams);
    case "work-order-costs":
      return workOrderCosts(url.searchParams);
    case "maintenance-requests":
      return maintenanceRequests(url.searchParams);
    case "sla-breaches":
      return slaBreaches(url.searchParams);
    case "technician-workload":
      return technicianWorkload(url.searchParams);
    case "preventative-maintenance":
      return preventativeMaintenance(url.searchParams);
    case "pm-compliance":
      return pmCompliance(url.searchParams);
    case "temperature-incidents":
      return temperatureIncidents(url.searchParams);
    case "fleet-tco":
      return fleetTco(url.searchParams);
    case "permission-coverage":
      return permissionCoverage();
    case "notification-effectiveness":
      return notificationEffectiveness(url.searchParams);
    case "scanner-count-untouched":
      return scannerCountUntouched(session);
    case "item-cost-history":
      return itemCostHistory(url.searchParams);
    default:
      return new Response("Unknown report", { status: 404 });
  }
}
