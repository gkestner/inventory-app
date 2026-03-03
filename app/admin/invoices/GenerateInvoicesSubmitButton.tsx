"use client";

import { useFormStatus } from "react-dom";
import type { CSSProperties } from "react";

type Props = {
  style: CSSProperties;
};

export default function GenerateInvoicesSubmitButton({ style }: Props) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" style={style} disabled={pending} aria-busy={pending}>
      {pending ? "Generating invoices..." : "Generate invoices for window"}
    </button>
  );
}