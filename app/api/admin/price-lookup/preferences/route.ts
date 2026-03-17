import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Permission, type Prisma } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { getPriceLookupPreferences, setPriceLookupPreferences } from "@/app/lib/price-lookup-preferences";

export const runtime = "nodejs";

type PrefsBody = {
  includeVendors?: unknown;
  excludeVendors?: unknown;
};

async function requireLookupAccess() {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("Unauthorized");

  const perms = await loadUserPermissions(session);
  const canUse = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!canUse) throw new Error("Forbidden");

  return session;
}

async function resolveCurrentUser() {
  const session = await requireLookupAccess();
  const userId = (session.user as unknown as { id?: string | null } | null)?.id ?? null;
  const email = (session.user as unknown as { email?: string | null } | null)?.email ?? null;

  if (userId) {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, uiPreferences: true } });
    if (row) return row;
  }

  if (email) {
    const row = await prisma.user.findUnique({ where: { email }, select: { id: true, uiPreferences: true } });
    if (row) return row;
  }

  throw new Error("User not found");
}

export async function GET() {
  try {
    const user = await resolveCurrentUser();
    const prefs = getPriceLookupPreferences(user.uiPreferences);
    return NextResponse.json(prefs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load preferences.";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await resolveCurrentUser();
    const body = (await req.json().catch(() => ({}))) as PrefsBody;

    const nextUiPreferences = setPriceLookupPreferences(user.uiPreferences, {
      includeVendors: body.includeVendors,
      excludeVendors: body.excludeVendors,
    });

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { uiPreferences: nextUiPreferences as Prisma.InputJsonValue },
      select: { uiPreferences: true },
    });

    const prefs = getPriceLookupPreferences(updated.uiPreferences);
    return NextResponse.json(prefs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save preferences.";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
