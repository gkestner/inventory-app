import { randomUUID } from "crypto";
import { getServerSession } from "next-auth";
import { Storage } from "@google-cloud/storage";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { getGcsConfig } from "@/app/lib/workflow-foundations";
import { loadUserPermissions, hasAnyPermission } from "@/app/lib/permissions";
import { CREATE_RECEIPTS } from "@/app/lib/permission-constants";

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

function parseYmdDateAsUtcNoon(dateStr: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) throw new Error("Invalid date format.");

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    throw new Error("Invalid date values.");
  }

  return new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return json({ error: "Unauthorized" }, 401);

    const perms = await loadUserPermissions(session);
    if (!perms.allowAll && !hasAnyPermission(perms, [CREATE_RECEIPTS])) {
      return json({ error: "Forbidden" }, 403);
    }

    const body = (await req.json().catch(() => null)) as
      | {
          userId?: string;
          locationId?: string;
          files?: Array<{
            name?: string;
            date?: string;
            amount?: number;
            size?: number;
            type?: string;
          }>;
        }
      | null;

    const userId = String(body?.userId ?? "").trim();
    const locationId = String(body?.locationId ?? "").trim();
    const filesRaw = Array.isArray(body?.files) ? body.files : [];

    if (!userId) return json({ error: "userId is required." }, 400);
    if (!locationId) return json({ error: "locationId is required." }, 400);
    if (filesRaw.length === 0) return json({ error: "At least one file is required." }, 400);
    if (filesRaw.length > 100) return json({ error: "Maximum 100 files per upload." }, 400);

    // Validate user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, active: true },
    });
    if (!user || !user.active) return json({ error: "User not found or inactive." }, 404);

    // Validate location
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true, active: true, receiptEnabled: true },
    });
    if (!location || !location.active || !location.receiptEnabled) {
      return json({ error: "Location not found, inactive, or not receipt-enabled." }, 404);
    }

    const gcs = getGcsConfig();
    if (!gcs.bucket) {
      return json({ error: "GCS is not configured." }, 500);
    }

    const uploadUrls: Array<{
      uploadUrl: string;
      storageKey: string;
      receiptId: string;
      index: number;
    }> = [];
    const receiptIds: string[] = [];

    const db = (await prisma) as any;

    // Create receipt entries and get upload URLs
    for (let i = 0; i < filesRaw.length; i++) {
      const fileInfo = filesRaw[i];
      if (!fileInfo) continue;

      const fileName = String(fileInfo.name ?? "").trim();
      const dateStr = String(fileInfo.date ?? "").trim();
      const amountCents = Number(fileInfo.amount ?? 0);
      const byteSize = Number(fileInfo.size ?? 0);
      const contentType = String(fileInfo.type ?? "application/octet-stream");

      if (!fileName) return json({ error: `File ${i + 1}: name is required.` }, 400);
      if (!dateStr) return json({ error: `File ${i + 1}: date is required.` }, 400);

      if (byteSize <= 0 || byteSize > MAX_BYTES) {
        return json(
          {
            error: `File ${i + 1} exceeds max size (${Math.floor(MAX_BYTES / (1024 * 1024))}MB).`,
          },
          400
        );
      }

      const receiptDate = parseYmdDateAsUtcNoon(dateStr);

      // Create receipt entry
      const receipt = await db.receiptEntry.create({
        data: {
          receiptDate,
          locationId,
          amountCents,
          billedBackVendor: null,
          notes: `Bulk upload - ${fileName}`,
          createdByUserId: userId,
        },
        select: { id: true },
      });

      receiptIds.push(receipt.id);

      // Create signed upload URL
      const safeName = cleanSegment(fileName);
      const basePath = (gcs.basePath || "receipt-files/").replace(/^\/+/, "").replace(/\/+$/, "");
      const storageKey = `${basePath}/${receipt.id}/${Date.now()}-${randomUUID()}-${safeName}`;

      const storage = new Storage(gcs.projectId ? { projectId: gcs.projectId } : undefined);
      const file = storage.bucket(gcs.bucket).file(storageKey);

      const expiresMs = Date.now() + 15 * 60 * 1000; // 15 minute expiry
      const [uploadUrl] = await file.getSignedUrl({
        version: "v4",
        action: "write",
        expires: expiresMs,
        contentType,
      });

      uploadUrls.push({
        uploadUrl,
        storageKey,
        receiptId: receipt.id,
        index: i,
      });
    }

    return json({
      receiptIds,
      uploadUrls,
    });
  } catch (err) {
    console.error("Bulk receipt upload init failed:", err);
    return json({ error: "Failed to initialize bulk upload." }, 500);
  }
}
