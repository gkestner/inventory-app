import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Role } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { ADMIN_EDIT_SUPPLIERS, ADMIN_VIEW_SUPPLIERS } from "@/app/lib/permission-constants";
import { cleanSupplierDisplayName, normalizeSupplierKey } from "@/app/lib/suppliers";

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
  ok?: string;
  error?: string;
};

type SupplierBucket = {
  key: string;
  displayName: string;
  supplierId: string | null;
  paymentMethod: string | null;
  terms: string | null;
  accountNumber: string | null;
  phone: string | null;
  extension: string | null;
  email: string | null;
  partsSummary: string | null;
  notes: string | null;
  aliases: Set<string>;
  partLabels: Set<string>;
  orderCount: number;
  latestOrderAt: Date | null;
  hasProfile: boolean;
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

async function saveSupplierAction(formData: FormData) {
  "use server";

  let redirectTo = "/admin/suppliers?ok=1";

  try {
    const { perms } = await requireSupplierAccess();
    if (!perms.allowAll && !hasAnyPermission(perms, [ADMIN_EDIT_SUPPLIERS])) {
      throw new Error("You do not have permission to edit suppliers.");
    }

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
        : await tx.supplier.findUnique({ where: { normalizedKey }, select: { id: true } });

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
    const message = error instanceof Error ? error.message : "Supplier save failed.";
    redirectTo = `/admin/suppliers?error=${encodeURIComponent(message)}`;
  }

  redirect(redirectTo);
}

function addNameToBucket(buckets: Map<string, SupplierBucket>, rawName: string | null | undefined): SupplierBucket | null {
  const displayName = cleanSupplierDisplayName(rawName);
  const key = normalizeSupplierKey(displayName);
  if (!displayName || !key) return null;

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = {
      key,
      displayName,
      supplierId: null,
      paymentMethod: null,
      terms: null,
      accountNumber: null,
      phone: null,
      extension: null,
      email: null,
      partsSummary: null,
      notes: null,
      aliases: new Set<string>(),
      partLabels: new Set<string>(),
      orderCount: 0,
      latestOrderAt: null,
      hasProfile: false,
    };
    buckets.set(key, bucket);
  }

  bucket.aliases.add(displayName);
  return bucket;
}

function partLabel(item: { sku: string; partNumber: string | null; name: string }): string {
  return `${item.sku}${item.partNumber ? ` - ${item.partNumber}` : ""} - ${item.name}`;
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
  const query = String(sp.q ?? "").trim().toLowerCase();

  const [profiles, orderRows, itemRows] = await Promise.all([
    prisma.supplier.findMany({
      include: { aliases: { orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    }),
    prisma.inventoryOrder.findMany({
      where: {
        supplierName: { not: null },
      },
      select: {
        supplierName: true,
        orderedAt: true,
        item: { select: { sku: true, partNumber: true, name: true } },
      },
      orderBy: { orderedAt: "desc" },
    }),
    prisma.item.findMany({
      where: {
        orderFrom: { not: null },
      },
      select: {
        orderFrom: true,
        sku: true,
        partNumber: true,
        name: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const buckets = new Map<string, SupplierBucket>();

  for (const supplier of profiles) {
    const bucket = addNameToBucket(buckets, supplier.name);
    if (!bucket) continue;

    bucket.displayName = supplier.name;
    bucket.supplierId = supplier.id;
    bucket.paymentMethod = supplier.paymentMethod;
    bucket.terms = supplier.terms;
    bucket.accountNumber = supplier.accountNumber;
    bucket.phone = supplier.phone;
    bucket.extension = supplier.extension;
    bucket.email = supplier.email;
    bucket.partsSummary = supplier.partsSummary;
    bucket.notes = supplier.notes;
    bucket.hasProfile = true;

    for (const alias of supplier.aliases) {
      bucket.aliases.add(alias.name);
    }
  }

  for (const order of orderRows) {
    const bucket = addNameToBucket(buckets, order.supplierName);
    if (!bucket) continue;
    bucket.orderCount += 1;
    if (!bucket.latestOrderAt || order.orderedAt > bucket.latestOrderAt) bucket.latestOrderAt = order.orderedAt;
    if (order.item) bucket.partLabels.add(partLabel(order.item));
  }

  for (const item of itemRows) {
    const bucket = addNameToBucket(buckets, item.orderFrom);
    if (!bucket) continue;
    bucket.partLabels.add(partLabel(item));
  }

  const suppliers = Array.from(buckets.values())
    .filter((supplier) => {
      if (!query) return true;
      const haystack = [
        supplier.displayName,
        ...supplier.aliases,
        supplier.paymentMethod,
        supplier.accountNumber,
        supplier.phone,
        supplier.email,
        supplier.partsSummary,
        supplier.notes,
        ...supplier.partLabels,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => {
      if (a.hasProfile !== b.hasProfile) return a.hasProfile ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });

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
          <section style={{ border, borderRadius: 10, background: surface, padding: 14 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Add Supplier</h2>
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
          </section>
        ) : null}

        <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search suppliers, parts, account, email..." style={{ flex: "1 1 280px" }} />
          <button type="submit" style={{ ...button, background: soft, color: "var(--foreground)" }}>Search</button>
          <Link href="/admin/suppliers" style={{ textDecoration: "none", border, borderRadius: 10, padding: "10px 12px", fontWeight: 900 }}>
            Clear
          </Link>
        </form>

        <section style={{ display: "grid", gap: 12 }}>
          {suppliers.map((supplier) => {
            const aliasText = Array.from(supplier.aliases).sort((a, b) => a.localeCompare(b));
            const partText = Array.from(supplier.partLabels).sort((a, b) => a.localeCompare(b));

            return (
              <details key={supplier.key} style={{ border, borderRadius: 10, background: surface, overflow: "hidden" }}>
                <summary style={{ padding: 12, cursor: "pointer", listStyle: "none" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 130px 130px", gap: 10, alignItems: "center" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 18, fontWeight: 950, overflowWrap: "anywhere" }}>{supplier.displayName}</div>
                      <div style={{ marginTop: 3, color: "var(--muted)", fontSize: 12, overflowWrap: "anywhere" }}>
                        {supplier.hasProfile ? "Profile saved" : "From order history"} | Aliases: {aliasText.slice(0, 4).join(", ") || "-"}
                      </div>
                    </div>
                    <div style={{ fontWeight: 900 }}>{supplier.orderCount} orders</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>Latest: {fmtDate(supplier.latestOrderAt)}</div>
                  </div>
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
