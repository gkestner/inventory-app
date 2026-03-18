"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  receiptEntryId: string;
};

type FileWithDate = {
  file: File;
  date: string; // YYYY-MM-DD
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

export default function BatchReceiptFileUploader({ receiptEntryId }: Props) {
  const router = useRouter();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [selectedFiles, setSelectedFiles] = useState<FileWithDate[]>([]);

  const todayIso = new Intl.DateTimeFormat("en-CA").format(new Date());

  async function uploadFile(fileWithDate: FileWithDate): Promise<boolean> {
    const file = fileWithDate.file;

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

      if (!completeRes.ok) {
        const err = await completeRes.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Failed to finalize file upload.");
      }

      return true;
    } catch (err) {
      setMessage(`Error uploading ${file.name}: ${errText(err)}`);
      return false;
    }
  }

  async function uploadBatch(files: FileWithDate[]) {
    setBusy(true);
    setMessage("");

    let success = 0;
    let failed = 0;

    for (const fileWithDate of files) {
      const uploaded = await uploadFile(fileWithDate);
      if (uploaded) {
        success++;
      } else {
        failed++;
      }
    }

    if (failed === 0) {
      setMessage(`Successfully uploaded ${success} file${success !== 1 ? "s" : ""}.`);
      setSelectedFiles([]);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      router.refresh();
    } else {
      setMessage(`Uploaded ${success}, failed ${failed}. Please try again.`);
    }

    setBusy(false);
  }

  function handleFilesSelected(files: FileList | null) {
    if (!files) return;

    const newFiles: FileWithDate[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file) {
        newFiles.push({
          file,
          date: todayIso,
        });
      }
    }

    setSelectedFiles(newFiles);
  }

  function updateFileDate(index: number, date: string) {
    const updated = [...selectedFiles];
    updated[index].date = date;
    setSelectedFiles(updated);
  }

  function removeFile(index: number) {
    const updated = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(updated);
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <button
          type="button"
          disabled={busy}
          onClick={() => uploadInputRef.current?.click()}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--surface-2)",
            fontWeight: 800,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          Select Files to Upload
        </button>
        <input
          ref={uploadInputRef}
          type="file"
          multiple
          disabled={busy}
          onChange={(e) => handleFilesSelected(e.currentTarget.files)}
          style={{ display: "none" }}
        />
      </div>

      {selectedFiles.length > 0 && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 12,
            background: "var(--background)",
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 14 }}>
            Selected: {selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""}
          </div>

          <div style={{ display: "grid", gap: 8, maxHeight: 300, overflow: "auto" }}>
            {selectedFiles.map((item, idx) => (
              <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center", fontSize: 13 }}>
                <div style={{ wordBreak: "break-word", minWidth: 0 }}>{item.file.name}</div>
                <input
                  type="date"
                  value={item.date}
                  onChange={(e) => updateFileDate(idx, e.target.value)}
                  disabled={busy}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "6px 8px",
                    background: "var(--surface)",
                    color: "var(--foreground)",
                    cursor: busy ? "not-allowed" : "pointer",
                  }}
                />
                <button
                  type="button"
                  onClick={() => removeFile(idx)}
                  disabled={busy}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--foreground)",
                    cursor: busy ? "not-allowed" : "pointer",
                    fontSize: 12,
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => uploadBatch(selectedFiles)}
            disabled={busy}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--brand)",
              color: "white",
              fontWeight: 800,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Uploading..." : `Upload ${selectedFiles.length} File${selectedFiles.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}

      <div style={{ fontSize: 12, opacity: 0.85 }}>Max file size per file: 25MB. Drag files or click to select.</div>
      {message && <div style={{ fontSize: 12, fontWeight: 800, color: message.includes("Error") ? "var(--error)" : "var(--success)" }}>{message}</div>}
    </div>
  );
}
