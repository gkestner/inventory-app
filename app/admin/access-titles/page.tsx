// app/admin/access-titles/page.tsx
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
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

function cardStyle(): CSSProperties {
  return {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 16,
    background: "white",
  };
}

function btnStyle(variant: "primary" | "danger" | "ghost" = "ghost"): CSSProperties {
  const base: CSSProperties = {
    display: "inline-block",
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    textDecoration: "none",
    fontSize: 14,
    lineHeight: "20px",
    cursor: "pointer",
  };
  if (variant === "primary") return { ...base, background: "#111827", color: "white", borderColor: "#111827" };
  if (variant === "danger") return { ...base, background: "#991b1b", color: "white", borderColor: "#991b1b" };
  return { ...base, background: "white", color: "#111827" };
}

function labelStyle(): CSSProperties {
  return { fontSize: 12, color: "#6b7280", display: "block", marginBottom: 6 };
}

function inputStyle(): CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    fontSize: 14,
  };
}

function rowStyle(): CSSProperties {
  return { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" };
}

function hrStyle(): CSSProperties {
  return { border: "none", borderTop: "1px solid #e5e7eb", margin: "14px 0" };
}

// --- Server Actions ---
async function createTitleAction(formData: FormData) {
  "use server";
  await requireAdmin();

  const name = nonEmpty(formData.get("name"));
  if (!name) return;

  await prisma.permissionTitle.create({
    data: { name, active: true },
  });

  revalidatePath("/admin/access-titles");
}

async function updateTitleMetaAction(formData: FormData) {
  "use server";
  await requireAdmin();

  const id = nonEmpty(formData.get("id"));
  const name = nonEmpty(formData.get("name"));
  const active = parseBool(formData.get("active"));

  if (!id || !name) return;

  await prisma.permissionTitle.update({
    where: { id },
    data: { name, active },
  });

  revalidatePath("/admin/access-titles");
}

async function deleteTitleAction(formData: FormData) {
  "use server";
  await requireAdmin();

  const id = nonEmpty(formData.get("id"));
  if (!id) return;

  // remove permissions first (if you have FK constraints)
  // NOTE: if your join model name differs, tell me and I’ll adjust
  await prisma.permissionTitlePermission.deleteMany({ where: { titleId: id } });
  await prisma.permissionTitle.delete({ where: { id } });

  revalidatePath("/admin/access-titles");
}

async function setTitlePermissionsAction(formData: FormData) {
  "use server";
  await requireAdmin();

  const titleId = nonEmpty(formData.get("titleId"));
  if (!titleId) return;

  const selected = formData.getAll("perm").map((v) => String(v)) as Permission[];

  await prisma.$transaction(async (tx) => {
    await tx.permissionTitlePermission.deleteMany({ where: { titleId } });
    if (selected.length) {
      await tx.permissionTitlePermission.createMany({
        data: selected.map((permission) => ({ titleId, permission })),
      });
    }
  });

  revalidatePath("/admin/access-titles");
}

// --- Page ---
export default async function AccessTitlesPage({
  searchParams,
}: {
  searchParams?: { titleId?: string };
}) {
  await requireAdmin();

  const titleId = searchParams?.titleId ?? null;

  const titles = await prisma.permissionTitle.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  // Load selected title + its permissions (if requested)
  const selectedTitle = titleId
    ? await prisma.permissionTitle.findUnique({ where: { id: titleId } })
    : null;

  const selectedPerms = titleId
    ? await prisma.permissionTitlePermission.findMany({
        where: { titleId },
        orderBy: [{ permission: "asc" }],
      })
    : [];

  const selectedSet = new Set<Permission>(selectedPerms.map((p) => p.permission));

  const allPermissions = Object.values(Permission);

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>Access Titles</h1>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>
            Create titles (roles) and assign permissions.
          </div>
        </div>
        <Link href="/admin" style={btnStyle("ghost")}>
          Back to Admin
        </Link>
      </div>

      <div style={{ height: 14 }} />

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 16, alignItems: "start" }}>
        {/* Left: Titles list + create */}
        <div style={cardStyle()}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Titles</h2>
          <div style={{ height: 10 }} />

          <form action={createTitleAction} style={{ display: "grid", gap: 10 }}>
            <div>
              <label style={labelStyle()}>New title name</label>
              <input name="name" placeholder="e.g., Warehouse Tech" style={inputStyle()} />
            </div>
            <button type="submit" style={btnStyle("primary")}>
              Create Title
            </button>
          </form>

          <hr style={hrStyle()} />

          <div style={{ display: "grid", gap: 10 }}>
            {titles.length === 0 ? (
              <div style={{ fontSize: 13, color: "#6b7280" }}>No titles yet.</div>
            ) : (
              titles.map((t) => (
                <div
                  key={t.id}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 12,
                    background: titleId === t.id ? "#f9fafb" : "white",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                        {t.active ? "Active" : "Inactive"}
                      </div>
                    </div>
                    <Link href={`/admin/access-titles?titleId=${t.id}`} style={btnStyle("ghost")}>
                      Manage
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: Manage selected */}
        <div style={cardStyle()}>
          {!selectedTitle ? (
            <div style={{ fontSize: 14, color: "#6b7280" }}>Select a title to edit.</div>
          ) : (
            <>
              <h2 style={{ margin: 0, fontSize: 16 }}>Manage: {selectedTitle.name}</h2>
              <div style={{ height: 12 }} />

              <form action={updateTitleMetaAction} style={{ display: "grid", gap: 12 }}>
                <input type="hidden" name="id" value={selectedTitle.id} />
                <div style={rowStyle()}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <label style={labelStyle()}>Title name</label>
                    <input name="name" defaultValue={selectedTitle.name} style={inputStyle()} />
                  </div>

                  <div style={{ minWidth: 180 }}>
                    <label style={labelStyle()}>Active</label>
                    <select name="active" defaultValue={selectedTitle.active ? "1" : "0"} style={inputStyle()}>
                      <option value="1">Active</option>
                      <option value="0">Inactive</option>
                    </select>
                  </div>

                  <div style={{ alignSelf: "end" }}>
                    <button type="submit" style={btnStyle("primary")}>
                      Save
                    </button>
                  </div>
                </div>
              </form>

              <hr style={hrStyle()} />

              <form action={setTitlePermissionsAction} style={{ display: "grid", gap: 12 }}>
                <input type="hidden" name="titleId" value={selectedTitle.id} />

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>Permissions</div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                      Check what this title can access.
                    </div>
                  </div>
                  <button type="submit" style={btnStyle("primary")}>
                    Save Permissions
                  </button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  {allPermissions.map((p) => (
                    <label
                      key={p}
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 10,
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        fontSize: 13,
                      }}
                    >
                      <input
                        type="checkbox"
                        name="perm"
                        value={p}
                        defaultChecked={selectedSet.has(p)}
                      />
                      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                        {p}
                      </span>
                    </label>
                  ))}
                </div>
              </form>

              <hr style={hrStyle()} />

              <form action={deleteTitleAction} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <input type="hidden" name="id" value={selectedTitle.id} />
                <Link href="/admin/access-titles" style={btnStyle("ghost")}>
                  Done
                </Link>
                <button type="submit" style={btnStyle("danger")}>
                  Delete Title
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}