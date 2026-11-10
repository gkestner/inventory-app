"use client";

import { useFormStatus } from "react-dom";

export default function PendingButton({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={className} disabled={pending}>{pending ? "Saving…" : children}</button>;
}
