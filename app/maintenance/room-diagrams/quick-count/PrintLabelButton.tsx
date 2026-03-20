"use client";

import type { CSSProperties } from "react";

export default function PrintLabelButton({ itemId }: { itemId: string }) {
  const handlePrint = () => {
    const width = 800;
    const height = 600;
    const left = (window.innerWidth - width) / 2 + window.screenLeft;
    const top = (window.innerHeight - height) / 2 + window.screenTop;
    window.open(
      `/admin/items/labels?ids=${itemId}&autoprint=1&autoclose=1`,
      "labels-print-popup",
      `width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)}`
    );
  };

  const style: CSSProperties = {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--surface-2)",
    color: "var(--foreground)",
    fontWeight: 800,
    cursor: "pointer",
    fontSize: 13,
    textDecoration: "none",
  };

  return (
    <button onClick={handlePrint} style={style}>
      Print
    </button>
  );
}
