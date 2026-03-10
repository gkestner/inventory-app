"use client";

import { useRef, useState } from "react";
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
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");

  async function onFileSelected(file: File | null) {
    if (!file) return;

    setBusy(true);
    setMessage("");

    try {
      const initRes = await fetch("/api/admin/work-orders/attachments/upload-url", {
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

      const completeRes = await fetch("/api/admin/work-orders/attachments/complete", {
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
        throw new Error(completeJson.error || "Failed to finalize attachment.");
      }

      setMessage("Upload complete.");
      router.refresh();
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => cameraInputRef.current?.click()}
          style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", fontWeight: 800, cursor: busy ? "not-allowed" : "pointer" }}
        >
          Take Picture
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => uploadInputRef.current?.click()}
          style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", fontWeight: 800, cursor: busy ? "not-allowed" : "pointer" }}
        >
          Upload Picture
        </button>
      </div>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        disabled={busy}
        onChange={(e) => onFileSelected(e.currentTarget.files?.[0] ?? null)}
        style={{ display: "none" }}
      />
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(e) => onFileSelected(e.currentTarget.files?.[0] ?? null)}
        style={{ display: "none" }}
      />
      <div style={{ fontSize: 12, opacity: 0.85 }}>
        Max file size: 25MB. This uploads directly to configured GCS bucket using a short-lived signed URL.
      </div>
      {message ? <div style={{ fontSize: 12, fontWeight: 800 }}>{message}</div> : null}
    </div>
  );
}
