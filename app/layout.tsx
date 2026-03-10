// app/layout.tsx
import type { Metadata } from "next";
import { JetBrains_Mono, Sora } from "next/font/google";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import "./globals.css";

import AdminNav from "@/app/admin/components/AdminNav";
import NotificationSoundClient from "@/app/components/NotificationSoundClient";
import PwaRegisterClient from "@/app/components/PwaRegisterClient";
import UserNav from "@/app/components/UserNav";
import { ADMIN_ENTRY_PERMISSIONS } from "@/app/lib/admin-access";
import type { LoadedPermissions } from "@/app/lib/permissions";
import {
  ADMIN_VIEW_TEMPERATURE_DASHBOARD,
  CREATE_RECEIPTS,
  VIEW_COMPANY_VEHICLE_LOG,
  VIEW_EQUIPMENT_TRACKING,
  VIEW_MAINTENANCE_REQUESTS,
  VIEW_PREVENTATIVE_MAINTENANCE,
  VIEW_RECEIPTS,
  VIEW_TEMPERATURE_DASHBOARD,
} from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

const soraSans = Sora({
  variable: "--font-sora-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Inventory App",
  description: "Internal inventory/admin system",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Inventory",
  },
};

type PreviewRole = "ADMIN" | "USER";

const DEMO_MODE_COOKIE = "admin_demo_mode";

function parsePreviewCookie(v: string | undefined | null, isAdmin: boolean): PreviewRole | null {
  if (!isAdmin) return null;
  const s = (v ?? "").trim().toLowerCase();
  if (s === "user" || s === "employee") return "USER";
  if (s === "admin") return "ADMIN";
  return null;
}

