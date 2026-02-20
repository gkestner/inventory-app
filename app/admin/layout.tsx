// app/admin/layout.tsx
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: ReactNode }) {
  // Global nav + preview banner render in app/layout.tsx.
  // Keep admin layout as a pass-through to avoid duplicated navigation/headers.
  return <>{children}</>;
}
