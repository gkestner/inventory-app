import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { createAuditLog, getCompatDb } from "@/app/lib/workflow-foundations";
import { loadUserPermissions, hasAnyPermission } from "@/app/lib/permissions";
import { CREATE_RECEIPTS, VIEW_RECEIPTS } from "@/app/lib/permission-constants";

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
    const canViewReceiptsPerm = perms.allowAll || hasAnyPermission(perms, [VIEW_RECEIPTS, CREATE_RECEIPTS]);
    if (!canViewReceiptsPerm) {
      return json({ error: "Forbidden" }, 403);
    }

    const body = (await req.json().catch(() => null)) as
      | {
          receiptEntryId?: string;
          fileName?: string;
          contentType?: string;
          byteSize?: number;
          storageKey?: string;
          url?: string;
        }
      | null;

    const receiptEntryId = String(body?.receiptEntryId ?? "").trim();
    const fileName = String(body?.fileName ?? "").trim();
    const contentType = String(body?.contentType ?? "").trim() || null;
    const storageKey = String(body?.storageKey ?? "").trim() || null;
    const byteSizeNum = Number(body?.byteSize ?? 0);
    const byteSize = Number.isFinite(byteSizeNum) && byteSizeNum > 0 ? Math.trunc(byteSizeNum) : null;
    const url = normalizeUrl(String(body?.url ?? ""));

    if (!receiptEntryId) return json({ error: "receiptEntryId is required." }, 400);
    if (!fileName) return json({ error: "fileName is required." }, 400);
    if (!url) return json({ error: "A valid URL is required." }, 400);

    const email = String((session as { user?: { email?: string | null } } | null)?.user?.email ?? "")
      .trim()
      .toLowerCase();
    if (!email) return json({ error: "Unauthorized" }, 401);

    const actor = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!actor?.id) return json({ error: "Unauthorized" }, 401);

    const receipt = await prisma.receiptEntry.findUnique({
      where: { id: receiptEntryId },
      select: { id: true, createdByUserId: true },
    });
    if (!receipt) return json({ error: "Receipt entry not found." }, 404);

    const db = getCompatDb() as any;
    if (!db.receiptFile?.create) {
      return json({ error: "Receipt files table not available. Run latest migrations." }, 500);
    }

    const file = await db.receiptFile.create({
      data: {
        receiptEntryId,
        uploadedByUserId: actor.id,
        fileName,
        contentType,
        byteSize,
        storageKey,
        url,
      },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        byteSize: true,
        storageKey: true,
        url: true,
        createdAt: true,
      },
    });

    await createAuditLog({
      actorUserId: actor.id,
      module: "receipts",
      action: "file-upload",
      entityType: "ReceiptFile",
      entityId: file.id,
      message: `Uploaded receipt file ${file.fileName}`,
      metadata: { storageKey: file.storageKey, byteSize: file.byteSize },
    });

    revalidatePath("/maintenance/receipts");
    revalidatePath("/maintenance");

    return json({ ok: true, file });
  } catch (err) {
    console.error("Finalize receipt file upload failed:", err);
    return json({ error: "Failed to finalize file upload." }, 500);
  }
}
