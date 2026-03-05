import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { Permission, Prisma, Role } from "@prisma/client";

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
  includeIgnored?: string;
  focus?: string;
  ok?: string;
};

async function requireReportView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return { perms };

  const ok = hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) redirect("/");

  return { perms };
}

function boolFromQuery(v: string | undefined): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue;
    const t = v.trim();
    if (!t) continue;
    sp.set(k, t);
  }
  const out = sp.toString();
  return out ? `?${out}` : "";
}

function normalizeExternalUrl(v: string | null): string | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

export default async function NeedsOrderingReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { perms } = await requireReportView();
  const canEdit = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);

  const sp = await searchParams;
  const q = String(sp.q ?? "").trim();
  const includeIgnored = boolFromQuery(sp.includeIgnored);
  const focusRaw = String(sp.focus ?? "").trim().toLowerCase();
  const focus: "all" | "red" | "yellow" =
    focusRaw === "red" || focusRaw === "yellow" ? focusRaw : "all";
  const okMsg = String(sp.ok ?? "").trim();

  async function setIgnoredAction(formData: FormData) {
    "use server";

    const { perms } = await requireReportView();
    const canEdit = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
    if (!canEdit) throw new Error("Forbidden");

    const itemId = String(formData.get("itemId") ?? "").trim();
    const nextIgnored = String(formData.get("nextIgnored") ?? "").trim() === "1";

    const qBack = String(formData.get("q") ?? "").trim();
    const includeIgnoredBack = String(formData.get("includeIgnored") ?? "").trim();
    const focusBack = String(formData.get("focus") ?? "").trim();

    if (!itemId) {
      redirect(
        `/admin/reports/needs-ordering${qs({
          q: qBack || undefined,
          includeIgnored: includeIgnoredBack || undefined,
          focus: focusBack || undefined,
          ok: "Missing item id",
        })}`
      );
    }

    await prisma.$executeRaw`
      UPDATE "Item"
      SET "reorderIgnored" = ${nextIgnored},
          "updatedAt" = NOW()
      WHERE "id" = ${itemId}
    `;

    revalidatePath("/admin/reports/needs-ordering");
    redirect(
      `/admin/reports/needs-ordering${qs({
        q: qBack || undefined,
        includeIgnored: includeIgnoredBack || undefined,
        focus: focusBack || undefined,
        ok: nextIgnored ? "Item ignored" : "Item restored",
      })}`
    );
  }

  type NeedsOrderingRow = {
    id: string;
    sku: string;
    partNumber: string | null;
    name: string;
    orderFrom: string | null;
    manufacturer: string | null;
    webUrl: string | null;
    onHandQty: number;
    orderedQty: number;
    minQty: number;
    reorderIgnored: boolean;
  };

  const like = `%${q}%`;
  const rows = await prisma.$queryRaw<NeedsOrderingRow[]>(Prisma.sql`
    SELECT
      "id",
      "sku",
      "partNumber",
      "name",
      "orderFrom",
      "manufacturer",
      "webUrl",
      "onHandQty",
      "orderedQty",
      "minQty",
      "reorderIgnored"
    FROM "Item"
    WHERE "active" = true
      AND "minQty" > 0
      AND "minQty" > ("onHandQty" + "orderedQty")
      AND ${
        q
          ? Prisma.sql`(
              "sku" ILIKE ${like}
              OR "name" ILIKE ${like}
              OR COALESCE("partNumber", '') ILIKE ${like}
              OR COALESCE("orderFrom", '') ILIKE ${like}
              OR COALESCE("manufacturer", '') ILIKE ${like}
            )`
          : Prisma.sql`TRUE`
      }
      AND ${includeIgnored ? Prisma.sql`TRUE` : Prisma.sql`"reorderIgnored" = false`}
    ORDER BY "reorderIgnored" ASC, "sku" ASC
  `);

  const needsOrdering = rows
    .map((item) => {
      const available = item.onHandQty + item.orderedQty;
      const shortBy = Math.max(0, item.minQty - available);
      const priority: "red" | "yellow" = available <= 0 ? "red" : "yellow";
      return { ...item, available, shortBy, priority };
    })
    .filter((item) => item.shortBy > 0)
    .filter((item) => (focus === "all" ? true : item.priority === focus))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === "red" ? -1 : 1;
      return a.sku.localeCompare(b.sku);
    });

  const activeCount = needsOrdering.filter((x) => !x.reorderIgnored).length;
  const ignoredCount = needsOrdering.filter((x) => x.reorderIgnored).length;
  const redCount = needsOrdering.filter((x) => x.priority === "red").length;
  const yellowCount = needsOrdering.filter((x) => x.priority === "yellow").length;

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1300, margin: "0 auto", color: "var(--foreground)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Report: Needs Ordering</h1>

          <Link
            href="/admin/reports"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(128,128,128,0.25)",
              background: "var(--background)",
              color: "var(--foreground)",
              textDecoration: "none",
              fontWeight: 900,
            }}
          >
            ← Report Hub
          </Link>
        </div>

        <div style={{ marginTop: 8, opacity: 0.85, lineHeight: 1.5 }}>
          Items where <code>onHand + ordered &lt; min</code> are listed here. Use Ignore to hide non-actionable rows.
        </div>

        {okMsg ? (
          <div style={{ marginTop: 10, padding: 10, border: "1px solid rgba(128,128,128,0.25)", borderRadius: 10 }}>
            {okMsg}
          </div>
        ) : null}

        <form method="get" style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            name="q"
            defaultValue={q}
            placeholder="Search sku, item, part, supplier..."
            style={{
              minWidth: 280,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(128,128,128,0.25)",
              background: "var(--background)",
              color: "var(--foreground)",
            }}
          />

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" name="includeIgnored" value="1" defaultChecked={includeIgnored} />
            Include ignored
          </label>

          <input type="hidden" name="focus" value={focus} />

          <button
            type="submit"
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(128,128,128,0.25)",
              background: "var(--background)",
              color: "var(--foreground)",
              fontWeight: 900,
            }}
          >
            Apply
          </button>

          <Link href="/admin/reports/needs-ordering" style={{ textDecoration: "underline" }}>
            Reset
          </Link>

          <Link
            href={`/admin/reports/needs-ordering${qs({ q: q || undefined, includeIgnored: includeIgnored ? "1" : undefined, focus: "red" })}`}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: focus === "red" ? "1px solid rgba(220,38,38,0.8)" : "1px solid rgba(220,38,38,0.45)",
              background: focus === "red" ? "rgba(220,38,38,0.2)" : "rgba(220,38,38,0.10)",
              color: "var(--foreground)",
              fontWeight: 900,
              textDecoration: "none",
            }}
          >
            Red Items
          </Link>

          <Link
            href={`/admin/reports/needs-ordering${qs({ q: q || undefined, includeIgnored: includeIgnored ? "1" : undefined, focus: "yellow" })}`}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: focus === "yellow" ? "1px solid rgba(245,158,11,0.85)" : "1px solid rgba(245,158,11,0.5)",
              background: focus === "yellow" ? "rgba(245,158,11,0.22)" : "rgba(245,158,11,0.12)",
              color: "var(--foreground)",
              fontWeight: 900,
              textDecoration: "none",
            }}
          >
            Yellow Items
          </Link>
        </form>

        <div style={{ marginTop: 12, opacity: 0.9 }}>
          Showing <b>{needsOrdering.length}</b> items (Red: <b>{redCount}</b>, Yellow: <b>{yellowCount}</b>, Active: <b>{activeCount}</b>, Ignored: <b>{ignoredCount}</b>)
        </div>

        <div style={{ marginTop: 12, border: "1px solid rgba(128,128,128,0.25)", borderRadius: 10, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {[
                  "SKU",
                  "Item",
                  "Supplier",
                  "Web",
                  "On Hand",
                  "Ordered",
                  "Available",
                  "Min",
                  "Short By",
                  "Status",
                  "Ignore",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "10px",
                      borderBottom: "1px solid rgba(128,128,128,0.25)",
                      whiteSpace: "nowrap",
                      fontSize: 12,
                      opacity: 0.85,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {needsOrdering.map((row) => {
                const itemUrl = normalizeExternalUrl(row.webUrl);
                const highlight =
                  row.priority === "red"
                    ? "rgba(220,38,38,0.12)"
                    : "rgba(245,158,11,0.12)";
                const borderTint =
                  row.priority === "red"
                    ? "rgba(220,38,38,0.22)"
                    : "rgba(245,158,11,0.24)";
                return (
                  <tr
                    key={row.id}
                    style={{
                      borderBottom: `1px solid ${borderTint}`,
                      background: highlight,
                      opacity: row.reorderIgnored ? 0.62 : 1,
                    }}
                  >
                  <td style={{ padding: 10, fontWeight: 800, whiteSpace: "nowrap" }}>{row.sku}</td>
                  <td style={{ padding: 10 }}>
                    <div style={{ fontWeight: 700 }}>{row.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.82 }}>{row.partNumber || "—"}</div>
                  </td>
                  <td style={{ padding: 10 }}>
                    <div>{row.orderFrom || "—"}</div>
                    <div style={{ fontSize: 12, opacity: 0.82 }}>{row.manufacturer || ""}</div>
                  </td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                    {itemUrl ? (
                      <a
                        href={itemUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          padding: "6px 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(128,128,128,0.25)",
                          background: "var(--background)",
                          color: "var(--foreground)",
                          fontWeight: 800,
                          textDecoration: "none",
                          display: "inline-block",
                        }}
                      >
                        Open
                      </a>
                    ) : (
                      <span style={{ opacity: 0.6 }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>{row.onHandQty}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>{row.orderedQty}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>{row.available}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>{row.minQty}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap", fontWeight: 900 }}>{row.shortBy}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                    {row.reorderIgnored ? "Ignored" : row.priority === "red" ? "Out" : "Below Min"}
                  </td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                    {canEdit ? (
                      <form action={setIgnoredAction}>
                        <input type="hidden" name="itemId" value={row.id} />
                        <input type="hidden" name="nextIgnored" value={row.reorderIgnored ? "0" : "1"} />
                        <input type="hidden" name="q" value={q} />
                        <input type="hidden" name="includeIgnored" value={includeIgnored ? "1" : ""} />
                        <input type="hidden" name="focus" value={focus} />
                        <button
                          type="submit"
                          style={{
                            padding: "6px 10px",
                            borderRadius: 10,
                            border: "1px solid rgba(128,128,128,0.25)",
                            background: "var(--background)",
                            color: "var(--foreground)",
                            fontWeight: 800,
                            cursor: "pointer",
                          }}
                        >
                          {row.reorderIgnored ? "Unignore" : "Ignore"}
                        </button>
                      </form>
                    ) : (
                      <span style={{ opacity: 0.65 }}>View only</span>
                    )}
                  </td>
                </tr>
                );
              })}

              {needsOrdering.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ padding: 14, opacity: 0.8 }}>
                    No items currently need ordering for your filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
