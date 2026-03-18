import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { createAuditLog, getCompatDb, getGcsConfig } from "@/app/lib/workflow-foundations";
import { loadUserPermissions, hasAnyPermission } from "@/app/lib/permissions";
import { CREATE_RECEIPTS } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function normalizeUrl(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  if (t.startsWith("gs://")) return t;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
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
          uploads?: Array<{
            receiptId?: string;
            index?: number;
            fileName?: string;
            fileSize?: number;
            contentType?: string;
            storageKey?: string;
          }>;
        }
      | null;

    const uploadsRaw = Array.isArray(body?.uploads) ? body.uploads : [];
    if (uploadsRaw.length === 0) return json({ error: "No uploads to finalize." }, 400);

    const email = String((session as { user?: { email?: string | null } } | null)?.user?.email ?? "")
      .trim()
      .toLowerCase();
    if (!email) return json({ error: "Unauthorized" }, 401);

    const actor = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!actor?.id) return json({ error: "Unauthorized" }, 401);

    const db = getCompatDb() as any;
    if (!db.receiptFile?.create) {
      return json({ error: "Receipt files table not available. Run latest migrations." }, 500);
    }

    // Create receipt files for each upload
    for (const uploadInfo of uploadsRaw) {
      const receiptId = String(uploadInfo.receiptId ?? "").trim();
      const fileName = String(uploadInfo.fileName ?? "").trim();
      const fileSizeNum = Number(uploadInfo.fileSize ?? 0);
      const fileSize = Number.isFinite(fileSizeNum) && fileSizeNum > 0 ? Math.trunc(fileSizeNum) : null;
      const contentType = String(uploadInfo.contentType ?? "").trim() || null;
      const storageKey = String(uploadInfo.storageKey ?? "").trim() || null;

      if (!receiptId || !fileName) continue;

      // Construct public URL from storage key
      const gcsConfig = getGcsConfig();
      let publicUrl = "";
      if (storageKey && gcsConfig.bucket) {
        publicUrl = `https://storage.googleapis.com/${encodeURIComponent(gcsConfig.bucket)}/${storageKey
          .split("/")
          .map((p) => encodeURIComponent(p))
          .join("/")}`;
      }

      if (!publicUrl) continue;

      try {
        const file = await db.receiptFile.create({
          data: {
            receiptEntryId: receiptId,
            uploadedByUserId: actor.id,
            fileName,
            contentType,
            byteSize: fileSize,
            storageKey,
            url: publicUrl,
          },
          select: {
            id: true,
            fileName: true,
          },
        });

        await createAuditLog({
          actorUserId: actor.id,
          module: "receipts",
          action: "bulk-file-upload",
          entityType: "ReceiptFile",
          entityId: file.id,
          message: `Bulk uploaded receipt file ${file.fileName}`,
          metadata: { storageKey, byteSize: fileSize },
        });
      } catch (err) {
        console.error(`Failed to create receipt file record for ${fileName}:`, err);
        // Continue with next file
      }
    }

    return json({ ok: true, uploaded: uploadsRaw.length });
  } catch (err) {
    console.error("Bulk receipt finalize failed:", err);
    return json({ error: "Failed to finalize bulk upload." }, 500);
  }
}
