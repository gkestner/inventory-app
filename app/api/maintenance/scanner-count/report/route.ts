import { NextResponse } from "next/server";
import { Permission, Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { parseSkuRoomParts } from "@/app/lib/item-sku";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import {
  getScannerCountReportPreferences,
  setScannerCountReportPreferences,
} from "@/app/lib/scanner-count-report";

type SessionShape = {
  user?: {
    email?: string | null;
    id?: string | null;
  } | null;
} | null;

function prettyCode(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}

function formatLocation(sku: string): string {
  const room = parseSkuRoomParts(sku);
  if (!room) return "Unassigned";
  const location = room.location === "vault" ? "Vault" : `Loc ${prettyCode(room.location)}`;
  return `${location} / Shelf ${prettyCode(room.shelf)} / Bin ${prettyCode(room.bin)}`;
}

async function requireScannerCountUser() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) return { ok: false as const, status: 401, error: "Unauthorized" };

  const perms = await loadUserPermissions(session);
  const allowed = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!allowed) return { ok: false as const, status: 403, error: "Forbidden" };

  const sessionUserId = String(session.user?.id ?? "").trim();
  const email = String(session.user?.email ?? "").trim().toLowerCase();
  const user = sessionUserId
    ? await prisma.user.findUnique({ where: { id: sessionUserId }, select: { id: true, active: true, uiPreferences: true } })
    : email
      ? await prisma.user.findUnique({ where: { email }, select: { id: true, active: true, uiPreferences: true } })
      : null;

  if (!user?.id || !user.active) return { ok: false as const, status: 401, error: "Unauthorized" };
  return { ok: true as const, user };
}

async function buildReport(userId: string, uiPreferences: unknown) {
  const prefs = getScannerCountReportPreferences(uiPreferences);
  const resetAt = prefs.resetAt ? new Date(prefs.resetAt) : null;
  const touchedRows = await prisma.auditLog.findMany({
    where: {
      actorUserId: userId,
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
    where: {
      active: true,
      ...(touchedIds.size > 0 ? { id: { notIn: [...touchedIds] } } : {}),
    },
    orderBy: [{ sku: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      onHandQty: true,
      sku: true,
      partNumber: true,
      webUrl: true,
    },
  });
  const items = hiddenIds.size > 0 ? untouchedItems.filter((item) => !hiddenIds.has(item.id)) : untouchedItems;
  const hiddenCount = untouchedItems.length - items.length;

  return {
    resetAt: prefs.resetAt,
    total: untouchedItems.length,
    hiddenCount,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      onHandQty: item.onHandQty,
      location: formatLocation(item.sku),
      link: item.webUrl,
      partNumber: item.partNumber,
    })),
  };
}

export async function GET() {
  const gate = await requireScannerCountUser();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  return NextResponse.json(await buildReport(gate.user.id, gate.user.uiPreferences), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST() {
  const gate = await requireScannerCountUser();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const resetAt = new Date().toISOString();
  const nextUiPreferences = setScannerCountReportPreferences(gate.user.uiPreferences, { resetAt, hiddenItemIds: [] });
  await prisma.user.update({
    where: { id: gate.user.id },
    data: { uiPreferences: nextUiPreferences as Prisma.InputJsonValue },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: gate.user.id,
      module: "INVENTORY_COUNT",
      action: "SCANNER_COUNT_REPORT_RESET",
      entityType: "User",
      entityId: gate.user.id,
      message: "Scanner count report reset.",
      metadata: { resetAt },
    },
  });

  return NextResponse.json(await buildReport(gate.user.id, nextUiPreferences), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PATCH(req: Request) {
  const gate = await requireScannerCountUser();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const itemId = String((body as { itemId?: unknown } | null)?.itemId ?? "").trim();
  if (!itemId) return NextResponse.json({ error: "Item ID is required" }, { status: 400 });

  const prefs = getScannerCountReportPreferences(gate.user.uiPreferences);
  const nextHiddenItemIds = Array.from(new Set([...prefs.hiddenItemIds, itemId]));
  const nextUiPreferences = setScannerCountReportPreferences(gate.user.uiPreferences, {
    resetAt: prefs.resetAt,
    hiddenItemIds: nextHiddenItemIds,
  });

  await prisma.user.update({
    where: { id: gate.user.id },
    data: { uiPreferences: nextUiPreferences as Prisma.InputJsonValue },
    select: { id: true },
  });

  return NextResponse.json(await buildReport(gate.user.id, nextUiPreferences), {
    headers: { "Cache-Control": "no-store" },
  });
}