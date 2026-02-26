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
  return session;
}

function nonEmpty(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

function parseBool(v: FormDataEntryValue | null): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function pageWrap(): CSSProperties {
  return { padding: 16, maxWidth: 1400, margin: "0 auto" };
}

function card(): CSSProperties {
  return {
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.25)",
    borderRadius: 14,
    padding: 14,
    backdropFilter: "blur(6px)",
  };
}

function label(): CSSProperties {
  return { fontSize: 12, color: "rgba(255,255,255,0.65)", display: "block", marginBottom: 6 };
}

function input(): CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.35)",
    color: "white",
    outline: "none",
  };
}

function btn(variant: "primary" | "danger" | "ghost" = "ghost"): CSSProperties {
  const base: CSSProperties = {
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 14,
    lineHeight: "18px",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
    color: "white",
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    whiteSpace: "nowrap",
  };
  if (variant === "primary") {
    return { ...base, background: "rgba(37,99,235,0.85)", borderColor: "rgba(37,99,235,0.85)" };
  }
  if (variant === "danger") {
    return { ...base, background: "rgba(220,38,38,0.85)", borderColor: "rgba(220,38,38,0.85)" };
  }
  return base;
}

function hr(): CSSProperties {
  return { border: "none", borderTop: "1px solid rgba(255,255,255,0.10)", margin: "12px 0" };
}

type PermMeta = {
  perm: Permission;
  module: "Admin" | "Inventory" | "Maintenance" | "Navigation";
  group: string;
  label: string;
};

const PERMS: PermMeta[] = [
  // Navigation
  { perm: Permission.VIEW_HOME, module: "Navigation", group: "Navigation", label: "View Home" },

  // Inventory (checkout)
  { perm: Permission.VIEW_CHECKOUT, module: "Inventory", group: "Checkout", label: "View Checkout" },
  { perm: Permission.CREATE_CHECKOUT, module: "Inventory", group: "Checkout", label: "Create Checkout" },

  // Maintenance (work orders)
  { perm: Permission.VIEW_WORK_ORDERS, module: "Maintenance", group: "Work Orders", label: "View Work Orders" },
  { perm: Permission.CREATE_WORK_ORDERS, module: "Maintenance", group: "Work Orders", label: "Create Work Orders" },
  { perm: Permission.UPDATE_OWN_WORK_ORDERS, module: "Maintenance", group: "Work Orders", label: "Update Own Work Orders" },
  { perm: Permission.SUBMIT_OWN_WORK_ORDERS, module: "Maintenance", group: "Work Orders", label: "Submit Own Work Orders" },

  // Admin modules
  { perm: Permission.ADMIN_VIEW_ITEMS, module: "Admin", group: "Items", label: "View Items" },
  { perm: Permission.ADMIN_EDIT_ITEMS, module: "Admin", group: "Items", label: "Edit Items" },
  { perm: Permission.ADMIN_IMPORT_EXPORT_ITEMS, module: "Admin", group: "Items", label: "Import / Export Items" },

  { perm: Permission.ADMIN_VIEW_USERS, module: "Admin", group: "Users", label: "View Users" },
  { perm: Permission.ADMIN_EDIT_USERS, module: "Admin", group: "Users", label: "Edit Users" },

  { perm: Permission.ADMIN_VIEW_LOCATIONS, module: "Admin", group: "Locations", label: "View Locations" },
  { perm: Permission.ADMIN_EDIT_LOCATIONS, module: "Admin", group: "Locations", label: "Edit Locations" },

  { perm: Permission.ADMIN_VIEW_WORK_ORDERS, module: "Admin", group: "Work Orders (Admin)", label: "View Work Orders" },
  { perm: Permission.ADMIN_EDIT_WORK_ORDERS, module: "Admin", group: "Work Orders (Admin)", label: "Edit Work Orders" },
  { perm: Permission.ADMIN_DELETE_WORK_ORDERS, module: "Admin", group: "Work Orders (Admin)", label: "Delete Work Orders" },

  { perm: Permission.ADMIN_VIEW_MAINTENANCE_TICKETS, module: "Admin", group: "Maintenance Tickets", label: "View Maintenance Tickets" },
  { perm: Permission.ADMIN_EXPORT_MAINTENANCE_TICKETS, module: "Admin", group: "Maintenance Tickets", label: "Export Maintenance Tickets" },
];

