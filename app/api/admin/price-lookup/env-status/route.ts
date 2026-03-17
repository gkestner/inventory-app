import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const runtime = "nodejs";

const KEY_NAMES = [
  "OPENAI_API_KEY",
  "OPENAI_KEY",
  "OPENAI_APIKEY",
  "OPENAIKEY",
  "NEXT_PUBLIC_OPENAI_API_KEY",
] as const;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadUserPermissions(session);
  const canUse = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!canUse) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const present = KEY_NAMES.filter((name) => {
    const value = process.env[name];
    return Boolean(value && value.trim().length > 0);
  });

  return NextResponse.json({
    hasOpenAiKey: present.length > 0,
    presentVars: present,
  });
}
