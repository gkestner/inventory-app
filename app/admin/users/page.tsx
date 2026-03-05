// app/admin/users/page.tsx
import type { CSSProperties } from "react";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SearchParams = {
  ok?: string; // "1"
  error?: string;

  created?: string; // userId
  resetUser?: string; // userId
  temp?: string; // temporary password (one-time display, only when generated)
};

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const role = (session.user as unknown as { role?: Role | null } | null)?.role ?? null;
  if (role !== Role.ADMIN) redirect("/");
  return session;
}

function nonEmpty(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

/**
 * ✅ Safe Role picker
 * - Works whether or not your Prisma Role enum includes MAINTENANCE
 * - Never triggers ts-expect-error build failures
 */
function pickRole(v: string): Role {
  const roles = new Set<string>(Object.values(Role) as string[]);
  const wanted = String(v ?? "").trim();

  if (wanted === Role.ADMIN) return Role.ADMIN;
  if (wanted === Role.MANAGER) return Role.MANAGER;

  if (roles.has("MAINTENANCE") && wanted === "MAINTENANCE") {
    return "MAINTENANCE" as Role;
  }

  return Role.EMPLOYEE;
}

function safeIdsFromFormData(fd: FormData, key: string): string[] {
  const vals = fd.getAll(key);
  const ids = vals.map((x) => String(x).trim()).filter((x) => x.length > 0);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function toPositiveIntOrNull(v: FormDataEntryValue | null): number | null {
  if (v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i > 0 ? i : null;
}

type OrderedPick = { id: string; order: number | null };

function parseOrderedGroup(formData: FormData, ids: string[], orderPrefix: string): OrderedPick[] {
  return ids.map((id) => ({
    id,
    order: toPositiveIntOrNull(formData.get(`${orderPrefix}${id}`)),
  }));
}

function makeTempPassword(): string {
  return crypto.randomBytes(9).toString("base64url"); // ~12 chars
}

function safePermissionTitleIdsFromFormData(fd: FormData): string[] {
  return safeIdsFromFormData(fd, "permissionTitleIds");
}

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  const sp = await searchParams;
  const ok = (sp.ok ?? "") === "1";
  const error = (sp.error ?? "").trim();
  const created = (sp.created ?? "").trim();
  const resetUser = (sp.resetUser ?? "").trim();
  const temp = (sp.temp ?? "").trim();

  const [locationsAll, allTitles] = await Promise.all([
    prisma.location.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: { id: true, name: true, active: true },
    }),
    prisma.permissionTitle.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: { id: true, name: true, description: true, active: true },
    }),
  ]);

  const users = await prisma.user.findMany({
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,

      locationId: true,
      location: { select: { id: true, name: true, active: true } },

      allowedLocations: {
        select: {
          locationId: true,
          isPrimary: true,
          sortOrder: true,
          location: { select: { id: true, name: true, active: true } },
        },
        orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { location: { name: "asc" } }],
      },

      permissionTitles: {
        select: {
          titleId: true,
          title: { select: { id: true, name: true, active: true } },
          assignedAt: true,
        },
        orderBy: [{ title: { name: "asc" } }],
      },
    },
  });

  const activeLocations = locationsAll.filter((l) => l.active);
  const hasActiveLocations = activeLocations.length > 0;
  const locationChoicesForCreate = hasActiveLocations ? activeLocations : locationsAll;
  const canCreateUser = locationChoicesForCreate.length > 0;

  async function createUserAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const name = nonEmpty(formData.get("name"));
    const emailRaw = nonEmpty(formData.get("email"));
    const password = nonEmpty(formData.get("password"));
    const role = pickRole(nonEmpty(formData.get("role")));

    const primaryIds = safeIdsFromFormData(formData, "primaryLocationIds");
    const optionalIds = safeIdsFromFormData(formData, "optionalLocationIds");

    const primaryPicks = parseOrderedGroup(formData, primaryIds, "primaryOrder_");
    const optionalPicks = parseOrderedGroup(formData, optionalIds, "optionalOrder_");

    if (!name) redirect("/admin/users?error=" + encodeURIComponent("Name is required"));
    if (!emailRaw) redirect("/admin/users?error=" + encodeURIComponent("Email is required"));
    if (!password) redirect("/admin/users?error=" + encodeURIComponent("Password is required"));

    const email = emailRaw.toLowerCase();

    const overlap = primaryIds.filter((id) => optionalIds.includes(id));
    if (overlap.length > 0) {
      redirect("/admin/users?error=" + encodeURIComponent("A location cannot be both Primary and Optional"));
    }

    if (primaryIds.length === 0) {
      redirect("/admin/users?error=" + encodeURIComponent("At least one Primary location is required."));
    }

    const allSelected = Array.from(new Set([...primaryIds, ...optionalIds]));

    if (allSelected.length > 0) {
      const [existingAll, activeCountRows] = await Promise.all([
        prisma.location.findMany({
          where: { id: { in: allSelected } },
          select: { id: true, name: true, active: true },
        }),
        prisma.location.findMany({
          where: { active: true },
          select: { id: true },
        }),
      ]);

      const foundAll = new Set(existingAll.map((x) => x.id));
      const missing = allSelected.filter((id) => !foundAll.has(id));
      if (missing.length > 0) {
        redirect("/admin/users?error=" + encodeURIComponent("One or more selected locations are missing."));
      }

      const hasAnyActiveLocations = activeCountRows.length > 0;
      if (hasAnyActiveLocations) {
        const activeIds = new Set(existingAll.filter((x) => x.active).map((x) => x.id));
        const inactiveSelected = allSelected.filter((id) => !activeIds.has(id));
        if (inactiveSelected.length > 0) {
          redirect(
            "/admin/users?error=" +
              encodeURIComponent("Inactive locations cannot be newly assigned while active locations exist.")
          );
        }
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    let createdUserId: string;
    try {
      const createdUser = await prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
        if (existing) throw new Error("Email already exists");

        const locs =
          allSelected.length > 0
            ? await tx.location.findMany({
                where: { id: { in: allSelected } },
                select: { id: true, name: true, active: true },
                orderBy: { name: "asc" },
              })
            : [];
        const byId = new Map(locs.map((l) => [l.id, l] as const));

        const sortPicks = (picks: OrderedPick[]) => {
          const copy = [...picks];
          copy.sort((a, b) => {
            const ao = a.order;
            const bo = b.order;
            if (ao != null && bo != null && ao !== bo) return ao - bo;
            if (ao != null && bo == null) return -1;
            if (ao == null && bo != null) return 1;
            const an = byId.get(a.id)?.name ?? "";
            const bn = byId.get(b.id)?.name ?? "";
            return an.localeCompare(bn);
          });
          return copy.map((x) => x.id);
        };

        const primSorted = sortPicks(primaryPicks);
        const optSorted = sortPicks(optionalPicks);

        const legacyLocationId: string | null = primSorted[0] ?? null;

        const rows: Array<{ locationId: string; isPrimary: boolean; sortOrder: number }> = [];
        for (let i = 0; i < primSorted.length; i++)
          rows.push({ locationId: primSorted[i], isPrimary: true, sortOrder: i + 1 });
        for (let i = 0; i < optSorted.length; i++)
          rows.push({ locationId: optSorted[i], isPrimary: false, sortOrder: i + 1 });

        const u = await tx.user.create({
          data: {
            name,
            email,
            passwordHash,
            role,
            active: true,
            locationId: legacyLocationId,
            ...(rows.length > 0
              ? {
                  allowedLocations: {
                    createMany: {
                      data: rows.map((r) => ({
                        locationId: r.locationId,
                        isPrimary: r.isPrimary,
                        sortOrder: r.sortOrder,
                      })),
                    },
                  },
                }
              : {}),
          },
          select: { id: true },
        });

        return u;
      });

      createdUserId = createdUser.id;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Create failed";
      redirect("/admin/users?error=" + encodeURIComponent(msg));
    }

    revalidatePath("/admin/users");
    redirect(`/admin/users?ok=1&created=${encodeURIComponent(createdUserId)}`);
  }

  async function toggleActiveAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const userId = nonEmpty(formData.get("userId"));
    const nextActiveRaw = nonEmpty(formData.get("nextActive"));
    const nextActive = nextActiveRaw === "true";

    if (!userId) redirect("/admin/users?error=" + encodeURIComponent("Missing userId"));

    try {
      await prisma.user.update({
        where: { id: userId },
        data: { active: nextActive },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Update failed";
      redirect("/admin/users?error=" + encodeURIComponent(msg));
    }

    revalidatePath("/admin/users");
    redirect("/admin/users?ok=1");
  }

  // ✅ UPDATED: allow admin-entered password (with confirm). If blank, generate temp like before.
  async function resetPasswordAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const userId = nonEmpty(formData.get("userId"));
    if (!userId) redirect("/admin/users?error=" + encodeURIComponent("Missing userId"));

    const newPassword = nonEmpty(formData.get("newPassword"));
    const confirmPassword = nonEmpty(formData.get("confirmPassword"));

    const adminProvided = Boolean(newPassword || confirmPassword);

    let finalPassword: string;
    if (adminProvided) {
      if (!newPassword || !confirmPassword) {
        redirect("/admin/users?error=" + encodeURIComponent("Enter both New Password and Confirm Password."));
      }
      if (newPassword !== confirmPassword) {
        redirect("/admin/users?error=" + encodeURIComponent("New Password and Confirm Password do not match."));
      }
      if (newPassword.length < 8) {
        redirect("/admin/users?error=" + encodeURIComponent("Password must be at least 8 characters."));
      }
      finalPassword = newPassword;
    } else {
      finalPassword = makeTempPassword();
    }

    const passwordHash = await bcrypt.hash(finalPassword, 10);

    try {
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Reset failed";
      redirect("/admin/users?error=" + encodeURIComponent(msg));
    }

    revalidatePath("/admin/users");

    // Only show password in URL when we generated it (one-time display).
    if (adminProvided) {
      redirect(`/admin/users?ok=1&resetUser=${encodeURIComponent(userId)}`);
    }

    redirect(`/admin/users?ok=1&resetUser=${encodeURIComponent(userId)}&temp=${encodeURIComponent(finalPassword)}`);
  }

  async function assignLocationsAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const userId = nonEmpty(formData.get("userId"));
    if (!userId) redirect("/admin/users?error=" + encodeURIComponent("Missing userId"));

    const primaryIds = safeIdsFromFormData(formData, "primaryLocationIds");
    const optionalIds = safeIdsFromFormData(formData, "optionalLocationIds");

    const primaryPicks = parseOrderedGroup(formData, primaryIds, "primaryOrder_");
    const optionalPicks = parseOrderedGroup(formData, optionalIds, "optionalOrder_");

    const overlap = primaryIds.filter((id) => optionalIds.includes(id));
    if (overlap.length > 0) {
      redirect("/admin/users?error=" + encodeURIComponent("A location cannot be both Primary and Optional"));
    }

    if (primaryIds.length === 0) {
      redirect("/admin/users?error=" + encodeURIComponent("At least one Primary location is required."));
    }

    const allSelected = Array.from(new Set([...primaryIds, ...optionalIds]));

    try {
      await prisma.$transaction(async (tx) => {
        const u = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, allowedLocations: { select: { locationId: true } } },
        });
        if (!u) throw new Error("User not found");

        const previouslyAssigned = new Set<string>((u.allowedLocations ?? []).map((r) => r.locationId));

        if (allSelected.length > 0) {
          const locs = await tx.location.findMany({
            where: { id: { in: allSelected } },
            select: { id: true, name: true, active: true },
          });

          const byId = new Map(locs.map((l) => [l.id, l] as const));
          const missing = allSelected.filter((id) => !byId.has(id));
          if (missing.length > 0) {
            throw new Error(`Some locations were not found: ${missing.slice(0, 10).join(", ")}`);
          }

          const inactiveSelected = allSelected.filter((id) => byId.get(id)?.active === false);
          const badInactive = inactiveSelected.filter((id) => !previouslyAssigned.has(id));
          if (badInactive.length > 0) {
            throw new Error("Inactive locations cannot be newly assigned. Reactivate them first if needed.");
          }
        }

        const locsForSort =
          allSelected.length > 0
            ? await tx.location.findMany({
                where: { id: { in: allSelected } },
                select: { id: true, name: true, active: true },
                orderBy: { name: "asc" },
              })
            : [];
        const byId = new Map(locsForSort.map((l) => [l.id, l] as const));

        const sortPicks = (picks: OrderedPick[]) => {
          const copy = [...picks];
          copy.sort((a, b) => {
            const ao = a.order;
            const bo = b.order;
            if (ao != null && bo != null && ao !== bo) return ao - bo;
            if (ao != null && bo == null) return -1;
            if (ao == null && bo != null) return 1;
            const an = byId.get(a.id)?.name ?? "";
            const bn = byId.get(b.id)?.name ?? "";
            return an.localeCompare(bn);
          });
          return copy.map((x) => x.id);
        };

        const primSorted = sortPicks(primaryPicks);
        const optSorted = sortPicks(optionalPicks);

        const legacyLocationId: string | null = primSorted[0] ?? null;

        const rows: Array<{ locationId: string; isPrimary: boolean; sortOrder: number }> = [];
        for (let i = 0; i < primSorted.length; i++)
          rows.push({ locationId: primSorted[i], isPrimary: true, sortOrder: i + 1 });
        for (let i = 0; i < optSorted.length; i++)
          rows.push({ locationId: optSorted[i], isPrimary: false, sortOrder: i + 1 });

        await tx.user.update({
          where: { id: userId },
          data: {
            locationId: legacyLocationId,
            allowedLocations: {
              deleteMany: {},
              ...(rows.length > 0
                ? {
                    createMany: {
                      data: rows.map((r) => ({
                        locationId: r.locationId,
                        isPrimary: r.isPrimary,
                        sortOrder: r.sortOrder,
                      })),
                    },
                  }
                : {}),
            },
          },
        });
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Assign locations failed";
      redirect("/admin/users?error=" + encodeURIComponent(msg));
    }

    revalidatePath("/admin/users");
    redirect("/admin/users?ok=1");
  }

  // ✅ FIXED: allow-list titleIds + skipDuplicates
  async function assignPermissionTitlesAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const userId = nonEmpty(formData.get("userId"));
    if (!userId) redirect("/admin/users?error=" + encodeURIComponent("Missing userId"));

    const selectedIds = safePermissionTitleIdsFromFormData(formData);

    try {
      await prisma.$transaction(async (tx) => {
        const u = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!u) throw new Error("User not found");

        // allow-list against DB
        let finalIds: string[] = [];
        if (selectedIds.length > 0) {
          const existing = await tx.permissionTitle.findMany({
            where: { id: { in: selectedIds } },
            select: { id: true },
          });
          const found = new Set(existing.map((x) => x.id));
          finalIds = selectedIds.filter((id) => found.has(id));
        }

        await tx.userPermissionTitle.deleteMany({ where: { userId } });

        if (finalIds.length > 0) {
          await tx.userPermissionTitle.createMany({
            data: finalIds.map((titleId) => ({ userId, titleId })),
            skipDuplicates: true,
          });
        }
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Assign permission titles failed";
      redirect("/admin/users?error=" + encodeURIComponent(msg));
    }

    revalidatePath("/admin/users");
    redirect("/admin/users?ok=1");
  }

  const pageWrap: CSSProperties = { padding: 24, maxWidth: 1200, margin: "0 auto" };
  const card: CSSProperties = {
    border: "1px solid rgba(128, 128, 128, 0.25)",
    borderRadius: 10,
    padding: 16,
    background: "var(--background)",
    color: "var(--foreground)",
  };
  const field: CSSProperties = {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(128, 128, 128, 0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
    outline: "none",
  };
  const label: CSSProperties = { display: "grid", gap: 6 };
  const btn: CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(128, 128, 128, 0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
    cursor: "pointer",
    fontWeight: 800,
  };

  function splitLocations(u: (typeof users)[number]) {
    const primary = (u.allowedLocations ?? []).filter((x) => x.isPrimary);
    const optional = (u.allowedLocations ?? []).filter((x) => !x.isPrimary);
    return { primary, optional };
  }

  function locationLabel(id: string): string {
    const l = locationsAll.find((x) => x.id === id);
    if (!l) return id;
    return l.active ? l.name : `${l.name} (Inactive)`;
  }

  const createOpen = Boolean(error || created);
  const roleOptions = Object.values(Role) as Role[];

  return (
    <div style={pageWrap}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>Admin Users</h1>
          <div style={{ opacity: 0.8, marginBottom: 16 }}>
            Manage users, locations, and Permission Titles (RBAC templates).
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/admin/access-titles" style={{ ...btn, textDecoration: "none", display: "inline-block" }}>
            Permission Titles
          </Link>
        </div>
      </div>

      {error ? (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Error</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{error}</div>
        </div>
      ) : null}

      {ok ? (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>✅ Saved</div>
          {created ? <div>Created user id: {created}</div> : null}
          {resetUser ? <div>Password reset for user id: {resetUser}</div> : null}
          {resetUser && temp ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 900 }}>Temporary password (show once):</div>
              <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>{temp}</div>
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                This is only displayed via the URL after reset. Copy it now.
              </div>
            </div>
          ) : null}
          {resetUser && !temp ? (
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
              Admin-entered password was set (not displayed).
            </div>
          ) : null}
        </div>
      ) : null}

      <details style={{ ...card, marginBottom: 16 }} open={createOpen}>
        <summary style={{ cursor: "pointer", fontWeight: 900, listStylePosition: "inside", fontSize: 16 }}>Create User</summary>

        <div style={{ marginTop: 10 }}>
          <form action={createUserAction} style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={label}>
                <span style={{ fontWeight: 800 }}>Name</span>
                <input name="name" required style={field} />
              </label>

              <label style={label}>
                <span style={{ fontWeight: 800 }}>Email</span>
                <input name="email" type="email" required style={field} />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={label}>
                <span style={{ fontWeight: 800 }}>Password</span>
                <input name="password" type="password" required style={field} />
              </label>

              <label style={label}>
                <span style={{ fontWeight: 800 }}>Role (legacy enum)</span>
                <select name="role" defaultValue={Role.EMPLOYEE} style={field}>
                  {roleOptions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Primary Locations (active preferred)</div>
                <div style={{ display: "grid", gap: 6, maxHeight: 240, overflow: "auto", paddingRight: 6 }}>
                  {locationChoicesForCreate.map((l) => (
                    <label
                      key={`cprim-${l.id}`}
                      style={{ display: "grid", gridTemplateColumns: "20px 1fr 110px", gap: 10, alignItems: "center" }}
                    >
                      <input type="checkbox" name="primaryLocationIds" value={l.id} />
                      <span>{l.active ? l.name : `${l.name} (Inactive)`}</span>
                      <input
                        name={`primaryOrder_${l.id}`}
                        type="number"
                        min={1}
                        step={1}
                        placeholder="Order #"
                        style={field}
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Optional Locations (active preferred)</div>
                <div style={{ display: "grid", gap: 6, maxHeight: 240, overflow: "auto", paddingRight: 6 }}>
                  {locationChoicesForCreate.map((l) => (
                    <label
                      key={`copt-${l.id}`}
                      style={{ display: "grid", gridTemplateColumns: "20px 1fr 110px", gap: 10, alignItems: "center" }}
                    >
                      <input type="checkbox" name="optionalLocationIds" value={l.id} />
                      <span>{l.active ? l.name : `${l.name} (Inactive)`}</span>
                      <input
                        name={`optionalOrder_${l.id}`}
                        type="number"
                        min={1}
                        step={1}
                        placeholder="Order #"
                        style={field}
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <button type="submit" disabled={!canCreateUser} style={{ ...btn, width: 220, opacity: canCreateUser ? 1 : 0.5 }}>
              {canCreateUser ? "Create User" : "Create User (needs location)"}
            </button>
          </form>
        </div>
      </details>

      <div style={card}>
        <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 10 }}>Users</h2>

        <div style={{ display: "grid", gap: 12 }}>
          {users.map((u) => {
            const { primary, optional } = splitLocations(u);
            const legacyName = u.location?.name ?? "";

            const primaryOrderById = new Map(primary.map((x, idx) => [x.locationId, idx + 1] as const));
            const optionalOrderById = new Map(optional.map((x, idx) => [x.locationId, idx + 1] as const));

            const checkedPrimary = new Set(primary.map((x) => x.locationId));
            const checkedOptional = new Set(optional.map((x) => x.locationId));

            const primaryChoices = locationsAll.filter((l) => l.active || checkedPrimary.has(l.id));
            const optionalChoices = locationsAll.filter((l) => l.active || checkedOptional.has(l.id));

            const currentTitleIds = new Set(u.permissionTitles.map((r) => r.titleId));

            // show active titles + any inactive already assigned (so you can remove them)
            const permissionTitles = allTitles.filter((t) => t.active || currentTitleIds.has(t.id));

            return (
              <details
                key={u.id}
                style={{
                  border: "1px solid rgba(128,128,128,0.25)",
                  borderRadius: 10,
                  padding: 12,
                  background: "var(--background)",
                  color: "var(--foreground)",
                }}
              >
                <summary style={{ cursor: "pointer", fontWeight: 900, listStylePosition: "inside" }}>
                  {u.name}{" "}
                  <span style={{ opacity: 0.75, fontWeight: 700 }}>
                    ({u.role}) {u.active ? "• Active" : "• Disabled"}
                  </span>
                </summary>

                <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ opacity: 0.85 }}>{u.email}</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      id:{" "}
                      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                        {u.id}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      Legacy locationId: <span style={{ fontWeight: 800 }}>{legacyName || (u.locationId ? u.locationId : "—")}</span>
                    </div>

                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      Permission Titles:{" "}
                      <span style={{ fontWeight: 800 }}>
                        {u.permissionTitles.length ? u.permissionTitles.map((r) => r.title?.name ?? "").filter(Boolean).join(", ") : "—"}
                      </span>
                    </div>

                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <form action={toggleActiveAction}>
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="nextActive" value={u.active ? "false" : "true"} />
                      <button type="submit" style={btn}>
                        {u.active ? "Disable" : "Enable"}
                      </button>
                    </form>

                    {/* ✅ UPDATED UI: type a new password (optional). Leave blank to auto-generate. */}
                    <form action={resetPasswordAction} style={{ display: "grid", gap: 6, alignItems: "start" }}>
                      <input type="hidden" name="userId" value={u.id} />

                      <div style={{ display: "grid", gridTemplateColumns: "170px 170px", gap: 8 }}>
                        <input
                          name="newPassword"
                          type="password"
                          placeholder="New password (optional)"
                          style={field}
                          autoComplete="new-password"
                        />
                        <input
                          name="confirmPassword"
                          type="password"
                          placeholder="Confirm password"
                          style={field}
                          autoComplete="new-password"
                        />
                      </div>

                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button type="submit" style={btn}>
                          Reset Password
                        </button>
                      </div>

                      <div style={{ fontSize: 12, opacity: 0.7, textAlign: "right" }}>
                        Leave blank to generate a temporary password.
                      </div>
                    </form>
                  </div>
                </div>

                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 900 }}>Assign Permission Titles</summary>

                  <div style={{ marginTop: 10 }}>
                    {permissionTitles.length === 0 ? (
                      <div style={{ fontSize: 13, opacity: 0.8 }}>
                        No Permission Titles exist yet. Create one in{" "}
                        <a href="/admin/access-titles" style={{ textDecoration: "underline" }}>
                          Permission Titles
                        </a>
                        .
                      </div>
                    ) : (
                      <form action={assignPermissionTitlesAction} style={{ display: "grid", gap: 12 }}>
                        <input type="hidden" name="userId" value={u.id} />

                        <div style={{ display: "grid", gap: 6, maxHeight: 220, overflow: "auto", paddingRight: 6 }}>
                          {permissionTitles.map((t) => (
                            <label key={`pt-${u.id}-${t.id}`} style={{ display: "grid", gridTemplateColumns: "20px 1fr", gap: 10 }}>
                              <input type="checkbox" name="permissionTitleIds" value={t.id} defaultChecked={currentTitleIds.has(t.id)} />
                              <span>
                                <span style={{ fontWeight: 900 }}>{t.name}</span>{" "}
                                {!t.active ? <span style={{ opacity: 0.75 }}>(Inactive)</span> : null}
                                {t.description ? <span style={{ opacity: 0.75 }}> — {t.description}</span> : null}
                              </span>
                            </label>
                          ))}
                        </div>

                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <button type="submit" style={{ ...btn, width: 240 }}>
                            Save Permission Titles
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </details>

                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>Primary ({primary.length})</div>
                    <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
                      {primary.length ? (
                        primary.map((x) => (
                          <div key={`${u.id}-p-${x.locationId}-${x.sortOrder}`}>
                            • {locationLabel(x.locationId)}{" "}
                            <span style={{ opacity: 0.7 }}>(order #{primaryOrderById.get(x.locationId) ?? "—"})</span>
                          </div>
                        ))
                      ) : (
                        <div style={{ opacity: 0.7 }}>—</div>
                      )}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>Optional ({optional.length})</div>
                    <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
                      {optional.length ? (
                        optional.map((x) => (
                          <div key={`${u.id}-o-${x.locationId}-${x.sortOrder}`}>
                            • {locationLabel(x.locationId)}{" "}
                            <span style={{ opacity: 0.7 }}>(order #{optionalOrderById.get(x.locationId) ?? "—"})</span>
                          </div>
                        ))
                      ) : (
                        <div style={{ opacity: 0.7 }}>—</div>
                      )}
                    </div>
                  </div>
                </div>

                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 900 }}>Assign Locations</summary>

                  <div style={{ marginTop: 10 }}>
                    <form action={assignLocationsAction} style={{ display: "grid", gap: 12 }}>
                      <input type="hidden" name="userId" value={u.id} />

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div>
                          <div style={{ fontWeight: 900, marginBottom: 6 }}>Primary Locations</div>
                          <div style={{ display: "grid", gap: 6, maxHeight: 210, overflow: "auto", paddingRight: 6 }}>
                            {primaryChoices.map((l) => {
                              const checked = checkedPrimary.has(l.id);
                              return (
                                <label
                                  key={`prim-${u.id}-${l.id}`}
                                  style={{ display: "grid", gridTemplateColumns: "20px 1fr 110px", gap: 10, alignItems: "center" }}
                                >
                                  <input type="checkbox" name="primaryLocationIds" value={l.id} defaultChecked={checked} />
                                  <span>{l.active ? l.name : `${l.name} (Inactive)`}</span>
                                  <input
                                    name={`primaryOrder_${l.id}`}
                                    type="number"
                                    min={1}
                                    step={1}
                                    placeholder="Order #"
                                    defaultValue={primaryOrderById.get(l.id) ?? ""}
                                    style={field}
                                  />
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <div style={{ fontWeight: 900, marginBottom: 6 }}>Optional Locations</div>
                          <div style={{ display: "grid", gap: 6, maxHeight: 210, overflow: "auto", paddingRight: 6 }}>
                            {optionalChoices.map((l) => {
                              const checked = checkedOptional.has(l.id);
                              return (
                                <label
                                  key={`opt-${u.id}-${l.id}`}
                                  style={{ display: "grid", gridTemplateColumns: "20px 1fr 110px", gap: 10, alignItems: "center" }}
                                >
                                  <input type="checkbox" name="optionalLocationIds" value={l.id} defaultChecked={checked} />
                                  <span>{l.active ? l.name : `${l.name} (Inactive)`}</span>
                                  <input
                                    name={`optionalOrder_${l.id}`}
                                    type="number"
                                    min={1}
                                    step={1}
                                    placeholder="Order #"
                                    defaultValue={optionalOrderById.get(l.id) ?? ""}
                                    style={field}
                                  />
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        <button type="submit" style={{ ...btn, width: 220 }}>
                          Save Locations
                        </button>
                      </div>
                    </form>
                  </div>
                </details>
              </details>
            );
          })}
        </div>
      </div>
    </div>
  );
}