// app/layout.tsx
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import "./globals.css";

import { authOptions } from "@/app/lib/auth";
import AdminNav from "@/app/admin/components/AdminNav";
import UserNav from "@/app/components/UserNav";
import { Permission, Role } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Inventory App",
  description: "Internal inventory/admin system",
};

type PreviewRole = "ADMIN" | "USER";

function parsePreviewCookie(v: string | undefined | null, isAdmin: boolean): PreviewRole | null {
  if (!isAdmin) return null;
  const s = (v ?? "").trim().toLowerCase();
  if (s === "user" || s === "employee") return "USER";
  if (s === "admin") return "ADMIN";
  return null;
}

function safeReturnToPathFromReferer(referer: string | null): string {
  if (!referer) return "/";
  try {
    const u = new URL(referer);
    const path = `${u.pathname}${u.search}`;
    return path.startsWith("/") ? path : "/";
  } catch {
    return "/";
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession(authOptions);

  const role = (session?.user as unknown as { role?: unknown })?.role;
  const isAdmin = role === Role.ADMIN || role === "ADMIN";

  // ✅ Load per-user permissions server-side (single source of truth)
  // - Admin treated as allow-all (handled inside loadUserPermissions, and also by role check above)
  const perms = await loadUserPermissions(session);

  // Cookie-backed preview (Admin-only). In your Next 16 runtime, cookies()/headers() are awaited.
  const jar = await cookies();
  const previewCookie = jar.get("preview_view")?.value ?? null;
  const preview = parsePreviewCookie(previewCookie, isAdmin);

  async function setPreviewAction(formData: FormData) {
    "use server";

    const s = await getServerSession(authOptions);
    const r = (s?.user as unknown as { role?: unknown })?.role;
    const admin = r === Role.ADMIN || r === "ADMIN";
    if (!admin) redirect("/");

    const next = String(formData.get("preview") ?? "").trim().toLowerCase();

    const j = await cookies();

    if (next === "user" || next === "employee") {
      j.set("preview_view", "user", { path: "/", sameSite: "lax" });
    } else if (next === "admin") {
      j.set("preview_view", "admin", { path: "/", sameSite: "lax" });
    } else if (next === "off" || next === "clear") {
      j.delete("preview_view");
    }

    const h = await headers();
    redirect(safeReturnToPathFromReferer(h.get("referer")));
  }

  // Preview only swaps navigation. Permissions do NOT change.
  const showAdminNav = isAdmin && (preview === null || preview === "ADMIN");
  const showUserNav = !isAdmin || preview === "USER";

  // ✅ Minimal layout-level gating hook (nav-level links are gated inside nav components)
  // If a non-admin has *zero* user-facing view permissions, hide UserNav entirely (prevents misleading nav).
  const hasAnyUserNavPermission =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_HOME,
      Permission.VIEW_CHECKOUT,
      Permission.VIEW_WORK_ORDERS,
    ]);

  const shouldRenderUserNav = showUserNav && hasAnyUserNavPermission;

  const border = "1px solid rgba(128,128,128,0.25)";
  const bg = "var(--card, var(--background))";
  const fg = "var(--text)";

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* Admin-only preview controls (single source of truth; do NOT duplicate in AdminNav/UserNav) */}
        {isAdmin ? (
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 60,
              borderBottom: border,
              background: bg,
              color: fg,
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 900 }}>
              Preview Mode:{" "}
              <span style={{ textDecoration: "underline" }}>{preview === "USER" ? "USER" : "ADMIN"}</span> (UI-only)
            </div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Permissions unchanged. This only swaps navigation.</div>

            <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
              <form action={setPreviewAction}>
                <input type="hidden" name="preview" value="admin" />
                <button
                  type="submit"
                  style={{
                    padding: "6px 10px",
                    borderRadius: 10,
                    border,
                    background: bg,
                    color: fg,
                    fontWeight: 900,
                    cursor: "pointer",
                    opacity: preview === "ADMIN" || preview === null ? 1 : 0.85,
                  }}
                  title="Show AdminNav (default)"
                >
                  View as Admin
                </button>
              </form>

              <form action={setPreviewAction}>
                <input type="hidden" name="preview" value="user" />
                <button
                  type="submit"
                  style={{
                    padding: "6px 10px",
                    borderRadius: 10,
                    border,
                    background: bg,
                    color: fg,
                    fontWeight: 900,
                    cursor: "pointer",
                    opacity: preview === "USER" ? 1 : 0.85,
                  }}
                  title="Swap to UserNav (UI-only)"
                >
                  View as User
                </button>
              </form>

              <form action={setPreviewAction}>
                <input type="hidden" name="preview" value="off" />
                <button
                  type="submit"
                  style={{
                    padding: "6px 10px",
                    borderRadius: 10,
                    border,
                    background: bg,
                    color: fg,
                    fontWeight: 900,
                    cursor: "pointer",
                    opacity: preview === null ? 0.6 : 0.85,
                  }}
                  title="Clear preview cookie"
                >
                  Clear
                </button>
              </form>
            </div>
          </div>
        ) : null}

        {showAdminNav ? <AdminNav /> : null}
        {shouldRenderUserNav ? <UserNav /> : null}

        {children}
      </body>
    </html>
  );
}
