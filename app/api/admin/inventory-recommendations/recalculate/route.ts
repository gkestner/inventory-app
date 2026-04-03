import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import {
  getInventoryDemandRecommendations,
  recalculateItemMinQuantitiesFrom30DayUsage,
} from "@/app/lib/inventory-demand";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

function isAuthorizedByToken(req: NextRequest): boolean {
  const expected = process.env.INVENTORY_RECOMMENDATION_TOKEN?.trim() || process.env.CRON_SECRET?.trim();
  if (!expected) return false;

  const tokenFromHeader = req.headers.get("x-inventory-recommendation-token")?.trim();
  if (tokenFromHeader && tokenFromHeader === expected) return true;

  const bearer = req.headers.get("authorization")?.trim() ?? "";
  if (bearer.toLowerCase().startsWith("bearer ")) {
    const incoming = bearer.slice(7).trim();
    if (incoming && incoming === expected) return true;
  }

  const tokenFromQuery = req.nextUrl.searchParams.get("token")?.trim();
  if (tokenFromQuery && tokenFromQuery === expected) return true;

  return false;
}

async function isAuthorizedBySession(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  if (!session) return false;
  const perms = await loadUserPermissions(session);
  return perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
}

async function run(req: NextRequest) {
  const authorized = isAuthorizedByToken(req) || (await isAuthorizedBySession());
  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const apply = ["1", "true", "yes"].includes((req.nextUrl.searchParams.get("apply") ?? "").toLowerCase());
  const includeInactive = ["1", "true", "yes"].includes(
    (req.nextUrl.searchParams.get("includeInactive") ?? "").toLowerCase()
  );

  if (apply) {
    const result = await recalculateItemMinQuantitiesFrom30DayUsage({ includeInactive });
    return NextResponse.json({
      ok: true,
      mode: "apply",
      scannedCount: result.scannedCount,
      updatedCount: result.updatedCount,
      unchangedCount: result.unchangedCount,
      changes: result.changes.slice(0, 50),
    });
  }

  const recommendations = await getInventoryDemandRecommendations({ includeInactive });
  return NextResponse.json({
    ok: true,
    mode: "preview",
    scannedCount: recommendations.length,
    recommendations: recommendations.slice(0, 100),
  });
}

export async function GET(req: NextRequest) {
  try {
    return await run(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    return await run(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}