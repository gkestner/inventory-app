import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Permission, Prisma } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import {
  listVendorCredentials,
  removeVendorCredential,
  upsertVendorCredential,
} from "@/app/lib/vendor-credentials";

export const runtime = "nodejs";

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
    const credentials = listVendorCredentials(user.uiPreferences);
    return NextResponse.json({ credentials });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to load vendor credentials.";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { site?: unknown; username?: unknown; password?: unknown };
    const site = String(body.site ?? "").trim();
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "").trim();

    if (!site) return NextResponse.json({ error: "Site is required." }, { status: 400 });
    if (!username) return NextResponse.json({ error: "Username is required." }, { status: 400 });
    if (!password) return NextResponse.json({ error: "Password is required." }, { status: 400 });

    const user = await resolveCurrentUser();
    const nextPrefs = upsertVendorCredential(user.uiPreferences, { site, username, password });

    const saved = await prisma.user.update({
      where: { id: user.id },
      data: { uiPreferences: nextPrefs as Prisma.InputJsonValue },
      select: { uiPreferences: true },
    });

    return NextResponse.json({ credentials: listVendorCredentials(saved.uiPreferences) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to save vendor credential.";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { site?: unknown };
    const site = String(body.site ?? "").trim();
    if (!site) return NextResponse.json({ error: "Site is required." }, { status: 400 });

    const user = await resolveCurrentUser();
    const nextPrefs = removeVendorCredential(user.uiPreferences, site);

    const saved = await prisma.user.update({
      where: { id: user.id },
      data: { uiPreferences: nextPrefs as Prisma.InputJsonValue },
      select: { uiPreferences: true },
    });

    return NextResponse.json({ credentials: listVendorCredentials(saved.uiPreferences) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to remove vendor credential.";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
