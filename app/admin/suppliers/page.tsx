import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Prisma, Role } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { ADMIN_EDIT_SUPPLIERS, ADMIN_VIEW_SUPPLIERS } from "@/app/lib/permission-constants";
import {
  filterSupplierDirectory,
  loadSupplierDirectory,
  parseSupplierDirection,
  parseSupplierSort,
  sortSupplierDirectory,
} from "@/app/lib/supplier-directory";
import { cleanSupplierDisplayName, findSupplierByNormalizedKey, normalizeSupplierKey } from "@/app/lib/suppliers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

type SearchParams = {
  q?: string;
  sort?: string;
  dir?: string;
  ok?: string;
  error?: string;
};

async function requireSupplierAccess() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return { session, perms };

  const ok = hasAnyPermission(perms, [ADMIN_VIEW_SUPPLIERS, ADMIN_EDIT_SUPPLIERS]);
  if (!ok) redirect("/");

  return { session, perms };
}

function formString(formData: FormData, key: string, max = 1000): string | null {
  const value = String(formData.get(key) ?? "").trim().replace(/\s+/g, " ");
  return value ? value.slice(0, max) : null;
}

function formText(formData: FormData, key: string, max = 5000): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value ? value.slice(0, max) : null;
}

function splitAliases(value: string | null): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const part of value.split(/[\n,]+/g)) {
    const alias = cleanSupplierDisplayName(part);
    const key = normalizeSupplierKey(alias);
    if (!alias || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }

  return out;
}

class SupplierNameConflictError extends Error {}
class SupplierNotFoundError extends Error {}

function supplierSaveErrorMessage(error: unknown): string {
  if (error instanceof SupplierNameConflictError) {
    return "A supplier or alternate name already uses that name.";
  }
  if (error instanceof SupplierNotFoundError) {
    return "That supplier no longer exists. Refresh the page and try again.";
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return "A supplier or alternate name already uses that name.";
    }
    if (error.code === "P2025") {
      return "That supplier no longer exists. Refresh the page and try again.";
    }
  }

  return "Supplier could not be saved. Please try again.";
}

async function saveSupplierAction(formData: FormData) {
  "use server";

  const { perms } = await requireSupplierAccess();
  if (!perms.allowAll && !hasAnyPermission(perms, [ADMIN_EDIT_SUPPLIERS])) {
    redirect("/admin/suppliers?error=You%20do%20not%20have%20permission%20to%20edit%20suppliers.");
  }

  try {
    const id = formString(formData, "id", 100);
    const name = formString(formData, "name", 160);
    if (!name) throw new Error("Supplier name is required.");

    const normalizedKey = normalizeSupplierKey(name);
    if (!normalizedKey) throw new Error("Supplier name is required.");

    const paymentMethod = formString(formData, "paymentMethod", 80);
    const terms = formText(formData, "terms", 1000);
    const accountNumber = formString(formData, "accountNumber", 120);
    const phone = formString(formData, "phone", 60);
    const extension = formString(formData, "extension", 40);
    const email = formString(formData, "email", 160);
    const partsSummary = formText(formData, "partsSummary", 3000);
    const notes = formText(formData, "notes", 5000);
    const aliases = splitAliases(formText(formData, "aliases", 3000));

    await prisma.$transaction(async (tx) => {
      const existing = id
        ? await tx.supplier.findUnique({ where: { id }, select: { id: true } })
        : null;
      if (id && !existing) throw new SupplierNotFoundError();

      const nameOwner = await findSupplierByNormalizedKey(tx, normalizedKey);
      if (nameOwner && nameOwner.id !== existing?.id) {
        throw new SupplierNameConflictError();
      }

      const supplier = existing
        ? await tx.supplier.update({
            where: { id: existing.id },
            data: {
              name,
              normalizedKey,
              paymentMethod,
              terms,
              accountNumber,
              phone,
              extension,
              email,
              partsSummary,
              notes,
            },
            select: { id: true },
          })
        : await tx.supplier.create({
            data: {
              name,
              normalizedKey,
              paymentMethod,
              terms,
              accountNumber,
              phone,
              extension,
              email,
              partsSummary,
              notes,
            },
            select: { id: true },
          });

      const aliasNames = [name, ...aliases];
      for (const aliasName of aliasNames) {
        const aliasKey = normalizeSupplierKey(aliasName);
        if (!aliasKey) continue;

        const aliasOwner = await findSupplierByNormalizedKey(tx, aliasKey);
        if (aliasOwner && aliasOwner.id !== supplier.id) {
          throw new SupplierNameConflictError();
        }

        await tx.supplierAlias.upsert({
          where: { normalizedKey: aliasKey },
          update: { supplierId: supplier.id, name: aliasName },
          create: { supplierId: supplier.id, name: aliasName, normalizedKey: aliasKey },
        });
      }
    });

    revalidatePath("/admin/suppliers");
    revalidatePath("/admin/inventory-orders");
    revalidatePath("/admin/items");
  } catch (error) {
    const prismaCode = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
    console.error("[admin/suppliers] Supplier save failed", {
      prismaCode,
      error,
    });
    redirect(`/admin/suppliers?error=${encodeURIComponent(supplierSaveErrorMessage(error))}`);
  }

  redirect("/admin/suppliers?ok=1");
}

