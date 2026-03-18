import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/app/lib/auth";
import { loadUserPermissions, hasAnyPermission } from "@/app/lib/permissions";
import { CREATE_RECEIPTS, VIEW_RECEIPTS } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "application/octet-stream",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

function getBlobReadWriteToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim() || process.env.Inventory_READ_WRITE_TOKEN?.trim() || "";
  if (!token) throw new Error("Blob is not configured. Set BLOB_READ_WRITE_TOKEN or Inventory_READ_WRITE_TOKEN.");
  return token;
}

function isAllowedPath(pathname: string): boolean {
  const basePath = (process.env.GCS_BASE_PATH?.trim() || "receipt-files/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const normalized = pathname.trim().replace(/^\/+/, "");
  if (!normalized) return false;
  if (!normalized.startsWith(`${basePath}/`)) return false;
  return normalized.length <= 1024;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const perms = await loadUserPermissions(session);
    const canUploadReceipts = perms.allowAll || hasAnyPermission(perms, [VIEW_RECEIPTS, CREATE_RECEIPTS]);
    if (!canUploadReceipts) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as HandleUploadBody;
    const token = getBlobReadWriteToken();

    const jsonResponse = await handleUpload({
      body,
      request,
      token,
      onBeforeGenerateToken: async (pathname) => {
        if (!isAllowedPath(pathname)) {
          throw new Error("Invalid upload path.");
        }

        return {
          maximumSizeInBytes: MAX_BYTES,
          allowedContentTypes: [...ALLOWED_CONTENT_TYPES],
          addRandomSuffix: false,
        };
      },
      // Database writes are handled by existing complete/finalize endpoints after upload succeeds.
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
