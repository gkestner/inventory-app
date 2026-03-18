"use client";

import { useMemo, useRef, useState } from "react";

type Props = {
  disabled?: boolean;
  inputName?: string;
};

export default function ReceiptDropzone({ disabled = false, inputName = "receiptFiles" }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const label = useMemo(() => {
    if (files.length === 0) return "Drag files from email/computer here, or click to choose";
    if (files.length === 1) return files[0]?.name ?? "1 file selected";
    return `${files.length} files selected`;
  }, [files]);

  function updateFiles(list: FileList | null) {
    if (!list) {
      setFiles([]);
      return;
    }
    setFiles(Array.from(list));
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (disabled) return;
    setDragOver(false);

    const dropped = e.dataTransfer.files;
    if (!dropped || dropped.length === 0) return;

    const dt = new DataTransfer();
    for (const file of Array.from(dropped)) dt.items.add(file);

    if (inputRef.current) {
      inputRef.current.files = dt.files;
      updateFiles(dt.files);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 900 }}>Receipt Files (optional)</div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => {
          if (!disabled) inputRef.current?.click();
        }}
        style={{
          border: `2px dashed ${dragOver ? "var(--brand)" : "rgba(128,128,128,0.35)"}`,
          borderRadius: 12,
          padding: "14px 12px",
          cursor: disabled ? "not-allowed" : "pointer",
          background: dragOver ? "color-mix(in srgb, var(--brand) 10%, transparent)" : "var(--background)",
          opacity: disabled ? 0.65 : 1,
        }}
      >
        <input
          ref={inputRef}
          type="file"
          name={inputName}
          multiple
          disabled={disabled}
          onChange={(e) => updateFiles(e.currentTarget.files)}
          style={{ display: "none" }}
        />
        <div style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>
        <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>Accepted: images, PDFs, and common documents. Max 25MB per file.</div>
      </div>
      {files.length > 0 ? (
        <div style={{ display: "grid", gap: 4, fontSize: 12, opacity: 0.9 }}>
          {files.map((f) => (
            <div key={`${f.name}-${f.size}`}>{f.name}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
