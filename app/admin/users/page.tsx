// app/admin/users/page.tsx
import type { CSSProperties } from "react";
import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SearchParams = {
  ok?: string;
  error?: string;

  created?: string; // userId
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

function pickRole(v: string): Role {
  if (v === Role.ADMIN) return Role.ADMIN;
  if (v === Role.MANAGER) return Role.MANAGER;
  return Role.EMPLOYEE;
}

function safeIdsFromFormData(fd: FormData, key: string): string[] {
  const vals = fd.getAll(key);
  const ids = vals.map((x) => String(x).trim()).filter((x) => x.length > 0);

  // de-dupe while preserving order
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

/**
 * Prisma Client type shims:
 * - Keep this page compiling even if Prisma Client types lag behind migrations.
 * - Avoid `any` while permitting fields like `allowedLocations` to exist at runtime.
 */
type LocationRow = { id: string; name: string; active: boolean };

type UserAllowedLocationRow = {
  locationId: string;
  isPrimary: boolean;
  sortOrder: number;
  location?: { id: string; name: string; active?: boolean | null } | null;
};

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: Date;

  // legacy
  locationId: string | null;
  location?: { id: string; name: string; active?: boolean | null } | null;

  // join model relation (schema field name: allowedLocations)
  allowedLocations: UserAllowedLocationRow[];
};

type PrismaUserDelegate = {
  findMany: (args: unknown) => Promise<UserRow[]>;
  findUnique: (args: unknown) => Promise<{ id: string } | null>;
  create: (args: unknown) => Promise<{ id: string }>;
  update: (args: unknown) => Promise<unknown>;
};

type PrismaLocationDelegate = {
  findMany: (args: unknown) => Promise<LocationRow[]>;
};

type PrismaTx = {
  user: PrismaUserDelegate;
  location: PrismaLocationDelegate;
};

const db = prisma as unknown as {
  user: PrismaUserDelegate;
  location: PrismaLocationDelegate;
  $transaction: <T>(fn: (tx: PrismaTx) => Promise<T>) => Promise<T>;
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();

  const sp = await searchParams;
  const ok = (sp.ok ?? "") === "1";
  const error = (sp.error ?? "").trim();
  const created = (sp.created ?? "").trim();

  const [locationsAll, users] = await Promise.all([
    db.location.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: { id: true, name: true, active: true },
    }),
    db.user.findMany({
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,

        // legacy
        locationId: true,
        location: { select: { id: true, name: true } },

        // join relation (schema field name: allowedLocations)
        allowedLocations: {
          select: {
            locationId: true,
            isPrimary: true,
            sortOrder: true,
            location: { select: { id: true, name: true, active: true } },
          },
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { location: { name: "asc" } }],
        },
      },
    }),
  ]);

  const activeLocations = locationsAll.filter((l) => l.active);

  async function createUserAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const name = nonEmpty(formData.get("name"));
    const emailRaw = nonEmpty(formData.get("email"));
    const password = nonEmpty(formData.get("password"));
    const role = pickRole(nonEmpty(formData.get("role")) as string);

    const primaryIds = safeIdsFromFormData(formData, "primaryLocationIds");
    const optionalIds = safeIdsFromFormData(formData, "optionalLocationIds");

    const primaryPicks = parseOrderedGroup(formData, primaryIds, "primaryOrder_");
    const optionalPicks = parseOrderedGroup(formData, optionalIds, "optionalOrder_");

    if (!name) redirect("/admin/users?error=" + encodeURIComponent("Name is required"));
    if (!emailRaw) redirect("/admin/users?error=" + encodeURIComponent("Email is required"));
    if (!password) redirect("/admin/users?error=" + encodeURIComponent("Password is required"));

    const email = emailRaw.toLowerCase();

    // Disallow overlaps
    const overlap = primaryIds.filter((id) => optionalIds.includes(id));
    if (overlap.length > 0) {
      redirect("/admin/users?error=" + encodeURIComponent("A location cannot be both Primary and Optional"));
    }

    // Require at least one Primary to keep legacy `user.locationId` meaningful (and avoid auth regressions).
    if (primaryIds.length === 0) {
      redirect("/admin/users?error=" + encodeURIComponent("At least one Primary location is required."));
    }

    const allSelected = Array.from(new Set([...primaryIds, ...optionalIds]));

    // Enforce: create-user picklists are active-only (reject tampered POSTs selecting inactive)
    if (allSelected.length > 0) {
      const existingActive = await db.location.findMany({
        where: { id: { in: allSelected }, active: true },
        select: { id: true, name: true, active: true },
      } as unknown);

      const found = new Set(existingActive.map((x) => x.id));
      const missingOrInactive = allSelected.filter((id) => !found.has(id));
      if (missingOrInactive.length > 0) {
        redirect("/admin/users?error=" + encodeURIComponent("One or more selected locations are inactive or missing."));
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    let createdUserId: string;
    try {
      const createdUser = await db.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
        if (existing) throw new Error("Email already exists");

        // Deterministic ordering:
        // - If an order number is provided, sort by that (asc)
        // - Else sort by location name (asc)
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

        // Legacy compatibility: first primary after ordering
        const legacyLocationId: string | null = primSorted[0] ?? null;

        const rows: Array<{ locationId: string; isPrimary: boolean; sortOrder: number }> = [];
        // Persist ordering *within each group* (Primary 1..N, Optional 1..N)
        for (let i = 0; i < primSorted.length; i++) {
          rows.push({ locationId: primSorted[i], isPrimary: true, sortOrder: i + 1 });
        }
        for (let i = 0; i < optSorted.length; i++) {
          rows.push({ locationId: optSorted[i], isPrimary: false, sortOrder: i + 1 });
        }

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
      await db.user.update({
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

  async function setPasswordAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const userId = nonEmpty(formData.get("userId"));
    const password = nonEmpty(formData.get("password"));
    const confirm = nonEmpty(formData.get("confirm"));

    if (!userId) redirect("/admin/users?error=" + encodeURIComponent("Missing userId"));
    if (!password) redirect("/admin/users?error=" + encodeURIComponent("Password is required"));
    if (password.length < 8) {
      redirect("/admin/users?error=" + encodeURIComponent("Password must be at least 8 characters"));
    }
    if (password !== confirm) {
      redirect("/admin/users?error=" + encodeURIComponent("Password and confirmation do not match"));
    }

    const passwordHash = await bcrypt.hash(password, 10);

    try {
      await db.user.update({
        where: { id: userId },
        data: { passwordHash },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Password update failed";
      redirect("/admin/users?error=" + encodeURIComponent(msg));
    }

    revalidatePath("/admin/users");
    redirect("/admin/users?ok=1");
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

    // Require at least one Primary to keep legacy `user.locationId` meaningful (and avoid auth regressions).
    if (primaryIds.length === 0) {
      redirect("/admin/users?error=" + encodeURIComponent("At least one Primary location is required."));
    }

    const allSelected = Array.from(new Set([...primaryIds, ...optionalIds]));

    try {
      await db.$transaction(async (tx) => {
        // Ensure user exists + get currently assigned locations (to allow already-assigned inactive)
        const u = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, allowedLocations: { select: { locationId: true } } },
        } as unknown);
        if (!u) throw new Error("User not found");

        const previouslyAssigned = new Set<string>(
          ((u as unknown as { allowedLocations?: Array<{ locationId: string }> }).allowedLocations ?? []).map(
            (r) => r.locationId
          )
        );

        // Validate: selected ids must exist
        if (allSelected.length > 0) {
          const locs = await tx.location.findMany({
            where: { id: { in: allSelected } },
            select: { id: true, name: true, active: true },
          } as unknown);

          const byId = new Map(locs.map((l) => [l.id, l] as const));
          const missing = allSelected.filter((id) => !byId.has(id));
          if (missing.length > 0) {
            throw new Error(`Some locations were not found: ${missing.slice(0, 10).join(", ")}`);
          }

          // Enforce: inactive selections are only allowed if they were already assigned to this user
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
              } as unknown)
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
        for (let i = 0; i < primSorted.length; i++) {
          rows.push({ locationId: primSorted[i], isPrimary: true, sortOrder: i + 1 });
        }
        for (let i = 0; i < optSorted.length; i++) {
          rows.push({ locationId: optSorted[i], isPrimary: false, sortOrder: i + 1 });
        }

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
        } as unknown);
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Assign locations failed";
      redirect("/admin/users?error=" + encodeURIComponent(msg));
    }

    revalidatePath("/admin/users");
    redirect("/admin/users?ok=1");
  }

  const pageWrap: CSSProperties = { padding: 24, maxWidth: 1200, margin: "0 auto" };
  const card: CSSProperties = {
    border: "1px solid rgba(128,128,128,0.25)",
    borderRadius: 10,
    padding: 16,
    background: "var(--background)",
    color: "var(--foreground)",
  };
  const field: CSSProperties = {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(128,128,128,0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
    outline: "none",
  };
  const label: CSSProperties = { display: "grid", gap: 6 };
  const btn: CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(128,128,128,0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
    cursor: "pointer",
    fontWeight: 800,
  };

  function splitLocations(u: UserRow) {
    const primary = (u.allowedLocations ?? []).filter((x) => x.isPrimary);
    const optional = (u.allowedLocations ?? []).filter((x) => !x.isPrimary);
    return { primary, optional };
  }

  function locationLabel(id: string): string {
    const l = locationsAll.find((x) => x.id === id);
    if (!l) return id;
    return l.active ? l.name : `${l.name} (Inactive)`;
  }

  return (
    <div style={pageWrap}>
      <h1 style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>Admin Users</h1>
      <div style={{ opacity: 0.8, marginBottom: 16 }}>
        Manage users, roles, and Primary/Optional locations (pick-lists show Active locations; assigned inactive are
        still visible).
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
        </div>
      ) : null}

      {/* Create user */}
      <div style={{ ...card, marginBottom: 16 }}>
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 900, fontSize: 16 }}>Create New User</summary>

          <div style={{ marginTop: 12 }}>
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
                  <span style={{ fontWeight: 800 }}>Role</span>
                  <select name="role" defaultValue={Role.EMPLOYEE} style={field}>
                    <option value={Role.EMPLOYEE}>EMPLOYEE</option>
                    <option value={Role.MANAGER}>MANAGER</option>
                    <option value={Role.ADMIN}>ADMIN</option>
                  </select>
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>Primary Locations (Active only)</div>
                  <div style={{ display: "grid", gap: 6, maxHeight: 240, overflow: "auto", paddingRight: 6 }}>
                    {activeLocations.map((l) => (
                      <label
                        key={`cprim-${l.id}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "20px 1fr 110px",
                          gap: 10,
                          alignItems: "center",
                        }}
                      >
                        <input type="checkbox" name="primaryLocationIds" value={l.id} />
                        <span>{l.name}</span>
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
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                    Ordering: if you enter an Order #, we sort by it; blanks sort after (by name). We persist order
                    within each group (1..N). Legacy <code>user.locationId</code> is set to the first Primary after
                    ordering.
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>Optional Locations (Active only)</div>
                  <div style={{ display: "grid", gap: 6, maxHeight: 240, overflow: "auto", paddingRight: 6 }}>
                    {activeLocations.map((l) => (
                      <label
                        key={`copt-${l.id}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "20px 1fr 110px",
                          gap: 10,
                          alignItems: "center",
                        }}
                      >
                        <input type="checkbox" name="optionalLocationIds" value={l.id} />
                        <span>{l.name}</span>
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

              <button type="submit" style={{ ...btn, width: 220 }}>
                Create User
              </button>
            </form>
          </div>
        </details>
      </div>

      {/* Users list */}
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

            return (
              <div
                key={u.id}
                style={{
                  border: "1px solid rgba(128,128,128,0.25)",
                  borderRadius: 10,
                  padding: 12,
                  background: "var(--background)",
                  color: "var(--foreground)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontWeight: 900 }}>
                      {u.name}{" "}
                      <span style={{ opacity: 0.75, fontWeight: 700 }}>
                        ({u.role}) {u.active ? "• Active" : "• Disabled"}
                      </span>
                    </div>
                    <div style={{ opacity: 0.85 }}>{u.email}</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      id:{" "}
                      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                        {u.id}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      Legacy locationId:{" "}
                      <span style={{ fontWeight: 800 }}>
                        {legacyName || (u.locationId ? u.locationId : "—")}
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

                    <details>
                      <summary
                        style={{
                          cursor: "pointer",
                          fontWeight: 800,
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(128,128,128,0.25)",
                        }}
                      >
                        Set Password
                      </summary>

                      <div style={{ marginTop: 10, minWidth: 320 }}>
                        <form action={setPasswordAction} style={{ display: "grid", gap: 10 }}>
                          <input type="hidden" name="userId" value={u.id} />

                          <label style={label}>
                            <span style={{ fontWeight: 800 }}>New Password</span>
                            <input name="password" type="password" required style={field} />
                          </label>

                          <label style={label}>
                            <span style={{ fontWeight: 800 }}>Confirm Password</span>
                            <input name="confirm" type="password" required style={field} />
                          </label>

                          <button type="submit" style={{ ...btn, width: 220 }}>
                            Save Password
                          </button>

                          <div style={{ fontSize: 12, opacity: 0.75 }}>
                            The current password cannot be viewed. Setting a new password replaces the old one.
                          </div>
                        </form>
                      </div>
                    </details>
                  </div>
                </div>

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
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "20px 1fr 110px",
                                    gap: 10,
                                    alignItems: "center",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    name="primaryLocationIds"
                                    value={l.id}
                                    defaultChecked={checked}
                                  />
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
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "20px 1fr 110px",
                                    gap: 10,
                                    alignItems: "center",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    name="optionalLocationIds"
                                    value={l.id}
                                    defaultChecked={checked}
                                  />
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

                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <button type="submit" style={{ ...btn, width: 220 }}>
                          Save Locations
                        </button>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>
                          Pick-lists show active locations; inactive locations can only remain if already assigned.
                          Ordering: we sort by Order # (ascending) then by name; blanks sort after by name. We persist
                          order within each group (1..N). Legacy <code>user.locationId</code> becomes the first Primary
                          after ordering.
                        </div>
                      </div>
                    </form>
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


