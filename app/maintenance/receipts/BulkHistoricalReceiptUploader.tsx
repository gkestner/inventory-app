"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  userId: string;
  locationId: string;
  allowedLocations: Array<{ id: string; name: string }>;
  allowedUsers: Array<{ id: string; name: string | null; email: string }>;
};

type FileWithDate = {
  file: File;
  date: string; // YYYY-MM-DD
  amount: string; // dollar amount
};

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Upload failed.";
}

export default function BulkHistoricalReceiptUploader({
  userId: initialUserId,
  locationId: initialLocationId,
  allowedLocations,
  allowedUsers,
}: Props) {
  const router = useRouter();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [selectedFiles, setSelectedFiles] = useState<FileWithDate[]>([]);
  const [selectedUserId, setSelectedUserId] = useState(initialUserId);
  const [selectedLocationId, setSelectedLocationId] = useState(initialLocationId);

  const todayIso = new Intl.DateTimeFormat("en-CA").format(new Date());

  function handleFilesSelected(files: FileList | null) {
    if (!files) return;

    const newFiles: FileWithDate[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file) {
        newFiles.push({
          file,
          date: todayIso,
          amount: "",
        });
      }
    }

    setSelectedFiles([...selectedFiles, ...newFiles]);
  }

  function updateFileDate(index: number, date: string) {
    const updated = [...selectedFiles];
    updated[index].date = date;
    setSelectedFiles(updated);
  }

  function updateFileAmount(index: number, amount: string) {
    const updated = [...selectedFiles];
    updated[index].amount = amount;
    setSelectedFiles(updated);
  }

  function removeFile(index: number) {
    const updated = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(updated);
  }

  async function uploadBatch() {
    if (!selectedUserId) {
      setMessage("Please select a user.");
      return;
    }
    if (!selectedLocationId) {
      setMessage("Please select a location.");
      return;
    }
    if (selectedFiles.length === 0) {
      setMessage("Please select files to upload.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/maintenance/receipts/bulk-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUserId,
          locationId: selectedLocationId,
          files: selectedFiles.map((f) => ({
            name: f.file.name,
            date: f.date,
            amount: f.amount ? Math.round(parseFloat(f.amount) * 100) : 0,
            size: f.file.size,
            type: f.file.type,
          })),
        }),
      });

      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        receiptIds?: string[];
        uploadUrls?: Array<{ uploadUrl: string; storageKey: string; receiptId: string; index: number }>;
      };

      if (!response.ok || !result.uploadUrls) {
        throw new Error(result.error || "Failed to initialize bulk upload.");
      }

      // Upload each file to its signed URL
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i].file;
        const uploadInfo = result.uploadUrls.find((u) => u.index === i);

        if (!uploadInfo) {
          setMessage(`Error uploading ${file.name}: Upload URL not found.`);
          continue;
        }

        const putRes = await fetch(uploadInfo.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
          },
          body: file,
        });

        if (!putRes.ok) {
          setMessage(`Error uploading ${file.name} (${putRes.status}).`);
          continue;
        }
      }

      // Finalize all uploads
      const finalizeRes = await fetch("/api/maintenance/receipts/bulk-upload-finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploads: result.uploadUrls.map((u, idx) => ({
            receiptId: u.receiptId,
            index: idx,
            fileName: selectedFiles[idx]?.file.name || "",
            fileSize: selectedFiles[idx]?.file.size || 0,
            contentType: selectedFiles[idx]?.file.type || "application/octet-stream",
            storageKey: u.storageKey,
          })),
        }),
      });

      const finalizeResult = (await finalizeRes.json().catch(() => ({}))) as { error?: string };

      if (!finalizeRes.ok) {
        throw new Error(finalizeResult.error || "Failed to finalize bulk upload.");
      }

      setMessage(`Successfully uploaded ${selectedFiles.length} historical receipt${selectedFiles.length !== 1 ? "s" : ""}.`);
      setSelectedFiles([]);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      router.refresh();
    } catch (err) {
      setMessage(`Error: ${errText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
            User
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              disabled={busy}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "10px 12px",
                background: "var(--background)",
                color: "var(--foreground)",
                width: "100%",
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              <option value="">Select user</option>
              {allowedUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {(u.name?.trim() || "(No Name)") + " (" + u.email + ")"}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
            Location
            <select
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(e.target.value)}
              disabled={busy}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "10px 12px",
                background: "var(--background)",
                color: "var(--foreground)",
                width: "100%",
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              <option value="">Select location</option>
              {allowedLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        </div>

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
            alignSelf: "start",
          }}
        >
          Select Receipt Files
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

          <div style={{ display: "grid", gap: 8, maxHeight: 400, overflow: "auto" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1.2fr auto",
                gap: 8,
                fontSize: 12,
                fontWeight: 700,
                paddingBottom: 8,
                borderBottom: "1px solid var(--border)",
                alignItems: "center",
              }}
            >
              <div>File Name</div>
              <div>Date</div>
              <div>Amount ($)</div>
              <div></div>
            </div>

            {selectedFiles.map((item, idx) => (
              <div
                key={idx}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1.2fr auto",
                  gap: 8,
                  alignItems: "center",
                  fontSize: 13,
                  paddingBottom: 8,
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ wordBreak: "break-word", minWidth: 0, opacity: 0.9 }}>{item.file.name}</div>
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
                    fontSize: 12,
                  }}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.amount}
                  onChange={(e) => updateFileAmount(idx, e.target.value)}
                  placeholder="0.00"
                  disabled={busy}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "6px 8px",
                    background: "var(--surface)",
                    color: "var(--foreground)",
                    cursor: busy ? "not-allowed" : "pointer",
                    fontSize: 12,
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
            onClick={uploadBatch}
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
            {busy ? "Uploading..." : `Upload ${selectedFiles.length} Historical Receipt${selectedFiles.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}

      <div style={{ fontSize: 12, opacity: 0.85 }}>
        Max file size per file: 25MB. Each file will create a separate receipt entry with the date and amount you specify.
      </div>
      {message && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            color: message.includes("Error") || message.includes("error") ? "var(--error, #f87171)" : "var(--success, #4ade80)",
          }}
        >
          {message}
        </div>
      )}
    </div>
  );
}
