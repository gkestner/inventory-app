import { getServerSession } from "next-auth";

import { authOptions } from "@/app/lib/auth";
import { canAccessAdmin } from "@/app/lib/admin-access";
import { prisma } from "@/app/lib/prisma";
import { createAuditLog, getCompatDb } from "@/app/lib/workflow-foundations";

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

    const body = (await req.json().catch(() => null)) as
      | {
          workOrderId?: string;
          fileName?: string;
          contentType?: string;
          byteSize?: number;
          storageKey?: string;
          url?: string;
        }
      | null;

    const workOrderId = String(body?.workOrderId ?? "").trim();
    const fileName = String(body?.fileName ?? "").trim();
    const contentType = String(body?.contentType ?? "").trim() || null;
    const storageKey = String(body?.storageKey ?? "").trim() || null;
    const byteSizeNum = Number(body?.byteSize ?? 0);
    const byteSize = Number.isFinite(byteSizeNum) && byteSizeNum > 0 ? Math.trunc(byteSizeNum) : null;
    const url = normalizeUrl(String(body?.url ?? ""));

    if (!workOrderId) return json({ error: "workOrderId is required." }, 400);
    if (!fileName) return json({ error: "fileName is required." }, 400);
    if (!url) return json({ error: "A valid URL is required." }, 400);

    const email = String((session as { user?: { email?: string | null } } | null)?.user?.email ?? "")
      .trim()
      .toLowerCase();
    if (!email) return json({ error: "Unauthorized" }, 401);

    const actor = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!actor?.id) return json({ error: "Unauthorized" }, 401);

    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, createdByUserId: true },
    });
    if (!wo) return json({ error: "Work order not found." }, 404);

    const isAdmin = await canAccessAdmin(session);
    if (!isAdmin && wo.createdByUserId !== actor.id) {
      return json({ error: "Forbidden" }, 403);
    }

    const db = getCompatDb() as any;
    if (!db.workOrderAttachment?.create) {
      return json({ error: "Work order attachments table not available. Run latest migrations." }, 500);
    }

    const attachment = await db.workOrderAttachment.create({
      data: {
        workOrderId,
        addedByUserId: actor.id,
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
      module: "work-orders",
      action: "attachment-upload",
      entityType: "WorkOrderAttachment",
      entityId: attachment.id,
      workOrderId,
      message: `Uploaded attachment ${attachment.fileName}`,
      metadata: { storageKey: attachment.storageKey, byteSize: attachment.byteSize },
    });

    return json({ ok: true, attachment });
  } catch (err) {
    console.error("Finalize maintenance attachment failed:", err);
    return json({ error: "Failed to finalize attachment." }, 500);
  }
}
