"use client";

import { useFormStatus } from "react-dom";

export default function DismissFlagButton({ description }: { description: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      aria-label={`Dismiss flag ${description}`}
      title="Dismiss only this request. A new order-more flag for this item can still appear."
      style={{ padding: "4px 8px", borderRadius: 8, border: "1px solid rgba(219,39,119,0.55)", background: "var(--background)", color: "var(--foreground)", fontWeight: 800, whiteSpace: "nowrap", cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1 }}
    >
      {pending ? "Dismissing..." : "Dismiss Flag"}
    </button>
  );
}
