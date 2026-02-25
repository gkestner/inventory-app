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

export default async function AdminAccessTitlesPage() {
  await requireAdmin();

  // Verify DB tables exist (prevents runtime crash if migrations not deployed)
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

    await prisma.permissionTitle.create({
      data: { name, description, active: true },
      select: { id: true },
    });

    revalidatePath("/admin/access-titles");
    redirect("/admin/access-titles");
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
    redirect("/admin/access-titles");
  }

  async function updatePermissionsAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const titleId = nonEmpty(formData.get("id"));
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
    redirect("/admin/access-titles");
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

  // Load titles + permissions
  const base = await prisma.permissionTitle.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      permissions: { select: { permission: true } },
    },
  });

  const ids = base.map((b) => b.id);

  // User counts (how many users assigned each title)
  const counts =
    ids.length === 0
      ? []
      : await prisma.userPermissionTitle.groupBy({
          by: ["titleId"],
          where: { titleId: { in: ids } },
          _count: { _all: true },
        });

  const countById = new Map<string, number>();
  for (const row of counts) countById.set(row.titleId, row._count._all);

  const titles = base.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    permissions: t.permissions,
    _count: { users: countById.get(t.id) ?? 0 },
  }));

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
  const btnPrimary: CSSProperties = { ...btn, background: "rgba(33,150,243,0.18)", border: "1px solid rgba(33,150,243,0.55)" };
  const btnDanger: CSSProperties = { ...btn, background: "rgba(244,67,54,0.14)", border: "1px solid rgba(244,67,54,0.55)" };

  const allPermissions = Object.values(Permission);
  const groups = buildPermissionGroups(allPermissions);

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

        {/* Create */}
        <div style={{ marginTop: 12, ...card }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Create new title</div>
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
              <button type="submit" style={btnPrimary}>
                Create
              </button>
            </div>
          </form>
        </div>

        {/* List */}
        <div style={{ marginTop: 12, ...card }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900 }}>Titles</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Total: <b>{titles.length}</b>
            </div>
          </div>

          {titles.length === 0 ? (
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>No titles yet.</div>
          ) : (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {titles.map((t) => {
                const selected = new Set(t.permissions.map((x) => x.permission));
                const formId = `permform-${t.id}`;
                const allChecked = allPermissions.length > 0 && allPermissions.every((p) => selected.has(p));
                const selectedCount = selected.size;

                return (
                  <details key={t.id} style={{ borderTop: border, paddingTop: 10 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 900 }}>
                      {t.name}{" "}
                      <span style={{ opacity: 0.75, fontWeight: 700 }}>
                        • {t._count.users} user{t._count.users === 1 ? "" : "s"} • {selectedCount} perm
                      </span>
                    </summary>

                    <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                      {/* Edit name/desc */}
                      <form action={updateTitleAction} style={{ display: "grid", gap: 8 }}>
                        <input type="hidden" name="id" value={t.id} />

                        <label style={label}>
                          Name
                          <input name="name" defaultValue={t.name} style={input} required />
                        </label>

                        <label style={label}>
                          Description
                          <input name="description" defaultValue={t.description ?? ""} style={input} />
                        </label>

                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <button type="submit" style={btnPrimary}>
                            Save title
                          </button>
                        </div>
                      </form>

                      {/* Permissions */}
                      <form id={formId} action={updatePermissionsAction} style={{ display: "grid", gap: 10 }}>
                        <input type="hidden" name="id" value={t.id} />

                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontWeight: 900 }}>Permissions</div>
                            <div style={{ fontSize: 12, opacity: 0.8 }}>
                              Select permissions this title grants. Users assigned this title inherit them.
                            </div>
                          </div>

                          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900 }}>
                            <input type="checkbox" data-select-all="1" defaultChecked={allChecked} />
                            Select all
                          </label>
                        </div>

                        <div style={{ display: "grid", gap: 10, border, borderRadius: 14, padding: 10 }}>
                          {groups.map((g) => {
                            const groupCheckedCount = g.permissions.reduce((acc, p) => acc + (selected.has(p) ? 1 : 0), 0);
                            const groupAllChecked = g.permissions.length > 0 && groupCheckedCount === g.permissions.length;
                            const groupNoneChecked = groupCheckedCount === 0;

                            return (
                              <details key={`${t.id}-${g.key}`} open>
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
                                    <input
                                      type="checkbox"
                                      data-group-toggle={g.key}
                                      defaultChecked={groupAllChecked}
                                      aria-label={`Select all in ${g.title}`}
                                    />
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
                                      key={`${t.id}-${perm}`}
                                      style={{
                                        display: "flex",
                                        gap: 10,
                                        alignItems: "flex-start",
                                        padding: "8px 10px",
                                        borderRadius: 12,
                                        border,
                                        background: "rgba(255,255,255,0.02)",
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        name="permissions"
                                        value={perm}
                                        data-perm="1"
                                        data-group={g.key}
                                        defaultChecked={selected.has(perm)}
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
                            );
                          })}
                        </div>

                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <button type="submit" style={btnPrimary}>
                            Save permissions
                          </button>
                          <div style={{ fontSize: 12, opacity: 0.75 }}>
                            Selected: <b>{selected.size}</b>
                          </div>
                        </div>

                        <script
                          dangerouslySetInnerHTML={{
                            __html: `
(function(){
  const form = document.getElementById(${JSON.stringify(formId)});
  if(!form) return;

  const permBoxes = () => Array.from(form.querySelectorAll('input[type="checkbox"][data-perm="1"]'));
  const selectAll = form.querySelector('input[type="checkbox"][data-select-all="1"]');

  function setIndeterminate(el, on){
    try { el.indeterminate = !!on; } catch(e) {}
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
    toggles.forEach(t => syncGroup(t.getAttribute('data-group-toggle')));
  }

  syncAllGroups();
  syncSelectAll();

  form.addEventListener('change', (e) => {
    const t = e.target;
    if(!(t instanceof HTMLInputElement)) return;

    if(t.matches('input[type="checkbox"][data-select-all="1"]')){
      const on = t.checked;
      permBoxes().forEach(b => { b.checked = on; });
      syncAllGroups();
      syncSelectAll();
      return;
    }

    if(t.matches('input[type="checkbox"][data-group-toggle]')){
      const groupKey = t.getAttribute('data-group-toggle');
      const on = t.checked;
      permBoxes().filter(b => b.getAttribute('data-group') === groupKey).forEach(b => { b.checked = on; });
      syncGroup(groupKey);
      syncSelectAll();
      return;
    }

    if(t.matches('input[type="checkbox"][data-perm="1"]')){
      const groupKey = t.getAttribute('data-group');
      if(groupKey) syncGroup(groupKey);
      syncSelectAll();
    }
  });
})();`,
                          }}
                        />
                      </form>

                      {/* Delete */}
                      <form action={deleteTitleAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <button type="submit" style={btnDanger}>
                          Delete title
                        </button>
                        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                          Deleting a title removes it from all users automatically.
                        </div>
                      </form>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
          Tip: create a title named <b>Maintenance</b> and check the permissions you want maintenance staff to have.
        </div>
      </div>
    </main>
  );
}