import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";

import { authOptions } from "@/app/lib/auth";
import SettingsPanel from "@/app/settings/SettingsPanel";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 860, margin: "0 auto", display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>Account Settings</h1>
          <Link href="/" style={{ textDecoration: "underline" }}>
            Back
          </Link>
        </div>

        <p style={{ margin: 0, opacity: 0.8 }}>
          Manage your personal preferences for appearance, printing, and overall app behavior.
        </p>

        <SettingsPanel />
      </div>
    </main>
  );
}
