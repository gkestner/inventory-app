"use client";

import { upload } from "@vercel/blob/client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  receiptEntryId: string;
};

type UploadInitResponse = {
  storageKey: string;
  fileName: string;
  contentType: string;
  byteSize: number;
};

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Upload failed.";
}

export default function ReceiptRowFileUploader({ receiptEntryId }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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

      const initJson = (await initRes.json().catch(() => ({}))) as Partial<UploadInitResponse> & { error?: string };
      if (!initRes.ok || !initJson.storageKey) {
        throw new Error(initJson.error || "Unable to initialize upload.");
      }

      const blob = await upload(initJson.storageKey, file, {
        access: "public",
        handleUploadUrl: "/api/maintenance/receipts/blob-upload",
        contentType: initJson.contentType || file.type || "application/octet-stream",
      });

      const completeRes = await fetch("/api/maintenance/receipts/attachments/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptEntryId,
          fileName: initJson.fileName || file.name,
          contentType: initJson.contentType || file.type || null,
          byteSize: initJson.byteSize || file.size,
          storageKey: blob.pathname || initJson.storageKey,
          url: blob.url,
        }),
      });

      const completeJson = (await completeRes.json().catch(() => ({}))) as { error?: string };
      if (!completeRes.ok) throw new Error(completeJson.error || "Failed to finalize upload.");

      setMessage("Added");
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        style={{
          border: "1px solid rgba(128,128,128,0.35)",
          borderRadius: 8,
          padding: "6px 8px",
          background: "var(--surface-2)",
          fontSize: 12,
          fontWeight: 700,
          cursor: busy ? "not-allowed" : "pointer",
          width: "fit-content",
        }}
      >
        {busy ? "Uploading..." : "Add file"}
      </button>
      <input
        ref={inputRef}
        type="file"
        disabled={busy}
        onChange={(e) => onFileSelected(e.currentTarget.files?.[0] ?? null)}
        style={{ display: "none" }}
      />
      {message ? <div style={{ fontSize: 11, opacity: 0.85 }}>{message}</div> : null}
    </div>
  );
}
