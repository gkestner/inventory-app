"use client";

import { useFormStatus } from "react-dom";

export default function UnignoreAllButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  const disabled = pending || count === 0;

  return (
    <button
      type="submit"
      disabled={disabled}
      aria-busy={pending}
      title="Clear Ignore for all items, regardless of the current search or filters"
      style={{
        padding: "10px 14px",
        borderRadius: 12,
        border: "1px solid rgba(45,212,191,0.55)",
        background: "rgba(45,212,191,0.12)",
        color: "var(--foreground)",
        fontWeight: 900,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {pending ? "Restoring items..." : `Unignore All (${count})`}
    </button>
  );
}