const MODULES: PermMeta["module"][] = ["Admin", "Inventory", "Maintenance", "Navigation"];
type ModuleFilter = PermMeta["module"] | "All";

function normalizeQuery(q: string) {
  return q.trim().toLowerCase();
}

function permsForScope(module: ModuleFilter) {
  if (module === "All") return PERMS.map((p) => p.perm);
  return PERMS.filter((p) => p.module === module).map((p) => p.perm);
}

// -------------------- Server Actions --------------------

async function createTitleAction(formData: FormData) {
  "use server";
  await requireAdmin();

  const name = nonEmpty(formData.get("name"));
  const description = nonEmpty(formData.get("description"));
  if (!name) return;

  const created = await prisma.permissionTitle.create({
    data: {
      name,
      active: true,
      description: description || null,
    } as any,
  });

  revalidatePath("/admin/access-titles");
  redirect(`/admin/access-titles?titleId=${created.id}`);
}

async function switchTitleAction(formData: FormData) {
  "use server";
  await requireAdmin();

  const titleId = nonEmpty(formData.get("titleId"));
  if (!titleId) redirect("/admin/access-titles");
  redirect(`/admin/access-titles?titleId=${encodeURIComponent(titleId)}`);
}

async function saveTitleDetailsAction(formData: FormData) {
  "use server";
  await requireAdmin();

  const id = nonEmpty(formData.get("id"));
  const name = nonEmpty(formData.get("name"));
  const description = nonEmpty(formData.get("description"));
  const active = parseBool(formData.get("active"));

  if (!id || !name) return;

  await prisma.permissionTitle.update({
    where: { id },
    data: {
      name,
      active,
      description: description || null,
    } as any,
  });

  revalidatePath("/admin/access-titles");
  redirect(`/admin/access-titles?titleId=${encodeURIComponent(id)}`);
}

async function deleteTitleAction(formData: FormData) {
  "use server";
  await requireAdmin();

  const id = nonEmpty(formData.get("id"));
  if (!id) return;

  await prisma.$transaction(async (tx) => {
    await tx.permissionTitlePermission.deleteMany({ where: { titleId: id } });
    await tx.permissionTitle.delete({ where: { id } });
  });

  revalidatePath("/admin/access-titles");
  redirect("/admin/access-titles");
}

async function savePermissionsAction(formData: FormData) {
  "use server";
  await requireAdmin();

  const titleId = nonEmpty(formData.get("titleId"));
  const scopeRaw = nonEmpty(formData.get("scope"));
  const scope: ModuleFilter = scopeRaw === "All" ? "All" : (scopeRaw as PermMeta["module"]);
  if (!titleId) return;

  const checked = new Set(formData.getAll("perm").map((v) => String(v)).filter(Boolean));
  const scopePerms = permsForScope(scope);

  await prisma.$transaction(async (tx) => {
    if (scope === "All") {
      await tx.permissionTitlePermission.deleteMany({ where: { titleId } });
    } else {
      await tx.permissionTitlePermission.deleteMany({
        where: { titleId, permission: { in: scopePerms } },
      });
    }

    const toInsert = scopePerms.filter((p) => checked.has(p));
    if (toInsert.length) {
      await tx.permissionTitlePermission.createMany({
        data: toInsert.map((permission) => ({ titleId, permission })),
      });
    }
  });

  revalidatePath("/admin/access-titles");

  const mod = nonEmpty(formData.get("module"));
  const q = nonEmpty(formData.get("q"));
  const params = new URLSearchParams();
  params.set("titleId", titleId);
  if (mod) params.set("module", mod);
  if (q) params.set("q", q);
  redirect(`/admin/access-titles?${params.toString()}`);
}

