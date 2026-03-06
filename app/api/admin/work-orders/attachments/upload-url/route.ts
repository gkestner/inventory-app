import { randomUUID } from "crypto";
import { getServerSession } from "next-auth";
import { Storage } from "@google-cloud/storage";

import { authOptions } from "@/app/lib/auth";
import { canAccessAdmin } from "@/app/lib/admin-access";
import { prisma } from "@/app/lib/prisma";
import { getGcsConfig } from "@/app/lib/workflow-foundations";

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
    if (!(await canAccessAdmin(session))) return json({ error: "Forbidden" }, 403);

    const body = (await req.json().catch(() => null)) as
      | { workOrderId?: string; fileName?: string; contentType?: string; byteSize?: number }
      | null;

    const workOrderId = String(body?.workOrderId ?? "").trim();
    const fileNameRaw = String(body?.fileName ?? "").trim();
    const contentTypeRaw = String(body?.contentType ?? "").trim();
    const byteSize = Number(body?.byteSize ?? 0);

    if (!workOrderId) return json({ error: "workOrderId is required." }, 400);
    if (!fileNameRaw) return json({ error: "fileName is required." }, 400);
    if (!Number.isFinite(byteSize) || byteSize <= 0) return json({ error: "Invalid byteSize." }, 400);
    if (byteSize > MAX_BYTES) {
      return json({ error: `Attachment exceeds max size (${Math.floor(MAX_BYTES / (1024 * 1024))}MB).` }, 400);
    }

    const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true } });
    if (!wo) return json({ error: "Work order not found." }, 404);

    const gcs = getGcsConfig();
    if (!gcs.bucket) {
      return json({ error: "GCS is not configured. Set GCS_BUCKET." }, 500);
    }

    const contentType = contentTypeRaw || "application/octet-stream";
    const safeName = cleanSegment(fileNameRaw);
    const basePath = (gcs.basePath || "work-order-attachments/").replace(/^\/+/, "").replace(/\/+$/, "");
    const storageKey = `${basePath}/${workOrderId}/${Date.now()}-${randomUUID()}-${safeName}`;

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
      workOrderId,
    });
  } catch (err) {
    console.error("Create GCS signed upload URL failed:", err);
    return json({ error: "Failed to create upload URL." }, 500);
  }
}
