import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission, Role } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { computeAverageResolutionHours } from "@/app/lib/maintenance-requests";
import { ADMIN_VIEW_MAINTENANCE_REQUESTS } from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  status?: string;
  locationId?: string;
  requestedByUserId?: string;
  assignedTo?: string;
  resolvedByUserId?: string;
  dateField?: string;
  from?: string;
  to?: string;
};

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

type Db = {
  maintenanceRequest: {
    findMany: (args: unknown) => Promise<
      Array<{
        id: string;
        status: "OPEN" | "RESOLVED" | "ARCHIVED";
        createdAt: Date;
        resolvedAt: Date | null;
        archivedAt: Date | null;
        updatedAt: Date;
        title: string;
        description: string;
        resolutionNotes: string | null;
        location: { id: string; name: string };
        requestedByUser: { id: string; name: string | null; email: string | null };
        assignedMaintenanceUser: { id: string; name: string | null; email: string | null } | null;
        resolvedByUser: { id: string; name: string | null; email: string | null } | null;
      }>
    >;
  };
  location: {
    findMany: (args: unknown) => Promise<Array<{ id: string; name: string }>>;
  };
  user: {
    findMany: (args: unknown) => Promise<Array<{ id: string; name: string; email: string }>>;
  };
  auditLog: {
    findMany: (args: unknown) => Promise<
      Array<{
        id: string;
        action: string;
        message: string | null;
        createdAt: Date;
        entityId: string | null;
        actorUser: { name: string | null; email: string | null } | null;
      }>
    >;
  };
};

const db = prisma as unknown as Db;

async function requireReportsView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  const ok = hasAnyPermission(perms, [ADMIN_VIEW_MAINTENANCE_REQUESTS]);
  if (!ok) redirect("/");
}

function personLabel(person: { name: string | null; email: string | null } | null | undefined): string {
  if (!person) return "Unassigned";
  return String(person.name ?? "").trim() || String(person.email ?? "").trim() || "Unknown";
}

