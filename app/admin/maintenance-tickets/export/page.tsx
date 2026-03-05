// app/admin/maintenance-tickets/export/page.tsx
import { authOptions } from "@/app/lib/auth";
import { canAccessAdmin } from "@/app/lib/admin-access";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { PartsCheckoutStatus } from "@prisma/client";
import type { Session } from "next-auth";

export const dynamic = "force-dynamic";

type SearchParams = {
  status?: string; // OPEN | INVOICED | VOIDED | all
  after?: string; // YYYY-MM-DD or ISO
  before?: string; // YYYY-MM-DD or ISO
  q?: string;
};

type AdminSession = Session & {
  user: Session["user"];
};

async function requireAdmin(): Promise<AdminSession> {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!(await canAccessAdmin(session))) redirect("/");
  return session;
}

function normStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isStatus(v: string): v is PartsCheckoutStatus {
  return Object.values(PartsCheckoutStatus).includes(v as PartsCheckoutStatus);
}

export default async function MaintenanceTicketsExportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const statusRaw = normStr(sp.status) || "INVOICED";
  const status = statusRaw === "all" ? "all" : isStatus(statusRaw) ? statusRaw : "INVOICED";

  const after = normStr(sp.after);
  const before = normStr(sp.before);
  const q = normStr(sp.q);

  const qs = new URLSearchParams();
  qs.set("status", status);
  if (after) qs.set("after", after);
  if (before) qs.set("before", before);
  if (q) qs.set("q", q);

  const downloadHref = `/api/admin/maintenance-tickets/export?${qs.toString()}`;

  return (
    <main style={{ padding: 16, maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, fontWeight: 900 }}>Export Maintenance Tickets</h1>
      <p style={{ marginTop: 6, opacity: 0.8 }}>
        Exports a CSV from <code>/api/admin/maintenance-tickets/export</code>.
      </p>

      <form
        action="/admin/maintenance-tickets/export"
        method="get"
        style={{
          marginTop: 16,
          display: "grid",
          gap: 12,
          padding: 12,
          borderRadius: 12,
          border: "1px solid var(--border, rgba(0,0,0,0.2))",
          background: "var(--card, transparent)",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 800 }}>Status</span>
            <select
              name="status"
              defaultValue={status}
              style={{
                padding: 10,
                borderRadius: 10,
                border: "1px solid var(--border, rgba(0,0,0,0.2))",
                background: "var(--input, transparent)",
                color: "inherit",
              }}
            >
              <option value="INVOICED">INVOICED (default)</option>
              <option value="OPEN">OPEN</option>
              <option value="VOIDED">VOIDED</option>
              <option value="all">All</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 800 }}>Search (optional)</span>
            <input
              name="q"
              defaultValue={q}
              placeholder="Ticket ID, store, tech, SKU, part #, item name…"
              style={{
                padding: 10,
                borderRadius: 10,
                border: "1px solid var(--border, rgba(0,0,0,0.2))",
                background: "var(--input, transparent)",
                color: "inherit",
              }}
            />
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 800 }}>After (createdAt ≥)</span>
            <input
              name="after"
              defaultValue={after}
              placeholder="YYYY-MM-DD (or ISO)"
              style={{
                padding: 10,
                borderRadius: 10,
                border: "1px solid var(--border, rgba(0,0,0,0.2))",
                background: "var(--input, transparent)",
                color: "inherit",
              }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 800 }}>Before (createdAt &lt;)</span>
            <input
              name="before"
              defaultValue={before}
              placeholder="YYYY-MM-DD (or ISO)"
              style={{
                padding: 10,
                borderRadius: 10,
                border: "1px solid var(--border, rgba(0,0,0,0.2))",
                background: "var(--input, transparent)",
                color: "inherit",
              }}
            />
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="submit"
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--border, rgba(0,0,0,0.2))",
              background: "var(--button, transparent)",
              color: "inherit",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Apply Filters
          </button>

          <a
            href={downloadHref}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--border, rgba(0,0,0,0.2))",
              background: "var(--button, transparent)",
              color: "inherit",
              fontWeight: 900,
              textDecoration: "none",
            }}
          >
            Download CSV
          </a>
        </div>

        <div style={{ opacity: 0.75, fontSize: 13 }}>
          Download URL: <code>{downloadHref}</code>
        </div>
      </form>
    </main>
  );
}
