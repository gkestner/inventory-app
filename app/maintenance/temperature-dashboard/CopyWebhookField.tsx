"use client";

import { useState } from "react";

type Props = {
  webhookUrl: string;
};

export default function CopyWebhookField({ webhookUrl }: Props) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          readOnly
          value={webhookUrl}
          style={{
            flex: "1 1 480px",
            minWidth: 260,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--foreground)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: 12,
          }}
        />
        <button
          type="button"
          onClick={onCopy}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface-2)",
            color: "var(--foreground)",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          {copied ? "Copied" : "Copy URL"}
        </button>
      </div>
    </div>
  );
}