function fmtDateTime(value: Date | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function parseDateStart(v: string | undefined): Date | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  const d = new Date(`${raw}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateEnd(v: string | undefined): Date | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  const d = new Date(`${raw}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeStatus(v: string | undefined): "all" | "OPEN" | "RESOLVED" | "ARCHIVED" {
  const raw = String(v ?? "all").trim().toUpperCase();
  if (raw === "OPEN" || raw === "RESOLVED" || raw === "ARCHIVED") return raw;
  return "all";
}

function normalizeDateField(v: string | undefined): "createdAt" | "resolvedAt" | "archivedAt" | "updatedAt" {
  const raw = String(v ?? "createdAt").trim();
  if (raw === "resolvedAt" || raw === "archivedAt" || raw === "updatedAt") return raw;
  return "createdAt";
}

export default async function MaintenanceRequestReportsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requireReportsView();

  const sp = (await searchParams) ?? {};
  const q = String(sp.q ?? "").trim();
  const status = normalizeStatus(sp.status);
  const locationId = String(sp.locationId ?? "").trim();
  const requestedByUserId = String(sp.requestedByUserId ?? "").trim();
  const assignedTo = String(sp.assignedTo ?? "all").trim();
  const resolvedByUserId = String(sp.resolvedByUserId ?? "").trim();
  const dateField = normalizeDateField(sp.dateField);
  const from = parseDateStart(sp.from);
  const to = parseDateEnd(sp.to);
  const exportHref = `/api/admin/reports/excel?report=maintenance-requests&q=${encodeURIComponent(q)}&status=${encodeURIComponent(
    status
  )}&locationId=${encodeURIComponent(locationId)}&requestedByUserId=${encodeURIComponent(requestedByUserId)}&assignedTo=${encodeURIComponent(
    assignedTo
  )}&resolvedByUserId=${encodeURIComponent(resolvedByUserId)}&dateField=${encodeURIComponent(dateField)}&from=${encodeURIComponent(
    String(sp.from ?? "")
  )}&to=${encodeURIComponent(String(sp.to ?? ""))}`;

  const dateFilter = from || to ? { [dateField]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};
  const assignedFilter =
    assignedTo === "all"
      ? {}
      : assignedTo === "unassigned"
        ? { assignedMaintenanceUserId: null }
        : { assignedMaintenanceUserId: assignedTo };

  const where = {
    ...(status === "all" ? {} : { status }),
    ...(locationId ? { locationId } : {}),
    ...(requestedByUserId ? { requestedByUserId } : {}),
    ...assignedFilter,
    ...(resolvedByUserId ? { resolvedByUserId } : {}),
    ...dateFilter,
    ...(q
      ? {
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { resolutionNotes: { contains: q, mode: "insensitive" } },
            { location: { name: { contains: q, mode: "insensitive" } } },
            { requestedByUser: { name: { contains: q, mode: "insensitive" } } },
            { requestedByUser: { email: { contains: q, mode: "insensitive" } } },
            { assignedMaintenanceUser: { name: { contains: q, mode: "insensitive" } } },
            { assignedMaintenanceUser: { email: { contains: q, mode: "insensitive" } } },
            { resolvedByUser: { name: { contains: q, mode: "insensitive" } } },
            { resolvedByUser: { email: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [rows, auditRows, locations, users] = await Promise.all([
    db.maintenanceRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: {
        id: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
        archivedAt: true,
        updatedAt: true,
        title: true,
        description: true,
        resolutionNotes: true,
        location: { select: { id: true, name: true } },
        requestedByUser: { select: { id: true, name: true, email: true } },
        assignedMaintenanceUser: { select: { id: true, name: true, email: true } },
        resolvedByUser: { select: { id: true, name: true, email: true } },
      },
    }),
    db.auditLog.findMany({
      where: { module: "MAINTENANCE_REQUESTS" },
      orderBy: { createdAt: "desc" },
      take: 150,
      select: {
        id: true,
        action: true,
        message: true,
        createdAt: true,
        entityId: true,
        actorUser: { select: { name: true, email: true } },
      },
    }),
    db.location.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } }),
  ]);

  const total = rows.length;
  const open = rows.filter((r) => r.status === "OPEN").length;
  const resolved = rows.filter((r) => r.status === "RESOLVED").length;
  const archived = rows.filter((r) => r.status === "ARCHIVED").length;

  const avgResolutionHours = computeAverageResolutionHours(rows.map((r) => ({ createdAt: r.createdAt, resolvedAt: r.resolvedAt })));

  const byLocation = Array.from(
    rows.reduce((acc, row) => {
      const key = row.location.name;
      acc.set(key, (acc.get(key) ?? 0) + 1);
      return acc;
    }, new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]);

  const byTech = Array.from(
    rows.reduce((acc, row) => {
      const key = personLabel(row.assignedMaintenanceUser);
      acc.set(key, (acc.get(key) ?? 0) + 1);
      return acc;
    }, new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]);

  const border = "1px solid rgba(128,128,128,0.25)";

  return (
    <main>
      <div style={{ maxWidth: 1260, margin: "0 auto", display: "grid", gap: 12 }}>
        <section style={{ border: "1px solid var(--border)", borderRadius: 16, background: "var(--surface)", boxShadow: "var(--shadow)", padding: 18 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 950 }}>Maintenance Request Reports</h1>
            <Link href="/admin/reports" style={{ textDecoration: "none", fontWeight: 800 }}>
              {"<- Reports Hub"}
            </Link>
            <Link href="/admin/maintenance-requests" style={{ textDecoration: "none", fontWeight: 800 }}>
              {"Queue ->"}
            </Link>
            <Link href={exportHref} style={{ textDecoration: "none", fontWeight: 800 }}>
              Export Excel
            </Link>
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
            Audit and trend reporting for maintenance requests, assignment load, and closeout pace.
          </p>
        </section>

        <section style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: 12 }}>
          <form method="get" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
              <input
                name="q"
                defaultValue={q}
                placeholder="Search ID, title, description, notes, names, emails..."
                style={{ padding: "10px 12px", borderRadius: 10, border }}
              />

              <select name="status" defaultValue={status} style={{ padding: "10px 12px", borderRadius: 10, border }}>
                <option value="all">All Statuses</option>
                <option value="OPEN">OPEN</option>
                <option value="RESOLVED">RESOLVED</option>
                <option value="ARCHIVED">ARCHIVED</option>
              </select>

              <select name="locationId" defaultValue={locationId} style={{ padding: "10px 12px", borderRadius: 10, border }}>
                <option value="">All Locations</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>

              <select name="requestedByUserId" defaultValue={requestedByUserId} style={{ padding: "10px 12px", borderRadius: 10, border }}>
                <option value="">All Requesters</option>
                {users.map((user) => (
                  <option key={`requested-${user.id}`} value={user.id}>
                    {user.name || user.email}
                  </option>
                ))}
              </select>

              <select name="assignedTo" defaultValue={assignedTo} style={{ padding: "10px 12px", borderRadius: 10, border }}>
                <option value="all">All Assignees</option>
                <option value="unassigned">Unassigned Only</option>
                {users.map((user) => (
                  <option key={`assigned-${user.id}`} value={user.id}>
                    {user.name || user.email}
                  </option>
                ))}
              </select>

              <select name="resolvedByUserId" defaultValue={resolvedByUserId} style={{ padding: "10px 12px", borderRadius: 10, border }}>
                <option value="">All Resolvers</option>
                {users.map((user) => (
                  <option key={`resolved-${user.id}`} value={user.id}>
                    {user.name || user.email}
                  </option>
                ))}
              </select>

              <select name="dateField" defaultValue={dateField} style={{ padding: "10px 12px", borderRadius: 10, border }}>
                <option value="createdAt">Filter Date: Created</option>
                <option value="resolvedAt">Filter Date: Resolved</option>
                <option value="archivedAt">Filter Date: Archived</option>
                <option value="updatedAt">Filter Date: Updated</option>
              </select>

              <input name="from" type="date" defaultValue={String(sp.from ?? "")} style={{ padding: "10px 12px", borderRadius: 10, border }} />
              <input name="to" type="date" defaultValue={String(sp.to ?? "")} style={{ padding: "10px 12px", borderRadius: 10, border }} />
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="submit" style={{ padding: "10px 12px", borderRadius: 10, border, fontWeight: 900 }}>
                Apply Filters
              </button>
              <Link href="/admin/reports/maintenance-requests" style={{ textDecoration: "underline" }}>
                Reset
              </Link>
              <div style={{ opacity: 0.82 }}>
                Results: <b>{rows.length}</b>
              </div>
            </div>
          </form>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <article style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ opacity: 0.8, fontSize: 12 }}>Total Requests</div>
            <div style={{ fontSize: 30, fontWeight: 950 }}>{total}</div>
          </article>
          <article style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ opacity: 0.8, fontSize: 12 }}>Open</div>
            <div style={{ fontSize: 30, fontWeight: 950 }}>{open}</div>
          </article>
          <article style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ opacity: 0.8, fontSize: 12 }}>Resolved</div>
            <div style={{ fontSize: 30, fontWeight: 950 }}>{resolved}</div>
          </article>
          <article style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ opacity: 0.8, fontSize: 12 }}>Archived</div>
            <div style={{ fontSize: 30, fontWeight: 950 }}>{archived}</div>
          </article>
          <article style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: 12 }}>
            <div style={{ opacity: 0.8, fontSize: 12 }}>Avg Resolution (hours)</div>
            <div style={{ fontSize: 30, fontWeight: 950 }}>{avgResolutionHours === null ? "-" : avgResolutionHours.toFixed(1)}</div>
          </article>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <article style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", overflow: "hidden" }}>
            <h2 style={{ margin: 0, padding: 12, borderBottom: "1px solid var(--border)", fontSize: 18 }}>By Location</h2>
            {byLocation.length === 0 ? (
              <div style={{ padding: 12, opacity: 0.8 }}>No data.</div>
            ) : (
              byLocation.slice(0, 20).map(([name, count]) => (
                <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
                  <span>{name}</span>
                  <strong>{count}</strong>
                </div>
              ))
            )}
          </article>

          <article style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", overflow: "hidden" }}>
            <h2 style={{ margin: 0, padding: 12, borderBottom: "1px solid var(--border)", fontSize: 18 }}>By Assigned Technician</h2>
            {byTech.length === 0 ? (
              <div style={{ padding: 12, opacity: 0.8 }}>No data.</div>
            ) : (
              byTech.slice(0, 20).map(([name, count]) => (
                <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
                  <span>{name}</span>
                  <strong>{count}</strong>
                </div>
              ))
            )}
          </article>
        </section>

        <section style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", overflow: "hidden" }}>
          <h2 style={{ margin: 0, padding: 12, borderBottom: "1px solid var(--border)", fontSize: 18 }}>Recent Request Audit Activity</h2>
          {auditRows.length === 0 ? (
            <div style={{ padding: 12, opacity: 0.8 }}>No maintenance request audit rows yet.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
                    <th style={{ textAlign: "left", padding: 10 }}>When</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Actor</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Action</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Message</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Request ID</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.map((row) => (
                    <tr key={row.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: 10, whiteSpace: "nowrap", fontSize: 13 }}>{fmtDateTime(row.createdAt)}</td>
                      <td style={{ padding: 10 }}>{personLabel(row.actorUser)}</td>
                      <td style={{ padding: 10, fontWeight: 800 }}>{row.action}</td>
                      <td style={{ padding: 10 }}>{row.message ?? "-"}</td>
                      <td style={{ padding: 10, fontFamily: "monospace", fontSize: 12 }}>{row.entityId ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
