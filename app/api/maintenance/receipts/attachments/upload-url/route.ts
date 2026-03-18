import { randomUUID } from "crypto";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { loadUserPermissions, hasAnyPermission } from "@/app/lib/permissions";
import { CREATE_RECEIPTS, VIEW_RECEIPTS } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function cleanSegment(v: string): string {
  const s = v.trim();
  if (!s) return "file";
  return s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 120) || "file";
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return json({ error: "Unauthorized" }, 401);

    const perms = await loadUserPermissions(session);
    const canViewReceiptsPerm = perms.allowAll || hasAnyPermission(perms, [VIEW_RECEIPTS, CREATE_RECEIPTS]);
    if (!canViewReceiptsPerm) {
      return json({ error: "Forbidden" }, 403);
    }

    const body = (await req.json().catch(() => null)) as
      | { receiptEntryId?: string; fileName?: string; contentType?: string; byteSize?: number }
      | null;

    const receiptEntryId = String(body?.receiptEntryId ?? "").trim();
    const fileNameRaw = String(body?.fileName ?? "").trim();
    const contentTypeRaw = String(body?.contentType ?? "").trim();
    const byteSize = Number(body?.byteSize ?? 0);

    if (!receiptEntryId) return json({ error: "receiptEntryId is required." }, 400);
    if (!fileNameRaw) return json({ error: "fileName is required." }, 400);
    if (!Number.isFinite(byteSize) || byteSize <= 0) return json({ error: "Invalid byteSize." }, 400);
    if (byteSize > MAX_BYTES) {
      return json({ error: `File exceeds max size (${Math.floor(MAX_BYTES / (1024 * 1024))}MB).` }, 400);
    }

    const email = String((session as { user?: { email?: string | null } } | null)?.user?.email ?? "")
      .trim()
      .toLowerCase();
    if (!email) return json({ error: "Unauthorized" }, 401);

    const actor = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!actor?.id) return json({ error: "Unauthorized" }, 401);

    const receipt = await prisma.receiptEntry.findUnique({
      where: { id: receiptEntryId },
      select: { id: true, createdByUserId: true, locationId: true },
    });
    if (!receipt) return json({ error: "Receipt entry not found." }, 404);

    const contentType = contentTypeRaw || "application/octet-stream";
    const safeName = cleanSegment(fileNameRaw);
    const basePath = (process.env.GCS_BASE_PATH?.trim() || "receipt-files/")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    const storageKey = `${basePath}/${receiptEntryId}/${Date.now()}-${randomUUID()}-${safeName}`;

    return json({
      storageKey,
      fileName: fileNameRaw,
      contentType,
      byteSize,
      receiptEntryId,
    });
  } catch (err) {
    console.error("Create receipt file GCS signed upload URL failed:", err);
    return json({ error: "Failed to create upload URL." }, 500);
  }
}
