import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

type SearchParams = {
  from?: string;
  to?: string;
  includeVoided?: string;
};

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

function parseDateStart(v: string | undefined): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateEnd(v: string | undefined): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(`${s}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function boolParam(v: string | undefined): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

async function requireReportAccess() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [ADMIN_VIEW_REPORT_PARTS_CONSUMPTION_COSTS])) {
    redirect("/");
  }
}

export default async function PartsConsumptionCostsReportPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requireReportAccess();

  const sp = (await searchParams) ?? {};
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = parseDateStart(sp.from) ?? defaultFrom;
  const to = parseDateEnd(sp.to) ?? now;
  const includeVoided = boolParam(sp.includeVoided);
  const exportHref = `/api/admin/reports/parts-consumption-costs/export?from=${encodeURIComponent(
    from.toISOString().slice(0, 10)
  )}&to=${encodeURIComponent(to.toISOString().slice(0, 10))}&includeVoided=${includeVoided ? "1" : "0"}`;

  const rows = await prisma.partsCheckoutTicket.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      ...(includeVoided ? {} : { status: { not: "VOIDED" } }),
    },
    orderBy: { createdAt: "desc" },
    take: 6000,
    select: {
      id: true,
      status: true,
      storeName: true,
      skuSnapshot: true,
      partNumberSnapshot: true,
      nameSnapshot: true,
      quantity: true,
      costSnapshot: true,
      createdAt: true,
      createdByName: true,
    },
  });

  const byStore = new Map<string, { qty: number; cost: number; lines: number }>();
  const byItem = new Map<string, { sku: string; partNumber: string; name: string; qty: number; cost: number; lines: number }>();

  for (const row of rows) {
    const estCost = Number(row.costSnapshot ?? 0) * row.quantity;

    const s = byStore.get(row.storeName) ?? { qty: 0, cost: 0, lines: 0 };
    s.qty += row.quantity;
    s.cost += estCost;
    s.lines += 1;
    byStore.set(row.storeName, s);

    const key = `${row.skuSnapshot}::${row.partNumberSnapshot ?? ""}`;
    const i = byItem.get(key) ?? {
      sku: row.skuSnapshot,
      partNumber: row.partNumberSnapshot ?? "",
      name: row.nameSnapshot,
      qty: 0,
      cost: 0,
      lines: 0,
    };
    i.qty += row.quantity;
    i.cost += estCost;
    i.lines += 1;
    byItem.set(key, i);
  }

  const storeRows = Array.from(byStore.entries())
    .map(([store, v]) => ({ store, ...v }))
    .sort((a, b) => b.cost - a.cost);

  const itemRows = Array.from(byItem.values()).sort((a, b) => b.cost - a.cost);

  const border = "1px solid var(--border)";

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1300, margin: "0 auto", display: "grid", gap: 12 }}>
        <section style={{ border, borderRadius: 14, background: "var(--surface)", padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Parts Consumption + Cost</h1>
            <Link href="/admin/reports" style={{ textDecoration: "none", fontWeight: 800 }}>
              Back to Reports
            </Link>
            <Link href={exportHref} style={{ textDecoration: "none", fontWeight: 800 }}>
              Export CSV
            </Link>
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
            Estimated spend is calculated as quantity x checkout cost snapshot.
          </p>
        </section>

        <form method="get" style={{ border, borderRadius: 14, background: "var(--surface)", padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <label>
              From
              <input type="date" name="from" defaultValue={from.toISOString().slice(0, 10)} />
            </label>
            <label>
              To
              <input type="date" name="to" defaultValue={to.toISOString().slice(0, 10)} />
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" name="includeVoided" value="1" defaultChecked={includeVoided} />
              Include voided tickets
            </label>
          </div>
          <button type="submit" style={{ width: 180, padding: "9px 12px", borderRadius: 10, border, fontWeight: 800 }}>
            Run Report
          </button>
        </form>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <article style={{ border, borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Ticket Lines</div>
            <div style={{ fontSize: 30, fontWeight: 900 }}>{rows.length}</div>
          </article>
          <article style={{ border, borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Estimated Cost</div>
            <div style={{ fontSize: 30, fontWeight: 900 }}>${itemRows.reduce((sum, i) => sum + i.cost, 0).toFixed(2)}</div>
          </article>
        </section>

        <section style={{ border, borderRadius: 14, background: "var(--surface)", overflow: "auto" }}>
          <h2 style={{ margin: 0, padding: 12, borderBottom: border, fontSize: 18, fontWeight: 900 }}>By Store</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Store", "Qty", "Lines", "Est Cost"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: border }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {storeRows.map((s) => (
                <tr key={s.store}>
                  <td style={{ padding: 10, borderBottom: border, fontWeight: 800 }}>{s.store}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{s.qty}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{s.lines}</td>
                  <td style={{ padding: 10, borderBottom: border }}>${s.cost.toFixed(2)}</td>
                </tr>
              ))}
              {storeRows.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 12, color: "var(--muted)" }}>
                    No rows in selected date range.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        <section style={{ border, borderRadius: 14, background: "var(--surface)", overflow: "auto" }}>
          <h2 style={{ margin: 0, padding: 12, borderBottom: border, fontSize: 18, fontWeight: 900 }}>Top Items By Cost</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["SKU", "Part #", "Name", "Qty", "Lines", "Est Cost"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: border }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itemRows.slice(0, 200).map((i) => (
                <tr key={`${i.sku}::${i.partNumber}`}>
                  <td style={{ padding: 10, borderBottom: border }}>{i.sku}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{i.partNumber || "-"}</td>
                  <td style={{ padding: 10, borderBottom: border, fontWeight: 800 }}>{i.name}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{i.qty}</td>
                  <td style={{ padding: 10, borderBottom: border }}>{i.lines}</td>
                  <td style={{ padding: 10, borderBottom: border }}>${i.cost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
