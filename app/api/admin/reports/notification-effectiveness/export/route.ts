import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseNum(v: string | null, fallback: number): number {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / (1000 * 60));
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.ADMIN_VIEW_USERS, Permission.ADMIN_EDIT_USERS])) {
    return new Response("Forbidden", { status: 403 });
  }

  const days = Math.min(365, parseNum(new URL(req.url).searchParams.get("days"), 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.notification.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 10000,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      href: true,
      createdAt: true,
      readAt: true,
      user: { select: { name: true, email: true } },
    },
  });

  const header = ["id", "type", "title", "body", "href", "createdAt", "readAt", "minutesToRead", "user"];
  const lines: string[] = [header.join(",")];

  for (const r of rows) {
    const user = (r.user.name ?? "").trim() || r.user.email || "Unknown";
    const minutesToRead = r.readAt ? minutesBetween(r.createdAt, r.readAt).toFixed(1) : "";
    lines.push(
      [
        r.id,
        r.type,
        r.title,
        r.body ?? "",
        r.href ?? "",
        r.createdAt.toISOString(),
        r.readAt?.toISOString() ?? "",
        minutesToRead,
        user,
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  const csv = lines.join("\n");
  const filename = `notification-effectiveness_${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${filename}\"`,
      "Cache-Control": "no-store",
    },
  });
}