function fmtDate(d: Date | null): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(d);
}

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { perms } = await requireSupplierAccess();
  const canEditSuppliers = perms.allowAll || hasAnyPermission(perms, [ADMIN_EDIT_SUPPLIERS]);
  const sp = (await searchParams) ?? {};
  const query = String(sp.q ?? "").trim();
  const sort = parseSupplierSort(sp.sort);
  const direction = parseSupplierDirection(sp.dir);
  const suppliers = sortSupplierDirectory(filterSupplierDirectory(await loadSupplierDirectory(prisma), query), sort, direction);

  const buildHref = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const q = next.q ?? query;
    const sortValue = next.sort ?? sort;
    const dirValue = next.dir ?? direction;
    if (q) params.set("q", q);
    if (sortValue !== "name") params.set("sort", sortValue);
    if (dirValue !== "asc") params.set("dir", dirValue);
    const qs = params.toString();
    return qs ? `/admin/suppliers?${qs}` : "/admin/suppliers";
  };

  const exportHref = (() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (sort !== "name") params.set("sort", sort);
    if (direction !== "asc") params.set("dir", direction);
    const qs = params.toString();
    return qs ? `/admin/suppliers/export?${qs}` : "/admin/suppliers/export";
  })();

  const border = "1px solid var(--border)";
  const surface = "var(--surface)";
  const soft = "color-mix(in srgb, var(--surface-2) 82%, transparent)";

  const input: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
  };

  const label: CSSProperties = {
    display: "grid",
    gap: 6,
    fontSize: 12,
    fontWeight: 800,
    color: "var(--muted)",
  };

  const button: CSSProperties = {
    border,
    background: "linear-gradient(160deg, var(--brand-2) 0%, var(--brand) 100%)",
    color: "var(--brand-contrast)",
    fontWeight: 900,
    padding: "10px 14px",
    cursor: "pointer",
  };

  return (
    <main>
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Suppliers</h1>
            <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
              Supplier profiles, aliases, and parts bought from each supplier.
            </p>
          </div>
          <Link href="/admin/inventory-orders" style={{ textDecoration: "none", border, borderRadius: 10, padding: "10px 12px", fontWeight: 900 }}>
            Inventory Orders
          </Link>
        </div>

        {sp.ok ? (
          <div style={{ border, borderRadius: 10, padding: 10, background: "var(--success-bg)", fontWeight: 800 }}>Supplier saved.</div>
        ) : null}
        {sp.error ? (
          <div style={{ border: "1px solid var(--danger-border)", borderRadius: 10, padding: 10, background: "var(--danger-bg)", fontWeight: 800 }}>
            {sp.error}
          </div>
        ) : null}

        {canEditSuppliers ? (
          <details style={{ border, borderRadius: 10, background: surface, padding: 14 }}>
            <summary style={{ cursor: "pointer", listStyle: "none" }}>
              <h2 style={{ margin: 0, fontSize: 18, display: "inline" }}>Add Supplier</h2>
            </summary>
            <form action={saveSupplierAction} style={{ marginTop: 12, display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <label style={label}>
                  Supplier name
                  <input name="name" required placeholder="Amazon" style={input} />
                </label>
                <label style={label}>
                  Payment type
                  <select name="paymentMethod" defaultValue="" style={input}>
                    <option value="">Not set</option>
                    <option value="Credit card">Credit card</option>
                    <option value="Charge account">Charge account</option>
                    <option value="Both">Both</option>
                    <option value="Other">Other</option>
                  </select>
                </label>
                <label style={label}>
                  Account number
                  <input name="accountNumber" placeholder="Account #" style={input} />
                </label>
                <label style={label}>
                  Terms
                  <input name="terms" placeholder="Net 30, COD, card-only..." style={input} />
                </label>
                <label style={label}>
                  Phone
                  <input name="phone" placeholder="Phone number" style={input} />
                </label>
                <label style={label}>
                  Extension
                  <input name="extension" placeholder="Ext." style={input} />
                </label>
                <label style={label}>
                  Email
                  <input name="email" type="email" placeholder="orders@example.com" style={input} />
                </label>
              </div>
              <label style={label}>
                Alternate names
                <textarea name="aliases" rows={2} placeholder="Amazon.com, AMAZON" style={{ ...input, resize: "vertical" }} />
              </label>
              <label style={label}>
                Parts from this supplier
                <textarea name="partsSummary" rows={3} placeholder="Oven parts, filters, smallwares..." style={{ ...input, resize: "vertical" }} />
              </label>
              <label style={label}>
                Notes
                <textarea name="notes" rows={3} placeholder="Ordering notes, login hints, contact preferences..." style={{ ...input, resize: "vertical" }} />
              </label>
              <button type="submit" style={button}>Save Supplier</button>
            </form>
          </details>
        ) : null}

        <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search suppliers, parts, account, email..." style={{ flex: "1 1 280px" }} />
          <label style={{ ...label, minWidth: 180 }}>
            Sort by
            <select name="sort" defaultValue={sort} style={input}>
              <option value="name">Supplier name</option>
              <option value="profile">Profile status</option>
              <option value="orders">Order count</option>
              <option value="latest">Latest order</option>
              <option value="payment">Payment type</option>
              <option value="terms">Terms</option>
            </select>
          </label>
          <label style={{ ...label, minWidth: 140 }}>
            Direction
            <select name="dir" defaultValue={direction} style={input}>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
          <button type="submit" style={{ ...button, background: soft, color: "var(--foreground)" }}>Search</button>
          <Link href="/admin/suppliers" style={{ textDecoration: "none", border, borderRadius: 10, padding: "10px 12px", fontWeight: 900 }}>
            Clear
          </Link>
          <Link href={exportHref} style={{ textDecoration: "none", border, borderRadius: 10, padding: "10px 12px", fontWeight: 900 }}>
            Export CSV
          </Link>
        </form>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: "var(--muted)" }}>
          <span>{suppliers.length} suppliers</span>
          <Link href={buildHref({ sort: "name", dir: "asc" })} style={{ color: "inherit" }}>Name</Link>
          <Link href={buildHref({ sort: "orders", dir: "desc" })} style={{ color: "inherit" }}>Most orders</Link>
          <Link href={buildHref({ sort: "latest", dir: "desc" })} style={{ color: "inherit" }}>Latest order</Link>
          <Link href={buildHref({ sort: "profile", dir: "asc" })} style={{ color: "inherit" }}>Profiles first</Link>
        </div>

        <section style={{ display: "grid", gap: 12 }}>
          {suppliers.map((supplier) => {
            const aliasText = supplier.aliases;
            const partText = supplier.partLabels;

            return (
              <details key={supplier.key} style={{ border, borderRadius: 10, background: surface, overflow: "hidden" }}>
                <summary
                  style={{
                    padding: 12,
                    cursor: "pointer",
                    listStyle: "none",
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) 130px 130px",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 18, fontWeight: 950, overflowWrap: "anywhere" }}>{supplier.displayName}</span>
                      <span style={{ display: "block", marginTop: 3, color: "var(--muted)", fontSize: 12, overflowWrap: "anywhere" }}>
                        {supplier.hasProfile ? "Profile saved" : "From order history"} | Aliases: {aliasText.slice(0, 4).join(", ") || "-"}
                      </span>
                    </span>
                    <span style={{ fontWeight: 900 }}>{supplier.orderCount} orders</span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>Latest: {fmtDate(supplier.latestOrderAt)}</span>
                </summary>

                <div style={{ borderTop: border, padding: 12, display: "grid", gap: 12, background: soft }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
                    <Info label="Payment">{supplier.paymentMethod || "-"}</Info>
                    <Info label="Terms">{supplier.terms || "-"}</Info>
                    <Info label="Account #">{supplier.accountNumber || "-"}</Info>
                    <Info label="Phone">{supplier.phone || "-"}</Info>
                    <Info label="Extension">{supplier.extension || "-"}</Info>
                    <Info label="Email">{supplier.email || "-"}</Info>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
                    <div style={{ border, borderRadius: 10, background: surface, padding: 10 }}>
                      <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 900 }}>Parts seen from this supplier</div>
                      <div style={{ marginTop: 8, display: "grid", gap: 5, fontSize: 13 }}>
                        {partText.slice(0, 18).map((part) => (
                          <div key={part}>{part}</div>
                        ))}
                        {partText.length > 18 ? <div style={{ color: "var(--muted)" }}>+ {partText.length - 18} more</div> : null}
                        {partText.length === 0 ? <div style={{ color: "var(--muted)" }}>No linked parts yet.</div> : null}
                      </div>
                    </div>

                    {canEditSuppliers ? (
                      <form action={saveSupplierAction} style={{ border, borderRadius: 10, background: surface, padding: 10, display: "grid", gap: 10 }}>
                        <input type="hidden" name="id" value={supplier.supplierId ?? ""} />
                        <div style={{ fontWeight: 950 }}>{supplier.hasProfile ? "Edit supplier" : "Save profile"}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                          <label style={label}>
                            Supplier name
                            <input name="name" required defaultValue={supplier.displayName} style={input} />
                          </label>
                          <label style={label}>
                            Payment type
                            <select name="paymentMethod" defaultValue={supplier.paymentMethod ?? ""} style={input}>
                              <option value="">Not set</option>
                              <option value="Credit card">Credit card</option>
                              <option value="Charge account">Charge account</option>
                              <option value="Both">Both</option>
                              <option value="Other">Other</option>
                            </select>
                          </label>
                          <label style={label}>
                            Account number
                            <input name="accountNumber" defaultValue={supplier.accountNumber ?? ""} style={input} />
                          </label>
                          <label style={label}>
                            Terms
                            <input name="terms" defaultValue={supplier.terms ?? ""} style={input} />
                          </label>
                          <label style={label}>
                            Phone
                            <input name="phone" defaultValue={supplier.phone ?? ""} style={input} />
                          </label>
                          <label style={label}>
                            Extension
                            <input name="extension" defaultValue={supplier.extension ?? ""} style={input} />
                          </label>
                          <label style={label}>
                            Email
                            <input name="email" type="email" defaultValue={supplier.email ?? ""} style={input} />
                          </label>
                        </div>
                        <label style={label}>
                          Alternate names
                          <textarea name="aliases" rows={2} defaultValue={aliasText.join(", ")} style={{ ...input, resize: "vertical" }} />
                        </label>
                        <label style={label}>
                          Parts from this supplier
                          <textarea
                            name="partsSummary"
                            rows={3}
                            defaultValue={supplier.partsSummary ?? ""}
                            style={{ ...input, resize: "vertical" }}
                          />
                        </label>
                        <label style={label}>
                          Notes
                          <textarea name="notes" rows={3} defaultValue={supplier.notes ?? ""} style={{ ...input, resize: "vertical" }} />
                        </label>
                        <button type="submit" style={button}>Save</button>
                      </form>
                    ) : null}
                  </div>
                </div>
              </details>
            );
          })}

          {suppliers.length === 0 ? (
            <div style={{ border, borderRadius: 10, padding: 14, background: surface, color: "var(--muted)" }}>
              No suppliers found.
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--surface)" }}>
      <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 900 }}>{label}</div>
      <div style={{ marginTop: 4, fontWeight: 850, overflowWrap: "anywhere" }}>{children}</div>
    </div>
  );
}