async function selectAllInScopeAction(formData: FormData) {
  "use server";
  await requireAdmin();

  const titleId = nonEmpty(formData.get("titleId"));
  const scopeRaw = nonEmpty(formData.get("scope"));
  const scope: ModuleFilter = scopeRaw === "All" ? "All" : (scopeRaw as PermMeta["module"]);
  if (!titleId) return;

  const scopePerms = permsForScope(scope);

  await prisma.$transaction(async (tx) => {
    if (scope === "All") {
      await tx.permissionTitlePermission.deleteMany({ where: { titleId } });
    } else {
      await tx.permissionTitlePermission.deleteMany({
        where: { titleId, permission: { in: scopePerms } },
      });
    }
    if (scopePerms.length) {
      await tx.permissionTitlePermission.createMany({
        data: scopePerms.map((permission) => ({ titleId, permission })),
      });
    }
  });

  revalidatePath("/admin/access-titles");

  const mod = nonEmpty(formData.get("module"));
  const q = nonEmpty(formData.get("q"));
  const params = new URLSearchParams();
  params.set("titleId", titleId);
  if (mod) params.set("module", mod);
  if (q) params.set("q", q);
  redirect(`/admin/access-titles?${params.toString()}`);
}

async function clearAllInScopeAction(formData: FormData) {
  "use server";
  await requireAdmin();

  const titleId = nonEmpty(formData.get("titleId"));
  const scopeRaw = nonEmpty(formData.get("scope"));
  const scope: ModuleFilter = scopeRaw === "All" ? "All" : (scopeRaw as PermMeta["module"]);
  if (!titleId) return;

  const scopePerms = permsForScope(scope);

  if (scope === "All") {
    await prisma.permissionTitlePermission.deleteMany({ where: { titleId } });
  } else {
    await prisma.permissionTitlePermission.deleteMany({
      where: { titleId, permission: { in: scopePerms } },
    });
  }

  revalidatePath("/admin/access-titles");

  const mod = nonEmpty(formData.get("module"));
  const q = nonEmpty(formData.get("q"));
  const params = new URLSearchParams();
  params.set("titleId", titleId);
  if (mod) params.set("module", mod);
  if (q) params.set("q", q);
  redirect(`/admin/access-titles?${params.toString()}`);
}

// -------------------- Page --------------------

