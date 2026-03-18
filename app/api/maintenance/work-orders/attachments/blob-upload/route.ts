import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/app/lib/auth";

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
  const basePath = (process.env.GCS_BASE_PATH?.trim() || "work-order-attachments/")
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
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
