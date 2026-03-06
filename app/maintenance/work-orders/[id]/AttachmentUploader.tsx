"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  workOrderId: string;
};

type UploadInitResponse = {
  uploadUrl: string;
  expiresAt: string;
  publicUrl: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  workOrderId: string;
};

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Upload failed.";
}

export default function AttachmentUploader({ workOrderId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");

  async function onFileSelected(file: File | null) {
    if (!file) return;

    setBusy(true);
    setMessage("");

    try {
      const initRes = await fetch("/api/maintenance/work-orders/attachments/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workOrderId,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          byteSize: file.size,
        }),
      });

      const initJson = (await initRes.json().catch(() => ({}))) as Partial<UploadInitResponse> & {
        error?: string;
      };

      if (!initRes.ok || !initJson.uploadUrl || !initJson.publicUrl || !initJson.storageKey) {
        throw new Error(initJson.error || "Unable to get upload URL.");
      }

      const putRes = await fetch(initJson.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": initJson.contentType || file.type || "application/octet-stream",
        },
        body: file,
      });

      if (!putRes.ok) {
        throw new Error(`Cloud upload failed (${putRes.status}).`);
      }

      const completeRes = await fetch("/api/maintenance/work-orders/attachments/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workOrderId,
          fileName: initJson.fileName || file.name,
          contentType: initJson.contentType || file.type || null,
          byteSize: initJson.byteSize || file.size,
          storageKey: initJson.storageKey,
          url: initJson.publicUrl,
        }),
      });

      const completeJson = (await completeRes.json().catch(() => ({}))) as { error?: string };
      if (!completeRes.ok) {
        throw new Error(completeJson.error || "Failed to finalize picture upload.");
      }

      setMessage("Picture uploaded.");
      router.refresh();
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 900, opacity: 0.95 }}>
        Upload Picture
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(e) => onFileSelected(e.currentTarget.files?.[0] ?? null)}
          style={{ padding: 8, border: "1px solid var(--border)", borderRadius: 10 }}
        />
      </label>
      <div style={{ fontSize: 12, opacity: 0.85 }}>Max file size: 25MB.</div>
      {message ? <div style={{ fontSize: 12, fontWeight: 800 }}>{message}</div> : null}
    </div>
  );
}
