import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import ScannerCountUntouchedReportClient from "@/app/admin/reports/scanner-count-untouched/ScannerCountUntouchedReportClient";

export const dynamic = "force-dynamic";

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

async function requireReportAccess() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS])) {
    redirect("/");
  }
}

export default async function ScannerCountUntouchedReportPage() {
  await requireReportAccess();

  const border = "1px solid var(--border)";

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", display: "grid", gap: 12 }}>
        <section
          style={{
            border,
            borderRadius: 14,
            background: "linear-gradient(150deg, color-mix(in srgb, var(--brand) 14%, var(--surface)) 0%, var(--surface) 70%)",
            boxShadow: "var(--shadow)",
            padding: 16,
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Scanner Count Untouched Parts</h1>
            <Link href="/admin/reports" style={{ textDecoration: "none", fontWeight: 800 }}>
              Back to Reports
            </Link>
            <Link href="/maintenance/scanner-count" style={{ textDecoration: "none", fontWeight: 800 }}>
              Open Scanner Count
            </Link>
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.5 }}>
            Review which parts you have not looked up or updated from the scanner count workflow, then reset the tracking window when you want to start the next pass.
          </p>
        </section>

        <ScannerCountUntouchedReportClient />
      </div>
    </main>
  );
}