import { randomUUID } from "crypto";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
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
            locationId?: string;
          }>;
        }
      | null;

    const userId = String(body?.userId ?? "").trim();
    const requestedLocationId = String(body?.locationId ?? "").trim();
    const filesRaw = Array.isArray(body?.files) ? body.files : [];

    if (!userId) return json({ error: "userId is required." }, 400);
    if (filesRaw.length === 0) return json({ error: "At least one file is required." }, 400);
    if (filesRaw.length > 100) return json({ error: "Maximum 100 files per upload." }, 400);

    // Validate user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        active: true,
        locationId: true,
        location: { select: { id: true, active: true, receiptEnabled: true } },
        allowedLocations: {
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
          select: {
            locationId: true,
            location: { select: { id: true, active: true, receiptEnabled: true } },
          },
        },
      },
    });
    if (!user || !user.active) return json({ error: "User not found or inactive." }, 404);

    const candidateLocationIds: string[] = [];
    if (user.locationId && user.location?.active && user.location.receiptEnabled) {
      candidateLocationIds.push(user.locationId);
    }
    for (const ul of user.allowedLocations) {
      if (!ul.location?.active || !ul.location.receiptEnabled) continue;
      if (candidateLocationIds.includes(ul.locationId)) continue;
      candidateLocationIds.push(ul.locationId);
    }

    if (candidateLocationIds.length === 0) {
      return json({ error: "Selected user has no active receipt-enabled location assigned." }, 400);
    }

    if (requestedLocationId && !candidateLocationIds.includes(requestedLocationId)) {
      return json({ error: "Selected location is not assigned to that user." }, 400);
    }

    const uploadUrls: Array<{
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

      const targetLocationId = String(fileInfo.locationId ?? "").trim() || requestedLocationId || candidateLocationIds[0] || "";
      if (!targetLocationId) {
        return json({ error: `File ${i + 1}: selected user has no active receipt-enabled location assigned.` }, 400);
      }

      if (!candidateLocationIds.includes(targetLocationId)) {
        return json({ error: `File ${i + 1}: selected location is not assigned to that user.` }, 400);
      }

      const targetLocation = await prisma.location.findUnique({
        where: { id: targetLocationId },
        select: { id: true, active: true, receiptEnabled: true },
      });
      if (!targetLocation || !targetLocation.active || !targetLocation.receiptEnabled) {
        return json({ error: `File ${i + 1}: location not found, inactive, or not receipt-enabled.` }, 404);
      }

      const receiptDate = parseYmdDateAsUtcNoon(dateStr);

      // Create receipt entry
      const receipt = await db.receiptEntry.create({
        data: {
          receiptDate,
          locationId: targetLocationId,
          amountCents,
          billedBackVendor: null,
          notes: `Bulk upload - ${fileName}`,
          createdByUserId: userId,
        },
        select: { id: true },
      });

      receiptIds.push(receipt.id);

      // Create deterministic blob path for client upload.
      const safeName = cleanSegment(fileName);
      const basePath = (process.env.GCS_BASE_PATH?.trim() || "receipt-files/")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
      const storageKey = `${basePath}/${receipt.id}/${Date.now()}-${randomUUID()}-${safeName}`;

      uploadUrls.push({
        storageKey,
        receiptId: receipt.id,
        index: i,
      });
    }

    revalidatePath("/maintenance/receipts");
    revalidatePath("/maintenance");

    return json({
      receiptIds,
      uploadUrls,
    });
  } catch (err) {
    console.error("Bulk receipt upload init failed:", err);
    return json({ error: "Failed to initialize bulk upload." }, 500);
  }
}
