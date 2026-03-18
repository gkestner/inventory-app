"use client";

import { upload } from "@vercel/blob/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PDFDocument } from "pdf-lib";

type Props = {
  userId: string;
  allowedUsers: Array<{ id: string; name: string | null; email: string }>;
  locationsByUserId: Record<string, Array<{ id: string; name: string }>>;
};

type FileWithDate = {
  file: File;
  date: string; // YYYY-MM-DD
  amount: string; // dollar amount
  locationId: string;
};

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function baseName(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  if (i <= 0) return fileName;
  return fileName.slice(0, i);
}

async function splitPdfToPages(file: File): Promise<File[]> {
  const bytes = await file.arrayBuffer();
  const source = await PDFDocument.load(bytes);
  const pageCount = source.getPageCount();
  const out: File[] = [];

  for (let i = 0; i < pageCount; i++) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(source, [i]);
    doc.addPage(page);
    const pageBytes = await doc.save();
    const pageBytesCopy = new Uint8Array(pageBytes.byteLength);
    pageBytesCopy.set(pageBytes);
    const name = `${baseName(file.name)}-p${i + 1}.pdf`;
    out.push(new File([pageBytesCopy], name, { type: "application/pdf" }));
  }

  return out;
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Upload failed.";
}

export default function BulkHistoricalReceiptUploader({
  userId: initialUserId,
  allowedUsers,
  locationsByUserId,
}: Props) {
  const router = useRouter();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [selectedFiles, setSelectedFiles] = useState<FileWithDate[]>([]);
  const [selectedUserId, setSelectedUserId] = useState(initialUserId);
  const [splitPdfPages, setSplitPdfPages] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const todayIso = new Intl.DateTimeFormat("en-CA").format(new Date());
  const currentUserLocations = useMemo(
    () => locationsByUserId[selectedUserId] ?? [],
    [locationsByUserId, selectedUserId]
  );
  const defaultLocationId = currentUserLocations[0]?.id ?? "";

  useEffect(() => {
    if (selectedFiles.length === 0) return;
    const allowed = new Set(currentUserLocations.map((l) => l.id));
    setSelectedFiles((prev) =>
      prev.map((item) => ({
        ...item,
        locationId: allowed.has(item.locationId) ? item.locationId : defaultLocationId,
      }))
    );
  }, [currentUserLocations, defaultLocationId, selectedFiles.length]);

  async function handleFilesSelected(files: FileList | null) {
    if (!files) return;

    const newFiles: FileWithDate[] = [];
    let splitSourceCount = 0;
    let splitOutputCount = 0;
    let splitFailedCount = 0;

    setPreparing(true);
    setMessage("");

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file) {
        if (splitPdfPages && isPdf(file)) {
          try {
            const pages = await splitPdfToPages(file);
            splitSourceCount += 1;
            splitOutputCount += pages.length;
            for (const p of pages) {
              newFiles.push({
                file: p,
                date: todayIso,
                amount: "",
                locationId: defaultLocationId,
              });
            }
          } catch {
            splitFailedCount += 1;
            newFiles.push({
              file,
              date: todayIso,
              amount: "",
              locationId: defaultLocationId,
            });
          }
        } else {
          newFiles.push({
            file,
            date: todayIso,
            amount: "",
            locationId: defaultLocationId,
          });
        }
      }
    }

    setSelectedFiles((prev) => [...prev, ...newFiles]);

    if (splitSourceCount > 0) {
      const failMsg = splitFailedCount > 0 ? ` (${splitFailedCount} PDF could not be split)` : "";
      setMessage(`Split ${splitSourceCount} PDF into ${splitOutputCount} receipt page file(s)${failMsg}.`);
    }

    setPreparing(false);
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

  function updateFileLocation(index: number, locationId: string) {
    const updated = [...selectedFiles];
    updated[index].locationId = locationId;
    setSelectedFiles(updated);
  }

  async function uploadBatch() {
    if (!selectedUserId) {
      setMessage("Please select a user.");
      return;
    }
    if (selectedFiles.length === 0) {
      setMessage("Please select files to upload.");
      return;
    }
    if (currentUserLocations.length === 0) {
      setMessage("Selected user has no active receipt-enabled locations.");
      return;
    }
    if (selectedFiles.some((f) => !f.locationId)) {
      setMessage("Please select a location for each file.");
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
          files: selectedFiles.map((f) => ({
            name: f.file.name,
            date: f.date,
            amount: f.amount ? Math.round(parseFloat(f.amount) * 100) : 0,
            size: f.file.size,
            type: f.file.type,
            locationId: f.locationId,
          })),
        }),
      });

      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        receiptIds?: string[];
        uploadUrls?: Array<{ storageKey: string; receiptId: string; index: number }>;
      };

      if (!response.ok || !result.uploadUrls) {
        throw new Error(result.error || "Failed to initialize bulk upload.");
      }

      const successfulUploads: Array<{
        receiptId: string;
        index: number;
        fileName: string;
        fileSize: number;
        contentType: string;
        storageKey: string;
        url: string;
      }> = [];

      // Upload each file to Vercel Blob
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i].file;
        const uploadInfo = result.uploadUrls.find((u) => u.index === i);

        if (!uploadInfo) {
          setMessage(`Error uploading ${file.name}: Upload URL not found.`);
          continue;
        }

        try {
          const blob = await upload(uploadInfo.storageKey, file, {
            access: "public",
            handleUploadUrl: "/api/maintenance/receipts/blob-upload",
            contentType: file.type || "application/octet-stream",
          });

          successfulUploads.push({
            receiptId: uploadInfo.receiptId,
            index: i,
            fileName: file.name,
            fileSize: file.size,
            contentType: file.type || "application/octet-stream",
            storageKey: blob.pathname || uploadInfo.storageKey,
            url: blob.url,
          });
        } catch {
          setMessage(`Error uploading ${file.name}.`);
          continue;
        }
      }

      if (successfulUploads.length === 0) {
        throw new Error("No files were uploaded.");
      }

      // Finalize all uploads
      const finalizeRes = await fetch("/api/maintenance/receipts/bulk-upload-finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploads: successfulUploads,
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
        </div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          Select location per file. Locations are filtered to the selected user's receipt-enabled assignments.
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy && !preparing) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (busy || preparing) return;
            void handleFilesSelected(e.dataTransfer.files);
          }}
          onClick={() => {
            if (!busy && !preparing) uploadInputRef.current?.click();
          }}
          style={{
            border: `2px dashed ${dragOver ? "var(--brand)" : "rgba(128,128,128,0.35)"}`,
            borderRadius: 12,
            padding: "12px",
            background: dragOver ? "color-mix(in srgb, var(--brand) 10%, transparent)" : "var(--background)",
            cursor: busy || preparing ? "not-allowed" : "pointer",
            opacity: busy || preparing ? 0.7 : 1,
            display: "grid",
            gap: 6,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 14 }}>
            {preparing ? "Preparing files..." : "Drag and drop receipt files here"}
          </div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            Or click to browse files from your computer/email downloads.
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
          <input
            type="checkbox"
            checked={splitPdfPages}
            onChange={(e) => setSplitPdfPages(e.target.checked)}
            disabled={busy || preparing}
          />
          Split PDF into one receipt per page (recommended for ScanSnap bundles)
        </label>
        <input
          ref={uploadInputRef}
          type="file"
          multiple
          disabled={busy || preparing}
          onChange={(e) => {
            void handleFilesSelected(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
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
                gridTemplateColumns: "2fr 1fr 1.3fr 1.2fr auto",
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
              <div>Location</div>
              <div>Amount ($)</div>
              <div></div>
            </div>

            {selectedFiles.map((item, idx) => (
              <div
                key={idx}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1.3fr 1.2fr auto",
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
                <select
                  value={item.locationId}
                  onChange={(e) => updateFileLocation(idx, e.target.value)}
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
                >
                  <option value="">Select location</option>
                  {currentUserLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
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
            disabled={busy || preparing}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--brand)",
              color: "white",
              fontWeight: 800,
              cursor: busy || preparing ? "not-allowed" : "pointer",
            }}
          >
            {busy
              ? "Uploading..."
              : preparing
              ? "Preparing files..."
              : `Upload ${selectedFiles.length} Historical Receipt${selectedFiles.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}

      <div style={{ fontSize: 12, opacity: 0.85 }}>
        Max file size per file: 25MB. Each file will create a separate receipt entry with the date and amount you specify. If split is enabled, each PDF page becomes its own receipt file.
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