export default async function AccessTitlesPage({
  searchParams,
}: {
  searchParams?: { titleId?: string; module?: string; q?: string };
}) {
  await requireAdmin();

  const titles = await prisma.permissionTitle.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  const titleId = searchParams?.titleId ?? titles[0]?.id ?? null;
  const selectedTitle = titleId ? await prisma.permissionTitle.findUnique({ where: { id: titleId } }) : null;

  const existingPermRows = titleId ? await prisma.permissionTitlePermission.findMany({ where: { titleId } }) : [];
  const selectedSet = new Set<Permission>(existingPermRows.map((r) => r.permission as Permission));
  const selectedCount = selectedSet.size;
  const totalCount = PERMS.length;

  const moduleParamRaw = nonEmpty(searchParams?.module ?? "");
  const moduleFilter: ModuleFilter =
    moduleParamRaw === "All"
      ? "All"
      : MODULES.includes(moduleParamRaw as PermMeta["module"])
        ? (moduleParamRaw as PermMeta["module"])
        : "Admin";

  const q = nonEmpty(searchParams?.q ?? "");
  const nq = normalizeQuery(q);

  const visible = PERMS.filter((p) => (moduleFilter === "All" ? true : p.module === moduleFilter)).filter((p) => {
    if (!nq) return true;
    return (
      p.label.toLowerCase().includes(nq) ||
      String(p.perm).toLowerCase().includes(nq) ||
      p.group.toLowerCase().includes(nq)
    );
  });

  const moduleCounts = MODULES.map((m) => {
    const perms = PERMS.filter((p) => p.module === m).map((p) => p.perm);
    const sel = perms.filter((p) => selectedSet.has(p)).length;
    return { module: m, sel, total: perms.length };
  });

  const grouped = Array.from(
    visible.reduce((m, p) => {
      const arr = m.get(p.group) ?? [];
      arr.push(p);
      m.set(p.group, arr);
      return m;
    }, new Map<string, PermMeta[]>())
  );

  return (
    <div style={pageWrap()}>
      {/* Header row (no extra page navigation) */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "white" }}>Access Titles</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginTop: 6 }}>
            Create titles (roles) and assign permissions.
          </div>
        </div>

        {/* optional link; doesn't create a second nav bar */}
        <Link href="/admin" style={btn("ghost")}>
          Back to Admin
        </Link>
      </div>

      <div style={{ height: 14 }} />

      {/* Title selector */}
      <div style={card()}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <form action={switchTitleAction} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ minWidth: 320 }}>
              <div style={label()}>Access Title</div>
              <select name="titleId" defaultValue={titleId ?? ""} style={input()}>
                {titles.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <button type="submit" style={{ ...btn("primary"), marginTop: 18 }}>
              Switch
            </button>
          </form>

          <details>
            <summary style={{ ...btn("ghost"), listStyle: "none" as any }}>▶ Create new title</summary>
            <div style={{ marginTop: 10, ...card(), padding: 12 }}>
              <form action={createTitleAction} style={{ display: "grid", gap: 10, width: 420, maxWidth: "100%" }}>
                <div>
                  <div style={label()}>Name</div>
                  <input name="name" style={input()} placeholder="Accounting" />
                </div>
                <div>
                  <div style={label()}>Description</div>
                  <input name="description" style={input()} placeholder="Optional" />
                </div>
                <button type="submit" style={btn("primary")}>
                  Create
                </button>
              </form>
            </div>
          </details>
        </div>
      </div>

      <div style={{ height: 14 }} />

      {/* Main 2-column content */}
      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 14, alignItems: "start" }}>
        {/* Title details */}
        <div style={card()}>
          {!selectedTitle ? (
            <div style={{ color: "rgba(255,255,255,0.7)" }}>Select a title to edit.</div>
          ) : (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: "white" }}>Title Details</div>
              <div style={{ height: 10 }} />

              <form action={saveTitleDetailsAction} style={{ display: "grid", gap: 10 }}>
                <input type="hidden" name="id" value={selectedTitle.id} />

                <div>
                  <div style={label()}>Name</div>
                  <input name="name" defaultValue={(selectedTitle as any).name ?? ""} style={input()} />
                </div>

                <div>
                  <div style={label()}>Description</div>
                  <input name="description" defaultValue={(selectedTitle as any).description ?? ""} style={input()} />
                </div>

                <div>
                  <div style={label()}>Active</div>
                  <select name="active" defaultValue={(selectedTitle as any).active ? "1" : "0"} style={input()}>
                    <option value="1">Active</option>
                    <option value="0">Inactive</option>
                  </select>
                </div>

                <button type="submit" style={btn("primary")}>
                  Save title details
                </button>
              </form>

              <div style={{ marginTop: 10 }}>
                <form action={deleteTitleAction}>
                  <input type="hidden" name="id" value={selectedTitle.id} />
                  <button type="submit" style={btn("danger")}>
                    Delete title
                  </button>
                </form>
                <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
                  Deleting removes it from all users automatically.
                </div>
              </div>
            </>
          )}
        </div>

        {/* Permissions */}
        <div style={card()}>
          {!selectedTitle ? (
            <div style={{ color: "rgba(255,255,255,0.7)" }}>Select a title to edit.</div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "white" }}>Permissions</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 4 }}>
                    Select by module + feature group.
                  </div>
                </div>

                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
                  Selected: <strong>{selectedCount}</strong> / {totalCount}
                </div>
              </div>

              <div style={{ height: 10 }} />

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <form method="GET" action="/admin/access-titles" style={{ flex: 1, minWidth: 260 }}>
                  <input type="hidden" name="titleId" value={selectedTitle.id} />
                  <input type="hidden" name="module" value={moduleFilter} />
                  <input name="q" defaultValue={q} style={input()} placeholder="Search permissions..." />
                </form>

                <form action={selectAllInScopeAction}>
                  <input type="hidden" name="titleId" value={selectedTitle.id} />
                  <input type="hidden" name="scope" value={moduleFilter} />
                  <input type="hidden" name="module" value={moduleFilter} />
                  <input type="hidden" name="q" value={q} />
                  <button type="submit" style={btn("primary")}>
                    Select all
                  </button>
                </form>

                <form action={clearAllInScopeAction}>
                  <input type="hidden" name="titleId" value={selectedTitle.id} />
                  <input type="hidden" name="scope" value={moduleFilter} />
                  <input type="hidden" name="module" value={moduleFilter} />
                  <input type="hidden" name="q" value={q} />
                  <button type="submit" style={btn("ghost")}>
                    Clear all
                  </button>
                </form>

                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
                  Scope: <strong>{moduleFilter}</strong>
                </div>
              </div>

              <div style={{ height: 12 }} />

              <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, alignItems: "start" }}>
                {/* Modules */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "white", marginBottom: 8 }}>Modules</div>

                  <div style={{ display: "grid", gap: 8 }}>
                    {moduleCounts.map((m) => {
                      const isActive = moduleFilter === m.module;
                      const params = new URLSearchParams();
                      params.set("titleId", selectedTitle.id);
                      params.set("module", m.module);
                      if (q) params.set("q", q);
                      return (
                        <Link
                          key={m.module}
                          href={`/admin/access-titles?${params.toString()}`}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 12,
                            border: `1px solid ${isActive ? "rgba(59,130,246,0.55)" : "rgba(255,255,255,0.14)"}`,
                            background: isActive ? "rgba(59,130,246,0.20)" : "rgba(0,0,0,0.25)",
                            color: "white",
                            textDecoration: "none",
                            display: "block",
                            fontSize: 14,
                          }}
                        >
                          {m.module}
                          <span style={{ float: "right", opacity: 0.85 }}>
                            {m.sel}/{m.total}
                          </span>
                        </Link>
                      );
                    })}
                  </div>

                  <div style={{ marginTop: 10 }}>
                    {(() => {
                      const params = new URLSearchParams();
                      params.set("titleId", selectedTitle.id);
                      params.set("module", "All");
                      if (q) params.set("q", q);
                      const isActive = moduleFilter === "All";
                      return (
                        <Link
                          href={`/admin/access-titles?${params.toString()}`}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 12,
                            border: `1px solid ${isActive ? "rgba(59,130,246,0.55)" : "rgba(255,255,255,0.14)"}`,
                            background: isActive ? "rgba(59,130,246,0.20)" : "rgba(0,0,0,0.25)",
                            color: "white",
                            textDecoration: "none",
                            display: "block",
                            fontSize: 14,
                          }}
                        >
                          All
                          <span style={{ float: "right", opacity: 0.85 }}>
                            {selectedCount}/{totalCount}
                          </span>
                        </Link>
                      );
                    })()}
                  </div>
                </div>

                {/* Permission list */}
                <div>
                  <form action={savePermissionsAction} style={{ display: "grid", gap: 10 }}>
                    <input type="hidden" name="titleId" value={selectedTitle.id} />
                    <input type="hidden" name="scope" value={moduleFilter} />
                    <input type="hidden" name="module" value={moduleFilter} />
                    <input type="hidden" name="q" value={q} />

                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button type="submit" style={btn("primary")}>
                        Save permissions
                      </button>
                    </div>

                    <div style={hr()} />

                    {visible.length === 0 ? (
                      <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 13 }}>
                        No permissions match your filters.
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        {grouped.map(([groupName, perms]) => {
                          const total = perms.length;
                          const sel = perms.filter((p) => selectedSet.has(p.perm)).length;

                          return (
                            <div key={groupName} style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 14, padding: 12 }}>
                              <div style={{ fontSize: 14, fontWeight: 700, color: "white" }}>
                                {groupName} <span style={{ opacity: 0.7, fontWeight: 600 }}>({sel}/{total})</span>
                              </div>

                              <div style={{ height: 8 }} />

                              <div style={{ display: "grid", gap: 8 }}>
                                {perms.map((p) => (
                                  <label
                                    key={p.perm}
                                    style={{
                                      display: "flex",
                                      alignItems: "flex-start",
                                      gap: 10,
                                      padding: 10,
                                      borderRadius: 12,
                                      border: "1px solid rgba(255,255,255,0.10)",
                                      background: "rgba(0,0,0,0.20)",
                                      cursor: "pointer",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      name="perm"
                                      value={p.perm}
                                      defaultChecked={selectedSet.has(p.perm)}
                                      style={{ marginTop: 3 }}
                                    />
                                    <div style={{ display: "grid", gap: 2 }}>
                                      <div style={{ fontSize: 14, color: "white" }}>{p.label}</div>
                                      <div
                                        style={{
                                          fontSize: 12,
                                          opacity: 0.75,
                                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                        }}
                                      >
                                        {p.perm}
                                      </div>
                                    </div>
                                  </label>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </form>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}