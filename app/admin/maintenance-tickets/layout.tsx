// app/maintenance/layout.tsx
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function MaintenanceLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Global navigation + preview mode handled in app/layout.tsx
  // This layout must NOT render any nav or wrappers.
  // It exists only for route grouping and future maintenance-specific logic.

  return <>{children}</>;
}
