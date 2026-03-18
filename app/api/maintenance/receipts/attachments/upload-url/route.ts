import { randomUUID } from "crypto";
import { getServerSession } from "next-auth";
import { Storage } from "@google-cloud/storage";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { getGcsConfig } from "@/app/lib/workflow-foundations";
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

function encodePathSegments(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((p) => encodeURIComponent(p))
    .join("/");
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

    const gcs = getGcsConfig();
    if (!gcs.bucket) {
      return json({ error: "GCS is not configured. Set GCS_BUCKET." }, 500);
    }

    const contentType = contentTypeRaw || "application/octet-stream";
    const safeName = cleanSegment(fileNameRaw);
    const basePath = (gcs.basePath || "receipt-files/").replace(/^\/+/, "").replace(/\/+$/, "");
    const storageKey = `${basePath}/${receiptEntryId}/${Date.now()}-${randomUUID()}-${safeName}`;

    const storage = new Storage(gcs.projectId ? { projectId: gcs.projectId } : undefined);
    const file = storage.bucket(gcs.bucket).file(storageKey);

    const expiresMs = Date.now() + 10 * 60 * 1000;
    const [uploadUrl] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: expiresMs,
      contentType,
    });

    const publicUrl = `https://storage.googleapis.com/${encodeURIComponent(gcs.bucket)}/${encodePathSegments(storageKey)}`;

    return json({
      uploadUrl,
      expiresAt: new Date(expiresMs).toISOString(),
      publicUrl,
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
