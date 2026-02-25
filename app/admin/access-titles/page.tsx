// app/admin/access-titles/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Permission, Role } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

async function requireAdmin() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");
  const role = session.user?.role ?? null;
  if (role !== Role.ADMIN) redirect("/");
}

function nonEmpty(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

function NotReadyPanel({ title, details }: { title: string; details: string[] }) {
  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto", color: fg }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Admin: Access Titles</h1>
          <Link
            href="/admin/users"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border,
              background: surface,
              color: fg,
              textDecoration: "none",
              fontWeight: 900,
            }}
          >
            ← Users
          </Link>
        </div>

        <div style={{ marginTop: 12, padding: 14, borderRadius: 14, border, background: surface }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>{title}</div>
          <ul style={{ margin: 0, paddingLeft: 18, opacity: 0.9, lineHeight: 1.5 }}>
            {details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}

function isPermissionValue(v: unknown): v is Permission {
  return typeof v === "string" && (Object.values(Permission) as string[]).includes(v);
}

function safePermissionsFromFormData(fd: FormData, key: string): Permission[] {
  const vals = fd.getAll(key).map((x) => String(x).trim());
  const out: Permission[] = [];
  const seen = new Set<string>();
  for (const v of vals) {
    if (!v) continue;
    if (seen.has(v)) continue;
    if (isPermissionValue(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function splitUnderscoreLabel(s: string) {
  const parts = s.split("_").filter(Boolean);
  return parts.map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
}

function permLabel(p: Permission): string {
  return splitUnderscoreLabel(String(p));
}

type PermGroup = {
  key: string;
  title: string;
  subtitle?: string;
  permissions: Permission[];
};

function buildPermissionGroups(all: Permission[]): PermGroup[] {
  const byPrefix = (prefix: string) => all.filter((p) => String(p).startsWith(prefix));

  const groups: PermGroup[] = [];

  const nav = byPrefix("VIEW_");
  if (nav.length) {
    groups.push({
      key: "NAV",
      title: "App Navigation",
      subtitle: "Controls what modules the user can see",
      permissions: nav.sort(),
    });
  }

  const checkout = all.filter((p) => String(p).includes("CHECKOUT"));
  if (checkout.length) {
    groups.push({
      key: "CHECKOUT",
      title: "Checkout",
      subtitle: "Parts checkout permissions",
      permissions: checkout.sort(),
    });
  }

  const workOrders = all.filter((p) => String(p).includes("WORK_ORDERS"));
  if (workOrders.length) {
    groups.push({
      key: "WORK_ORDERS",
      title: "Work Orders",
      subtitle: "Create/update/submit work orders",
      permissions: workOrders.sort(),
    });
  }

  const adminItems = byPrefix("ADMIN_").filter((p) => String(p).includes("_ITEMS"));
  if (adminItems.length) {
    groups.push({
      key: "ADMIN_ITEMS",
      title: "Admin: Items",
      subtitle: "Catalog and pricing permissions",
      permissions: adminItems.sort(),
    });
  }

  const adminUsers = byPrefix("ADMIN_").filter((p) => String(p).includes("_USERS"));
  if (adminUsers.length) {
    groups.push({
      key: "ADMIN_USERS",
      title: "Admin: Users",
      subtitle: "User management permissions",
      permissions: adminUsers.sort(),
    });
  }

  const adminLocations = byPrefix("ADMIN_").filter((p) => String(p).includes("_LOCATIONS"));
  if (adminLocations.length) {
    groups.push({
      key: "ADMIN_LOCATIONS",
      title: "Admin: Locations",
      subtitle: "Location setup permissions",
      permissions: adminLocations.sort(),
    });
  }

  const adminWorkOrders = byPrefix("ADMIN_").filter((p) => String(p).includes("_WORK_ORDERS"));
  if (adminWorkOrders.length) {
    groups.push({
      key: "ADMIN_WORK_ORDERS",
      title: "Admin: Work Orders",
      subtitle: "Override / edit / delete work orders",
      permissions: adminWorkOrders.sort(),
    });
  }

  const tickets = all.filter((p) => String(p).includes("MAINTENANCE_TICKETS"));
  if (tickets.length) {
    groups.push({
      key: "TICKETS",
      title: "Maintenance Tickets",
      subtitle: "View/export maintenance tickets",
      permissions: tickets.sort(),
    });
  }

  const covered = new Set(groups.flatMap((g) => g.permissions));
  const other = all.filter((p) => !covered.has(p));
  if (other.length) {
    groups.push({
      key: "OTHER",
      title: "Other",
      permissions: other.sort(),
    });
  }

  return groups;
}

type PageProps = {
  searchParams?: {
    titleId?: string;
    group?: string;
  };
};

export default async function AdminAccessTitlesPage({ searchParams }: PageProps) {
  await requireAdmin();

  try {
    await prisma.permissionTitle.count();
  } catch {
    return (
      <NotReadyPanel
        title="Database tables not ready"
        details={[
          "Your app can compile, but the database is missing the Permission Title tables/columns.",
          "Fix: run `npx prisma migrate deploy` against Neon, then redeploy.",
        ]}
      />
    );
  }

  async function createTitleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const name = nonEmpty(formData.get("name"));
    const description = nonEmpty(formData.get("description")) || null;

    if (!name) redirect("/admin/access-titles");

    const created = await prisma.permissionTitle.create({
      data: { name, description, active: true },
      select: { id: true },
    });

    revalidatePath("/admin/access-titles");
    redirect(`/admin/access-titles?titleId=${encodeURIComponent(created.id)}&group=ALL`);
  }

  async function updateTitleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = nonEmpty(formData.get("id"));
    const name = nonEmpty(formData.get("name"));
    const description = nonEmpty(formData.get("description")) || null;

    if (!id || !name) redirect("/admin/access-titles");

    await prisma.permissionTitle.update({
      where: { id },
      data: { name, description },
    });

    revalidatePath("/admin/access-titles");
    redirect(`/admin/access-titles?titleId=${encodeURIComponent(id)}&group=ALL`);
  }

  async function updatePermissionsAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const titleId = nonEmpty(formData.get("id"));
    const group = nonEmpty(formData.get("group")) || "ALL";
    if (!titleId) redirect("/admin/access-titles");

    const selected = safePermissionsFromFormData(formData, "permissions");

    await prisma.$transaction(async (tx) => {
      await tx.permissionTitlePermission.deleteMany({ where: { titleId } });

      if (selected.length > 0) {
        await tx.permissionTitlePermission.createMany({
          data: selected.map((permission) => ({ titleId, permission })),
          skipDuplicates: true,
        });
      }
    });

    revalidatePath("/admin/access-titles");
    redirect(`/admin/access-titles?titleId=${encodeURIComponent(titleId)}&group=${encodeURIComponent(group || "ALL")}`);
  }

  async function deleteTitleAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = nonEmpty(formData.get("id"));
    if (!id) redirect("/admin/access-titles");

    await prisma.permissionTitle.delete({ where: { id } });

    revalidatePath("/admin/access-titles");
    redirect("/admin/access-titles");
  }

  const titles = await prisma.permissionTitle.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, description: true, active: true },
  });

  if (titles.length === 0) {
    const border = "1px solid rgba(128,128,128,0.25)";
    const surface = "var(--background)";
    const fg = "var(--foreground)";
    const card: CSSProperties = { border, borderRadius: 14, background: surface, padding: 12 };
    const label: CSSProperties = { display: "grid", gap: 6, fontSize: 12, opacity: 0.9, fontWeight: 900 };
    const input: CSSProperties = {
      width: "100%",
      boxSizing: "border-box",
      padding: "10px 12px",
      borderRadius: 12,
      border,
      background: surface,
      color: fg,
      outline: "none",
      fontSize: 14,
    };
    const btn: CSSProperties = {
      padding: "10px 14px",
      borderRadius: 12,
      border,
      background: "rgba(33,150,243,0.18)",
      color: fg,
      fontWeight: 900,
      cursor: "pointer",
      lineHeight: 1,
      whiteSpace: "nowrap",
    };

    return (
      <main style={{ padding: 16 }}>
        <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto", color: fg }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Admin: Access Titles</h1>
            <Link
              href="/admin/users"
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border,
                background: surface,
                color: fg,
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              ← Users
            </Link>
          </div>

          <div style={{ marginTop: 12, ...card }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Create your first title</div>
            <form action={createTitleAction} style={{ display: "grid", gap: 10 }}>
              <label style={label}>
                Title name
                <input name="name" style={input} placeholder="e.g. Maintenance" required />
              </label>
              <label style={label}>
                Description (optional)
                <input name="description" style={input} placeholder="What this title is for" />
              </label>
              <div>
                <button type="submit" style={btn}>
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    );
  }

  const requestedTitleId = (searchParams?.titleId ?? "").trim();
  const selectedTitle = requestedTitleId ? titles.find((t) => t.id === requestedTitleId) ?? null : null;

  if (!selectedTitle) {
    redirect(`/admin/access-titles?titleId=${encodeURIComponent(titles[0].id)}&group=ALL`);
  }

  const requestedGroup = (searchParams?.group ?? "").trim();

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";
  const muted = "rgba(128,128,128,0.75)";

  const card: CSSProperties = { border, borderRadius: 14, background: surface, padding: 12 };
  const label: CSSProperties = { display: "grid", gap: 6, fontSize: 12, opacity: 0.9, fontWeight: 900 };
  const input: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 12,
    border,
    background: surface,
    color: fg,
    outline: "none",
    fontSize: 14,
  };
  const btn: CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border,
    background: surface,
    color: fg,
    fontWeight: 900,
    cursor: "pointer",
    lineHeight: 1,
    whiteSpace: "nowrap",
  };
  const btnPrimary: CSSProperties = {
    ...btn,
    background: "rgba(33,150,243,0.18)",
    border: "1px solid rgba(33,150,243,0.55)",
  };
  const btnDanger: CSSProperties = {
    ...btn,
    background: "rgba(244,67,54,0.14)",
    border: "1px solid rgba(244,67,54,0.55)",
  };
  const pill: CSSProperties = {
    padding: "6px 10px",
    borderRadius: 999,
    border,
    background: "rgba(255,255,255,0.03)",
    fontWeight: 900,
    fontSize: 12,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };

  const selectedWithPerms = await prisma.permissionTitle.findUnique({
    where: { id: selectedTitle.id },
    select: {
      id: true,
      name: true,
      description: true,
      permissions: { select: { permission: true } },
    },
  });

  const userCount = await prisma.userPermissionTitle.count({
    where: { titleId: selectedTitle.id },
  });

  const selectedPerms = new Set<Permission>((selectedWithPerms?.permissions ?? []).map((p) => p.permission));

  const allPermissions = Object.values(Permission);
  const allGroups = buildPermissionGroups(allPermissions);

  const activeGroup = requestedGroup && allGroups.some((g) => g.key === requestedGroup) ? requestedGroup : "ALL";
  const shownGroups = activeGroup === "ALL" ? allGroups : allGroups.filter((g) => g.key === activeGroup);

  const sidebarLink = (groupKey: string) =>
    groupKey === "ALL"
      ? `/admin/access-titles?titleId=${encodeURIComponent(selectedTitle.id)}&group=ALL`
      : `/admin/access-titles?titleId=${encodeURIComponent(selectedTitle.id)}&group=${encodeURIComponent(groupKey)}`;

  const sidebarItemStyle = (isActive: boolean): CSSProperties => ({
    display: "block",
    padding: "10px 12px",
    borderRadius: 12,
    textDecoration: "none",
    border: isActive ? "1px solid rgba(33,150,243,0.65)" : "1px solid rgba(128,128,128,0.25)",
    background: isActive ? "rgba(33,150,243,0.12)" : "rgba(255,255,255,0.02)",
    color: fg,
    fontWeight: isActive ? 900 : 800,
  });

  const titleSwitchAction = async (formData: FormData) => {
    "use server";
    await requireAdmin();
    const id = nonEmpty(formData.get("titleId"));
    const group = nonEmpty(formData.get("group")) || "ALL";
    if (!id) redirect("/admin/access-titles");
    redirect(`/admin/access-titles?titleId=${encodeURIComponent(id)}&group=${encodeURIComponent(group)}`);
  };

  const permFormId = `permform-${selectedTitle.id}`;

  // Button-group styles (base + active applied by JS)
  const modeBtnBase: CSSProperties = {
    ...btn,
    padding: "10px 12px",
    borderRadius: 12,
    fontSize: 14,
  };

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1500, margin: "0 auto", color: fg }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>
            Permissions: {selectedWithPerms?.name ?? selectedTitle.name}
          </h1>

          <Link
            href="/admin/users"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border,
              background: surface,
              color: fg,
              textDecoration: "none",
              fontWeight: 900,
            }}
          >
            ← Users
          </Link>

          <span style={{ ...pill, marginLeft: "auto" }}>
            Assigned users: <b>{userCount}</b>
          </span>
        </div>

        <div style={{ marginTop: 12, ...card }}>
          <form action={titleSwitchAction} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <label style={{ ...label, minWidth: 320 }}>
              Access Title
              <select name="titleId" defaultValue={selectedTitle.id} style={input}>
                {titles.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            <input type="hidden" name="group" value={activeGroup} />

            <button type="submit" style={btnPrimary}>
              Switch
            </button>

            <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
              <details>
                <summary style={{ cursor: "pointer", fontWeight: 900 }}>Create new title</summary>
                <div style={{ marginTop: 10 }}>
                  <form action={createTitleAction} style={{ display: "grid", gap: 10 }}>
                    <label style={label}>
                      Title name
                      <input name="name" style={input} placeholder="e.g. Payroll Admin" required />
                    </label>
                    <label style={label}>
                      Description (optional)
                      <input name="description" style={input} placeholder="What this title is for" />
                    </label>
                    <div>
                      <button type="submit" style={btnPrimary}>
                        Create
                      </button>
                    </div>
                  </form>
                </div>
              </details>
            </div>
          </form>
        </div>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "260px 1fr", gap: 12 }}>
          <aside style={{ ...card, height: "fit-content", position: "sticky", top: 12 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Workspace Permissions</div>

            <div style={{ display: "grid", gap: 8 }}>
              <Link href={sidebarLink("ALL")} style={sidebarItemStyle(activeGroup === "ALL")}>
                All Permissions
              </Link>

              {allGroups.map((g) => (
                <Link key={g.key} href={sidebarLink(g.key)} style={sidebarItemStyle(activeGroup === g.key)}>
                  {g.title}
                </Link>
              ))}
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75, lineHeight: 1.45 }}>
              Click a category to filter the permission list.
            </div>
          </aside>

          <section style={{ display: "grid", gap: 12 }}>
            <div style={{ ...card }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontWeight: 900 }}>Title Details</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    Editing permissions for <b>{selectedWithPerms?.name ?? selectedTitle.name}</b>
                  </div>
                </div>

                <span style={pill}>
                  Category:{" "}
                  <b>{activeGroup === "ALL" ? "All" : allGroups.find((g) => g.key === activeGroup)?.title ?? activeGroup}</b>
                </span>
              </div>

              <form action={updateTitleAction} style={{ marginTop: 10, display: "grid", gap: 10 }}>
                <input type="hidden" name="id" value={selectedTitle.id} />

                <label style={label}>
                  Name
                  <input name="name" defaultValue={selectedWithPerms?.name ?? selectedTitle.name} style={input} required />
                </label>

                <label style={label}>
                  Description
                  <input name="description" defaultValue={selectedWithPerms?.description ?? ""} style={input} />
                </label>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button type="submit" style={btnPrimary}>
                    Save title details
                  </button>

                  <form action={deleteTitleAction}>
                    <input type="hidden" name="id" value={selectedTitle.id} />
                    <button type="submit" style={btnDanger}>
                      Delete title
                    </button>
                  </form>

                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    Deleting removes it from all users automatically.
                  </div>
                </div>
              </form>
            </div>

            <div style={{ ...card }}>
              <form id={permFormId} action={updatePermissionsAction} style={{ display: "grid", gap: 10 }}>
                <input type="hidden" name="id" value={selectedTitle.id} />
                <input type="hidden" name="group" value={activeGroup} />

                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontWeight: 900 }}>Permissions</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>Use the mode buttons, search, then save.</div>
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={pill}>
                      Selected: <b data-selected-count="1">{selectedPerms.size}</b>
                    </span>

                    <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 900 }}>
                      Search Permissions
                      <input
                        type="text"
                        placeholder="Search permissions..."
                        style={{ ...input, width: 280 }}
                        defaultValue=""
                        data-search="1"
                      />
                    </label>
                  </div>
                </div>

                {/* ✅ Button group instead of radios */}
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    flexWrap: "wrap",
                    alignItems: "center",
                    border,
                    borderRadius: 14,
                    padding: 10,
                    background: "rgba(255,255,255,0.02)",
                  }}
                >
                  <span style={{ fontWeight: 900 }}>Selection Mode:</span>

                  <div
                    style={{
                      display: "inline-flex",
                      gap: 8,
                      padding: 6,
                      borderRadius: 14,
                      border,
                      background: "rgba(255,255,255,0.02)",
                    }}
                  >
                    <button
                      type="button"
                      data-mode-btn="CUSTOM"
                      aria-pressed="true"
                      style={modeBtnBase}
                    >
                      Custom
                    </button>
                    <button
                      type="button"
                      data-mode-btn="ALL"
                      aria-pressed="false"
                      style={modeBtnBase}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      data-mode-btn="NONE"
                      aria-pressed="false"
                      style={modeBtnBase}
                    >
                      None
                    </button>
                  </div>

                  <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontWeight: 900 }}>
                      <input type="checkbox" data-select-all="1" />
                      Select all (toggle)
                    </label>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 10, border, borderRadius: 14, padding: 10 }}>
                  {shownGroups.map((g) => (
                    <details key={g.key} open data-group-wrap="1" data-group={g.key}>
                      <summary
                        style={{
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          padding: "8px 6px",
                          borderRadius: 10,
                          background: "rgba(255,255,255,0.02)",
                        }}
                      >
                        <div style={{ display: "grid" }}>
                          <span style={{ fontWeight: 900 }}>{g.title}</span>
                          {g.subtitle ? <span style={{ fontSize: 12, color: muted }}>{g.subtitle}</span> : null}
                        </div>

                        <label
                          style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input type="checkbox" data-group-toggle={g.key} aria-label={`Select all in ${g.title}`} />
                          All
                        </label>
                      </summary>

                      <div
                        style={{
                          marginTop: 8,
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
                          gap: 8,
                          padding: "6px 4px 10px",
                        }}
                      >
                        {g.permissions.map((perm) => (
                          <label
                            key={perm}
                            style={{
                              display: "flex",
                              gap: 10,
                              alignItems: "flex-start",
                              padding: "8px 10px",
                              borderRadius: 12,
                              border,
                              background: "rgba(255,255,255,0.02)",
                            }}
                            data-perm-row="1"
                            data-text={`${permLabel(perm)} ${String(perm)}`.toLowerCase()}
                            data-group={g.key}
                          >
                            <input
                              type="checkbox"
                              name="permissions"
                              value={perm}
                              data-perm="1"
                              data-group={g.key}
                              defaultChecked={selectedPerms.has(perm)}
                              style={{ marginTop: 2 }}
                            />
                            <div style={{ display: "grid", gap: 2 }}>
                              <div style={{ fontWeight: 900 }}>{permLabel(perm)}</div>
                              <div
                                style={{
                                  fontSize: 12,
                                  opacity: 0.85,
                                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                }}
                              >
                                {perm}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button type="submit" style={btnPrimary}>
                    Save Changes
                  </button>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    Saves permissions for <b>{selectedWithPerms?.name ?? selectedTitle.name}</b>.
                  </div>
                </div>

                <script
                  dangerouslySetInnerHTML={{
                    __html: `
(function(){
  const form = document.getElementById(${JSON.stringify(permFormId)});
  if(!form) return;

  const permBoxes = () => Array.from(form.querySelectorAll('input[type="checkbox"][data-perm="1"]'));
  const selectAll = form.querySelector('input[type="checkbox"][data-select-all="1"]');
  const selectedCountEl = form.querySelector('[data-selected-count="1"]');
  const searchInput = form.querySelector('input[data-search="1"]');

  const modeButtons = Array.from(form.querySelectorAll('button[type="button"][data-mode-btn]'));

  function setIndeterminate(el, on){
    try { el.indeterminate = !!on; } catch(e) {}
  }

  function syncSelectedCount(){
    const boxes = permBoxes();
    const checked = boxes.filter(b => b.checked).length;
    if(selectedCountEl) selectedCountEl.textContent = String(checked);
  }

  function syncSelectAll(){
    if(!selectAll) return;
    const boxes = permBoxes();
    const checked = boxes.filter(b => b.checked).length;
    selectAll.checked = boxes.length > 0 && checked === boxes.length;
    setIndeterminate(selectAll, checked > 0 && checked < boxes.length);
  }

  function syncGroup(groupKey){
    const toggle = form.querySelector('input[type="checkbox"][data-group-toggle="'+groupKey+'"]');
    if(!toggle) return;
    const boxes = permBoxes().filter(b => b.getAttribute('data-group') === groupKey);
    const checked = boxes.filter(b => b.checked).length;
    toggle.checked = boxes.length > 0 && checked === boxes.length;
    setIndeterminate(toggle, checked > 0 && checked < boxes.length);
  }

  function syncAllGroups(){
    const toggles = Array.from(form.querySelectorAll('input[type="checkbox"][data-group-toggle]'));
    toggles.forEach(t => {
      const k = t.getAttribute('data-group-toggle');
      if(k) syncGroup(k);
    });
  }

  function setAll(on){
    permBoxes().forEach(b => { b.checked = !!on; });
    syncAllGroups();
    syncSelectAll();
    syncSelectedCount();
  }

  function setModeActive(mode){
    modeButtons.forEach(btn => {
      const m = btn.getAttribute('data-mode-btn');
      const active = (m === mode);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');

      // Active style
      if(active){
        btn.style.background = "rgba(33,150,243,0.18)";
        btn.style.border = "1px solid rgba(33,150,243,0.55)";
        btn.style.boxShadow = "0 0 0 1px rgba(33,150,243,0.12) inset";
      } else {
        btn.style.background = "var(--background)";
        btn.style.border = "1px solid rgba(128,128,128,0.25)";
        btn.style.boxShadow = "none";
      }
    });
  }

  function applyMode(mode){
    if(mode === "ALL") setAll(true);
    else if(mode === "NONE") setAll(false);
    // CUSTOM does not change selection; it just changes UI mode
  }

  function applySearch(qRaw){
    const q = String(qRaw || "").trim().toLowerCase();
    const rows = Array.from(form.querySelectorAll('[data-perm-row="1"]'));
    rows.forEach(r => {
      const text = (r.getAttribute('data-text') || "").toLowerCase();
      r.style.display = (!q || text.includes(q)) ? "" : "none";
    });

    const groups = Array.from(form.querySelectorAll('[data-group-wrap="1"]'));
    groups.forEach(g => {
      const rowsIn = Array.from(g.querySelectorAll('[data-perm-row="1"]'));
      const anyVisible = rowsIn.some(r => r.style.display !== "none");
      g.style.display = anyVisible ? "" : "none";
    });
  }

  // init visuals
  setModeActive("CUSTOM");
  syncAllGroups();
  syncSelectAll();
  syncSelectedCount();

  // mode button clicks
  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode-btn') || "CUSTOM";
      setModeActive(mode);
      applyMode(mode);
    });
  });

  form.addEventListener('change', (e) => {
    const t = e.target;
    if(!(t instanceof HTMLInputElement)) return;

    if(t.matches('input[type="checkbox"][data-select-all="1"]')){
      setAll(!!t.checked);
      setModeActive("CUSTOM");
      return;
    }

    if(t.matches('input[type="checkbox"][data-group-toggle]')){
      const groupKey = t.getAttribute('data-group-toggle');
      const on = !!t.checked;
      permBoxes().filter(b => b.getAttribute('data-group') === groupKey).forEach(b => { b.checked = on; });
      if(groupKey) syncGroup(groupKey);
      syncSelectAll();
      syncSelectedCount();
      setModeActive("CUSTOM");
      return;
    }

    if(t.matches('input[type="checkbox"][data-perm="1"]')){
      const groupKey = t.getAttribute('data-group');
      if(groupKey) syncGroup(groupKey);
      syncSelectAll();
      syncSelectedCount();
      setModeActive("CUSTOM");
      return;
    }
  });

  if(searchInput){
    searchInput.addEventListener('input', () => applySearch(searchInput.value));
  }
})();`,
                  }}
                />
              </form>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}