function parseDemoModeCookie(v: string | undefined | null, canUseDemo: boolean): boolean {
  if (!canUseDemo) return false;
  const s = (v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
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
  // ✅ During `next build`, Next may try to collect page data for special routes (e.g. /_not-found).
  // If auth/prisma modules are imported/evaluated, they can crash the build (env/DB not ready).
  // So we short-circuit the build phase with a minimal layout shell.
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) {
    return (
      <html lang="en">
        <body className={`${soraSans.variable} ${jetbrainsMono.variable} app-body antialiased`}>{children}</body>
      </html>
    );
  }

  // Import auth/permissions lazily so module evaluation during build phase doesn't touch Prisma.
  const [{ getServerSession }, { authOptions }, permsMod, prismaEnums, prismaModule, prefsModule] = await Promise.all([
    import("next-auth"),
    import("@/app/lib/auth"),
    import("@/app/lib/permissions"),
    import("@prisma/client"),
    import("@/app/lib/prisma"),
    import("@/app/lib/user-preferences"),
  ]);

  const { hasAnyPermission, loadUserPermissions } = permsMod;
  const { DEFAULT_USER_PREFERENCES, normalizeUserPreferences } = prefsModule;
  const { Permission, Role } = prismaEnums;
  const { prisma } = prismaModule;

  const fallbackPerms: LoadedPermissions = {
    userId: null,
    role: null,
    isAdmin: false,
    allowAll: false,
    permissions: new Set() as LoadedPermissions["permissions"],
  };

  let session: { user?: { role?: unknown; email?: string | null } | null } | null = null;
  let perms = fallbackPerms;
  let isAdmin = false;
  let canUsePreview = false;
  let serverPrefs = DEFAULT_USER_PREFERENCES;

  try {
    session = await getServerSession(authOptions);

    const sessionRole = (session?.user as unknown as { role?: unknown })?.role;
    const sessionEmail = (session?.user as { email?: string | null } | null)?.email?.trim().toLowerCase() ?? "";

    const dbUser =
      sessionEmail.length > 0
        ? (
            await prisma.user.findUnique({
              where: { email: sessionEmail },
              select: { role: true, uiPreferences: true },
            })
          ) ?? null
        : null;

    const dbUserRole = dbUser?.role ?? null;
    serverPrefs = normalizeUserPreferences(dbUser?.uiPreferences ?? DEFAULT_USER_PREFERENCES);

    const effectiveRole = sessionRole ?? dbUserRole;
    const isRoleAdmin = effectiveRole === Role.ADMIN || effectiveRole === "ADMIN";

    // Load per-user permissions server-side (single source of truth)
    perms = await loadUserPermissions(session);

    const hasAdminPermission = perms.allowAll || hasAnyPermission(perms, ADMIN_ENTRY_PERMISSIONS);

    isAdmin = isRoleAdmin || hasAdminPermission;
    canUsePreview = !!perms.allowAll;
  } catch (error) {
    // Prevent auth/DB boot failures from taking down the entire app shell.
    console.error("RootLayout bootstrap error:", error);
  }

  const serverPrefsJson = JSON.stringify(serverPrefs);

  // Cookie-backed preview (Admin-only). In your Next 16 runtime, cookies()/headers() are awaited.
  const jar = await cookies();
  const previewCookie = jar.get("preview_view")?.value ?? null;
  const preview = parsePreviewCookie(previewCookie, canUsePreview);
  const demoMode = parseDemoModeCookie(jar.get(DEMO_MODE_COOKIE)?.value ?? null, canUsePreview);

  async function setPreviewAction(formData: FormData) {
    "use server";

    try {
      const [{ getServerSession }, { authOptions }, permsMod] = await Promise.all([
        import("next-auth"),
        import("@/app/lib/auth"),
        import("@/app/lib/permissions"),
      ]);

      const { hasAnyPermission, loadUserPermissions } = permsMod;
      const { Permission } = await import("@prisma/client");

      const s = await getServerSession(authOptions);
      const p = await loadUserPermissions(s);
      const admin = p.allowAll;
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
    } catch (error) {
      console.error("setPreviewAction error:", error);
      redirect("/");
    }
  }

  async function setDemoModeAction(formData: FormData) {
    "use server";

    try {
      const [{ getServerSession }, { authOptions }, permsMod] = await Promise.all([
        import("next-auth"),
        import("@/app/lib/auth"),
        import("@/app/lib/permissions"),
      ]);

      const { loadUserPermissions } = permsMod;

      const s = await getServerSession(authOptions);
      const p = await loadUserPermissions(s);
      if (!p.allowAll) redirect("/");

      const next = String(formData.get("demoMode") ?? "").trim().toLowerCase();
      const j = await cookies();

      if (next === "on" || next === "1" || next === "true") {
        j.set(DEMO_MODE_COOKIE, "1", { path: "/", sameSite: "lax" });
      } else {
        j.delete(DEMO_MODE_COOKIE);
      }

      const h = await headers();
      redirect(safeReturnToPathFromReferer(h.get("referer")));
    } catch (error) {
      console.error("setDemoModeAction error:", error);
      redirect("/");
    }
  }

  // Preview only swaps navigation. Permissions do NOT change.
  const showAdminNav = isAdmin && (preview === null || preview === "ADMIN");
  const showUserNav = !isAdmin || preview === "USER";

  // ✅ Minimal layout-level gating hook (nav-level links are gated inside nav components)
  const hasAnyUserNavPermission =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_HOME,
      Permission.VIEW_CHECKOUT,
      Permission.VIEW_WORK_ORDERS,
      Permission.VIEW_LIVE_ORDERS,
      VIEW_PREVENTATIVE_MAINTENANCE,
      VIEW_EQUIPMENT_TRACKING,
      VIEW_COMPANY_VEHICLE_LOG,
      VIEW_MAINTENANCE_REQUESTS,
      VIEW_TEMPERATURE_DASHBOARD,
      ADMIN_VIEW_TEMPERATURE_DASHBOARD,
      VIEW_RECEIPTS,
      CREATE_RECEIPTS,
    ]);

  const shouldRenderUserNav = showUserNav && hasAnyUserNavPermission;

  const border = "1px solid rgba(128,128,128,0.25)";
  const bg = "var(--card, var(--background))";
  const fg = "var(--text)";

  return (
    <html lang="en">
      <body className={`${soraSans.variable} ${jetbrainsMono.variable} app-body antialiased`}>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var serverPrefs = ${serverPrefsJson};

                  var themeMode = (serverPrefs && serverPrefs.theme) || localStorage.getItem("theme") || "system";
                  var density = (serverPrefs && serverPrefs.density) || localStorage.getItem("ui_density") || "comfortable";
                  var reduceMotion =
                    (serverPrefs && typeof serverPrefs.reducedMotion === "boolean")
                      ? serverPrefs.reducedMotion
                      : localStorage.getItem("ui_reduce_motion") === "1";

                  if (serverPrefs) {
                    localStorage.setItem("theme", themeMode);
                    localStorage.setItem("ui_density", density);
                    localStorage.setItem("ui_reduce_motion", reduceMotion ? "1" : "0");
                    if (typeof serverPrefs.labelsDefaultCopies === "number") {
                      localStorage.setItem("labels_default_copies", String(serverPrefs.labelsDefaultCopies));
                    }
                    localStorage.setItem("labels_autoprint", serverPrefs.labelsAutoprint ? "1" : "0");
                    localStorage.setItem("labels_autoclose", serverPrefs.labelsAutoclose ? "1" : "0");
                  }

                  var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
                  var resolvedTheme = themeMode === "system" ? (prefersDark ? "dark" : "light") : themeMode;

                  document.documentElement.dataset.theme = resolvedTheme;
                  document.documentElement.style.colorScheme = resolvedTheme;
                  document.documentElement.dataset.density = density === "compact" ? "compact" : "comfortable";
                  document.documentElement.dataset.reducedMotion = reduceMotion ? "true" : "false";
                } catch (e) {
                  // no-op
                }
              })();
            `,
          }}
        />

        {/* Admin-only preview controls (single source of truth; do NOT duplicate in AdminNav/UserNav) */}
        {canUsePreview ? (
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

            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                padding: "4px 8px",
                borderRadius: 999,
                border,
                background: demoMode ? "rgba(251,191,36,0.25)" : "rgba(16,185,129,0.16)",
              }}
            >
              Demo Mode: {demoMode ? "ON (writes blocked)" : "OFF"}
            </div>

            <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
              <form action={setDemoModeAction}>
                <input type="hidden" name="demoMode" value={demoMode ? "off" : "on"} />
                <button
                  type="submit"
                  style={{
                    padding: "6px 10px",
                    borderRadius: 10,
                    border,
                    background: demoMode ? "rgba(251,191,36,0.24)" : bg,
                    color: fg,
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                  title="Toggle safe demo mode (no database writes)"
                >
                  {demoMode ? "Disable Demo Mode" : "Enable Demo Mode"}
                </button>
              </form>

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

        {demoMode ? (
          <div
            style={{
              position: "sticky",
              top: canUsePreview ? 50 : 0,
              zIndex: 55,
              borderBottom: border,
              background: "rgba(251,191,36,0.22)",
              color: fg,
              padding: "8px 12px",
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            DEMO MODE ACTIVE: Writes are simulated for this browser session. Invoices, inventory, and other records are
            not persisted.
          </div>
        ) : null}

        {showAdminNav ? <AdminNav /> : null}
        {shouldRenderUserNav ? <UserNav /> : null}
        <PwaRegisterClient />
        <NotificationSoundClient />

        <div className="app-content-shell">{children}</div>
      </body>
    </html>
  );
}
