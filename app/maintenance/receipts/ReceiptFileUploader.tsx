"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  receiptEntryId: string;
};

type UploadInitResponse = {
  uploadUrl: string;
  expiresAt: string;
  publicUrl: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  receiptEntryId: string;
};

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Upload failed.";
}

export default function ReceiptFileUploader({ receiptEntryId }: Props) {
  const router = useRouter();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");

  async function onFileSelected(file: File | null) {
    if (!file) return;

    setBusy(true);
    setMessage("");

    try {
      const initRes = await fetch("/api/maintenance/receipts/attachments/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptEntryId,
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

      const completeRes = await fetch("/api/maintenance/receipts/attachments/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptEntryId,
          fileName: initJson.fileName || file.name,
          contentType: initJson.contentType || file.type || null,
          byteSize: initJson.byteSize || file.size,
          storageKey: initJson.storageKey,
          url: initJson.publicUrl,
        }),
      });

      const completeJson = (await completeRes.json().catch(() => ({}))) as { error?: string };
      if (!completeRes.ok) {
        throw new Error(completeJson.error || "Failed to finalize file upload.");
      }

      setMessage("File uploaded successfully.");
      // Clear the file input
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      // Refresh to show the new file
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
          onClick={() => uploadInputRef.current?.click()}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            fontWeight: 800,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          Upload File
        </button>
      </div>
      <input
        ref={uploadInputRef}
        type="file"
        disabled={busy}
        onChange={(e) => onFileSelected(e.currentTarget.files?.[0] ?? null)}
        style={{ display: "none" }}
      />
      <div style={{ fontSize: 12, opacity: 0.85 }}>Max file size: 25MB. Accepts images, PDFs, and documents.</div>
      {message ? <div style={{ fontSize: 12, fontWeight: 800 }}>{message}</div> : null}
    </div>
  );
}
