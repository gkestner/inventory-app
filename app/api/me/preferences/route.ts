import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { DEFAULT_USER_PREFERENCES, normalizeUserPreferences } from "@/app/lib/user-preferences";

type AppSession = {
  user?: {
    id?: string | null;
    email?: string | null;
  } | null;
} | null;

// Some editor sessions can temporarily lag Prisma type regeneration.
// Keep this route resilient by using a narrow cast for reads/writes of the JSON field.
type PrismaUserCompat = {
  findUnique: (args: unknown) => Promise<{ id?: string; uiPreferences?: unknown } | null>;
  update: (args: unknown) => Promise<unknown>;
};

function getPrismaUser(): PrismaUserCompat {
  return (prisma.user as unknown) as PrismaUserCompat;
}

async function requireSessionUser() {
  const session = (await getServerSession(authOptions)) as AppSession;
  if (!session) return { ok: false as const, status: 401, error: "Unauthorized" };

  const userId = session.user?.id?.trim() || "";
  const email = session.user?.email?.trim().toLowerCase() || "";

  if (userId) return { ok: true as const, userId };
  if (!email) return { ok: false as const, status: 401, error: "Unauthorized" };

  const found = await getPrismaUser().findUnique({ where: { email }, select: { id: true } });
  if (!found?.id) return { ok: false as const, status: 401, error: "Unauthorized" };

  return { ok: true as const, userId: found.id };
}

export async function GET() {
  const auth = await requireSessionUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const user = await getPrismaUser().findUnique({
    where: { id: auth.userId },
    select: { uiPreferences: true },
  });

  const prefs = normalizeUserPreferences(user?.uiPreferences ?? DEFAULT_USER_PREFERENCES);
  return NextResponse.json({ preferences: prefs }, { status: 200 });
}

export async function PATCH(req: Request) {
  const auth = await requireSessionUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const prefs = normalizeUserPreferences((body as { preferences?: unknown } | null)?.preferences ?? body);

  await getPrismaUser().update({
    where: { id: auth.userId },
    data: { uiPreferences: prefs },
  });

  return NextResponse.json({ preferences: prefs }, { status: 200 });
}
