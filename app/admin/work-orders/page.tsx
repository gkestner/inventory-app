import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma, WorkOrderStatus } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { canAccessAdmin } from "@/app/lib/admin-access";
import { createAuditLog, getCompatDb } from "@/app/lib/workflow-foundations";
import PingAutoRefresh from "./PingAutoRefresh";
import WorkOrderSelectionWiring from "./WorkOrderSelectionWiring";

export const dynamic = "force-dynamic";

const TZ = "America/New_York";

type SearchParams = {
  q?: string;
  from?: string;
  to?: string;
  userId?: string;
  status?: string;
};

type AdminSession = {
  user?: {
    email?: string | null;
    role?: unknown;
  } | null;
} | null;

type SavedViewRow = {
  id: string;
  name: string;
  isDefault: boolean;
  query: unknown;
};

async function requireAdmin(session: AdminSession) {
  if (!session) redirect("/login");
  if (!(await canAccessAdmin(session))) redirect("/");
}

function fmtLocal(d: Date | null): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(d));
}

function isYYYYMMDD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseYMD(s: string | null): { y: number; m: number; d: number; raw: string } | null {
  if (!s) return null;
  const t = s.trim();
  if (!isYYYYMMDD(t)) return null;

  const [yy, mm, dd] = t.split("-").map((x) => Number(x));
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;

  return { y: yy, m: mm, d: dd, raw: t };
}

function getNYOffsetMinutes(atUtc: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = fmt.formatToParts(atUtc);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = tz.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!m) return 0;

  const sign = m[1] === "-" ? -1 : 1;
  const hh = Number(m[2] ?? 0);
  const mm = Number(m[3] ?? 0);
  return sign * (hh * 60 + mm);
}

function nyMidnightUtc(ymd: { y: number; m: number; d: number }): Date {
  const sampleNoonUtc = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, 12, 0, 0));
  const offsetMin = getNYOffsetMinutes(sampleNoonUtc);
  const utcMillis = Date.UTC(ymd.y, ymd.m - 1, ymd.d, 0, 0, 0) - offsetMin * 60_000;
  return new Date(utcMillis);
}

function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function buildQS(params: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue;
    const t = v.trim();
    if (t) sp.set(k, t);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function asSavedFilterQuery(v: unknown): Record<string, string | undefined> {
  if (!v || typeof v !== "object") return {};
  const src = v as Record<string, unknown>;
  const out: Record<string, string | undefined> = {};
  for (const k of ["q", "from", "to", "userId", "status"]) {
    const raw = src[k];
    if (typeof raw !== "string") continue;
    const t = raw.trim();
    if (!t) continue;
    out[k] = t;
  }
  return out;
}

export default async function AdminWorkOrdersPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const session = (await getServerSession(authOptions)) as AdminSession;
  await requireAdmin(session);

  const actorEmail = String(session?.user?.email ?? "").trim().toLowerCase();
  const actor = actorEmail
    ? await prisma.user.findUnique({ where: { email: actorEmail }, select: { id: true } })
    : null;

  async function saveViewAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as AdminSession;
    await requireAdmin(session);

    const email = String(session?.user?.email ?? "").trim().toLowerCase();
    const actor = email ? await prisma.user.findUnique({ where: { email }, select: { id: true } }) : null;
    if (!actor?.id) throw new Error("Unable to resolve current user.");

    const name = String(formData.get("viewName") ?? "").trim();
    if (!name) throw new Error("View name is required.");

    const query = {
      q: String(formData.get("q") ?? "").trim() || undefined,
      from: String(formData.get("from") ?? "").trim() || undefined,
      to: String(formData.get("to") ?? "").trim() || undefined,
      userId: String(formData.get("userId") ?? "").trim() || undefined,
      status: String(formData.get("status") ?? "").trim() || undefined,
    };

    const db = getCompatDb() as any;
    if (!db.savedView?.create || !db.savedView?.findMany || !db.savedView?.delete) {
      throw new Error("Saved views table not available. Run latest migrations.");
    }

    const existing = await db.savedView.findMany({
      where: { userId: actor.id, module: "admin-work-orders", name },
      select: { id: true },
      take: 1,
    });
    if (existing.length > 0) {
      await db.savedView.delete({ where: { id: existing[0].id } });
    }

    await db.savedView.create({
      data: {
        userId: actor.id,
        module: "admin-work-orders",
        name,
        query,
      },
    });

    await createAuditLog({
      actorUserId: actor.id,
      module: "work-orders",
      action: "saved-view-create",
      entityType: "SavedView",
      message: `Saved filter view: ${name}`,
      metadata: query,
    });

    redirect(`/admin/work-orders${buildQS(asSavedFilterQuery(query))}`);
  }

  async function deleteViewAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as AdminSession;
    await requireAdmin(session);

    const email = String(session?.user?.email ?? "").trim().toLowerCase();
    const actor = email ? await prisma.user.findUnique({ where: { email }, select: { id: true } }) : null;
    if (!actor?.id) throw new Error("Unable to resolve current user.");

    const viewId = String(formData.get("viewId") ?? "").trim();
    if (!viewId) throw new Error("Missing saved view id.");

    const db = getCompatDb() as any;
    if (!db.savedView?.findMany || !db.savedView?.delete) {
      throw new Error("Saved views table not available. Run latest migrations.");
    }

    const existing = await db.savedView.findMany({
      where: { id: viewId, userId: actor.id, module: "admin-work-orders" },
      select: { id: true, name: true },
      take: 1,
    });
    if (existing.length > 0) {
      await db.savedView.delete({ where: { id: existing[0].id } });
      await createAuditLog({
        actorUserId: actor.id,
        module: "work-orders",
        action: "saved-view-delete",
        entityType: "SavedView",
        entityId: existing[0].id,
        message: `Deleted filter view: ${existing[0].name}`,
      });
    }

    redirect("/admin/work-orders");
  }

  async function purgeWorkOrderAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as AdminSession;
    await requireAdmin(session);

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing work order id");

    const confirmText = String(formData.get(`confirm_${id}`) ?? "").trim().toUpperCase();
    if (confirmText !== "DELETE") {
      throw new Error('Type "DELETE" to confirm purge.');
    }

    await prisma.$transaction(async (tx) => {
      await tx.workOrderEquipmentArea.deleteMany({ where: { workOrderId: id } });
      await tx.workOrder.delete({ where: { id } });
    });

    revalidatePath("/admin/work-orders");
    revalidatePath(`/admin/work-orders/${id}`);
    revalidatePath("/maintenance/work-orders");
    redirect("/admin/work-orders");
  }

  async function printSelectedAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as AdminSession;
    await requireAdmin(session);

    const ids = formData
      .getAll("ids")
      .map((v) => String(v).trim())
      .filter(Boolean)
      .slice(0, 500);

    if (ids.length === 0) {
      redirect("/admin/work-orders");
    }

    redirect(`/admin/work-orders/print?ids=${encodeURIComponent(ids.join(","))}`);
  }

  async function exportSelectedAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as AdminSession;
    await requireAdmin(session);

    const ids = formData
      .getAll("ids")
      .map((v) => String(v).trim())
      .filter(Boolean)
      .slice(0, 500);

    if (ids.length === 0) {
      redirect("/admin/work-orders");
    }

    redirect(`/admin/work-orders/export?ids=${encodeURIComponent(ids.join(","))}`);
  }

  const sp = (await searchParams) ?? {};

  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const userIdRaw = typeof sp.userId === "string" ? sp.userId.trim() : "ALL";
  const statusRaw = typeof sp.status === "string" ? sp.status.trim().toUpperCase() : "ALL";
  const fromParam = parseYMD(typeof sp.from === "string" ? sp.from : null);
  const toParam = parseYMD(typeof sp.to === "string" ? sp.to : null);

  const statusFilter = statusRaw === "DRAFT" || statusRaw === "SUBMITTED" || statusRaw === "FINALIZED" ? statusRaw : "ALL";

  const fromUtc = fromParam ? nyMidnightUtc(fromParam) : null;
  const toExclusiveUtc = toParam ? addDaysUtc(nyMidnightUtc(toParam), 1) : null;

  const users = await prisma.user.findMany({
    where: { active: true, workOrdersCreated: { some: {} } },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: { id: true, name: true, email: true },
  });

  const userIds = new Set(users.map((u) => u.id));
  const userId = userIdRaw === "ALL" || userIds.has(userIdRaw) ? userIdRaw : "ALL";

  const compat = getCompatDb() as any;
  const savedViews: SavedViewRow[] = actor?.id && compat.savedView?.findMany
    ? await compat.savedView.findMany({
        where: { userId: actor.id, module: "admin-work-orders" },
        orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
        select: { id: true, name: true, isDefault: true, query: true },
      })
    : [];

  const where: Prisma.WorkOrderWhereInput = {
    ...(statusFilter !== "ALL" ? { status: statusFilter as WorkOrderStatus } : {}),
    ...(fromUtc || toExclusiveUtc
      ? {
          createdAt: {
            ...(fromUtc ? { gte: fromUtc } : {}),
            ...(toExclusiveUtc ? { lt: toExclusiveUtc } : {}),
          },
        }
      : {}),
    ...(userId !== "ALL" ? { createdByUserId: userId } : {}),
    ...(q
      ? {
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { notes: { contains: q, mode: "insensitive" } },
            { location: { name: { contains: q, mode: "insensitive" } } },
            { createdByUser: { name: { contains: q, mode: "insensitive" } } },
            { createdByUser: { email: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [workOrders, pings] = await Promise.all([
    prisma.workOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        status: true,
        locationId: true,
        location: { select: { name: true } },
        startTime: true,
        endTime: true,
        createdAt: true,
        updatedAt: true,
        notes: true,
        createdByUserId: true,
        createdByUser: { select: { name: true, email: true } },
      },
    }),
    prisma.workOrderPing.findMany({
      orderBy: { createdAt: "desc" },
      take: 120,
      select: {
        id: true,
        event: true,
        note: true,
        createdAt: true,
        location: { select: { name: true } },
        actorUser: { select: { name: true, email: true } },
        workOrderId: true,
      },
    }),
  ]);

  const qs = buildQS({
    q: q || undefined,
    userId: userId !== "ALL" ? userId : undefined,
    status: statusFilter !== "ALL" ? statusFilter : undefined,
    from: fromParam?.raw,
    to: toParam?.raw,
  });

  const printFilteredUrl = `/admin/work-orders/print${qs}`;
  const exportFilteredUrl = `/admin/work-orders/export${qs}`;

  const border = "1px solid rgba(128,128,128,0.25)";
  const card: CSSProperties = {
    border,
    borderRadius: 14,
    padding: 14,
    background: "var(--background)",
    color: "var(--foreground)",
  };

  const btn: CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    border,
    background: "var(--background)",
    color: "var(--foreground)",
    fontWeight: 900,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    textDecoration: "none",
    lineHeight: 1,
    whiteSpace: "nowrap",
  };

  const btnDanger: CSSProperties = {
    ...btn,
    background: "rgba(220, 60, 60, 0.16)",
    border: "1px solid rgba(220, 60, 60, 0.45)",
  };

  const input: CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    border,
    background: "var(--background)",
    color: "var(--foreground)",
    outline: "none",
    width: 110,
  };

  const filterInput: CSSProperties = {
    ...input,
    width: "100%",
    minWidth: 180,
  };

  const tableWrap: CSSProperties = {
    width: "100%",
    overflowX: "hidden",
    WebkitOverflowScrolling: "touch",
  };

  const table: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: "fixed",
  };

  const th: CSSProperties = {
    textAlign: "left",
    padding: "10px 10px",
    borderBottom: "1px solid rgba(128,128,128,0.25)",
    fontSize: 12,
    opacity: 0.9,
    whiteSpace: "nowrap",
  };

  const td: CSSProperties = {
    padding: "12px 10px",
    verticalAlign: "top",
  };

  const ellipsis: CSSProperties = {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const colSelect = "4%";
  const colId = "10%";
  const colLoc = "9%";
  const colStatus = "8%";
  const colStart = "9%";
  const colEnd = "9%";
  const colCreated = "9%";
  const colUpdated = "9%";
  const colBy = "12%";
  const colNotes = "10%";
  const colActions = "20%";

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Admin: Work Orders</h1>
          <Link href="/maintenance/work-orders/office-entry" style={btn}>
            Office Entry
          </Link>
          <Link href="/admin/work-orders/schedules" style={btn}>
            PM Scheduler
          </Link>
          <Link href="/admin/audit" style={btn}>
            Audit
          </Link>
          <Link href="/admin/cycle-counts" style={btn}>
            Cycle Counts
          </Link>
          <Link href="/admin/reports/work-order-costs" style={btn}>
            Cost Rollup
          </Link>
          <div style={{ opacity: 0.75, fontSize: 13 }}>
            {workOrders.length} shown (max 500) • Times in <b>{TZ}</b>
          </div>
        </div>

        <div style={{ ...card, marginTop: 12 }}>
          <form
            method="get"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 10,
            }}
          >
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 900, fontSize: 12 }}>Search any info</span>
              <input
                name="q"
                defaultValue={q}
                placeholder="id, status, location, user, notes"
                style={filterInput}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 900, fontSize: 12 }}>Created from</span>
              <input type="date" name="from" defaultValue={fromParam?.raw ?? ""} style={filterInput} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 900, fontSize: 12 }}>Created to</span>
              <input type="date" name="to" defaultValue={toParam?.raw ?? ""} style={filterInput} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 900, fontSize: 12 }}>User</span>
              <select name="userId" defaultValue={userId} style={filterInput}>
                <option value="ALL">All users</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 900, fontSize: 12 }}>Status</span>
              <select name="status" defaultValue={statusFilter} style={filterInput}>
                <option value="ALL">All statuses</option>
                <option value="DRAFT">DRAFT</option>
                <option value="SUBMITTED">SUBMITTED</option>
                <option value="FINALIZED">FINALIZED</option>
              </select>
            </label>

            <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
              <button type="submit" style={btn}>
                Apply Filters
              </button>
              <Link href="/admin/work-orders" style={btn}>
                Reset
              </Link>
              <a href={printFilteredUrl} target="_blank" rel="noreferrer" style={btn}>
                Print Filtered
              </a>
              <a href={exportFilteredUrl} style={btn}>
                Export QuickBooks CSV
              </a>
            </div>
          </form>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <form action={saveViewAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input name="viewName" placeholder="Save current filters as..." style={{ ...filterInput, minWidth: 240, maxWidth: 360 }} />
              <input type="hidden" name="q" value={q} />
              <input type="hidden" name="from" value={fromParam?.raw ?? ""} />
              <input type="hidden" name="to" value={toParam?.raw ?? ""} />
              <input type="hidden" name="userId" value={userId} />
              <input type="hidden" name="status" value={statusFilter} />
              <button type="submit" style={btn}>Save View</button>
            </form>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, opacity: 0.85, fontWeight: 900 }}>Saved Views:</span>
              {savedViews.map((v) => {
                const qs = buildQS(asSavedFilterQuery(v.query));
                return (
                  <div key={v.id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <Link href={`/admin/work-orders${qs}`} style={btn}>
                      {v.name}
                    </Link>
                    <form action={deleteViewAction}>
                      <input type="hidden" name="viewId" value={v.id} />
                      <button type="submit" style={{ ...btnDanger, padding: "6px 8px" }} title={`Delete ${v.name}`}>
                        X
                      </button>
                    </form>
                  </div>
                );
              })}
              {savedViews.length === 0 ? <span style={{ fontSize: 12, opacity: 0.7 }}>No saved views yet.</span> : null}
            </div>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
            Batch print/export uses the exact filters above. Use row-level Print for a single work order.
          </div>
        </div>

        <div style={{ ...card, marginTop: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Location Pings (Admin Only)</div>
          <div style={{ marginBottom: 10 }}>
            <PingAutoRefresh intervalMs={12000} />
          </div>
          <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 10 }}>
            {pings.length} recent pings from work order start, stop, and edit actions.
          </div>

          <div style={tableWrap}>
            <table style={table}>
              <colgroup>
                <col style={{ width: "16%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "24%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "10%" }} />
              </colgroup>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                  {["Time", "Event", "Location", "User", "Note", "Work Order"].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pings.map((p) => (
                  <tr key={p.id} style={{ borderTop: "1px solid rgba(128,128,128,0.18)" }}>
                    <td style={td}>
                      <div style={ellipsis}>{fmtLocal(p.createdAt)}</div>
                    </td>
                    <td style={{ ...td, fontWeight: 900 }}>
                      <div style={ellipsis}>{p.event}</div>
                    </td>
                    <td style={td}>
                      <div style={ellipsis}>{p.location?.name ?? "-"}</div>
                    </td>
                    <td style={td}>
                      <div style={ellipsis}>{p.actorUser ? `${p.actorUser.name} (${p.actorUser.email})` : "-"}</div>
                    </td>
                    <td style={td}>
                      <div style={ellipsis}>{p.note ?? "-"}</div>
                    </td>
                    <td style={td}>
                      <Link href={`/admin/work-orders/${p.workOrderId}`} style={btn}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}

                {pings.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 14, opacity: 0.85 }}>
                      No pings yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ ...card, marginTop: 12, padding: 0 }}>
          <div style={{ padding: 14 }}>
            <form id="work-order-selection-form">
              <WorkOrderSelectionWiring
                formId="work-order-selection-form"
                toggleId="toggle-work-order-selection"
                countId="selected-work-order-count"
              />

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                <button id="toggle-work-order-selection" type="button" style={btn}>
                  Select all
                </button>
                <span id="selected-work-order-count" style={{ fontSize: 12, opacity: 0.8 }}>
                  0 selected
                </span>
                <button formAction={printSelectedAction} style={btn}>
                  Print Selected
                </button>
                <button formAction={exportSelectedAction} style={btn}>
                  Export Selected
                </button>
              </div>

              <div style={tableWrap}>
                <table style={table}>
                  <colgroup>
                    <col style={{ width: colSelect }} />
                    <col style={{ width: colId }} />
                    <col style={{ width: colLoc }} />
                    <col style={{ width: colStatus }} />
                    <col style={{ width: colStart }} />
                    <col style={{ width: colEnd }} />
                    <col style={{ width: colCreated }} />
                    <col style={{ width: colUpdated }} />
                    <col style={{ width: colBy }} />
                    <col style={{ width: colNotes }} />
                    <col style={{ width: colActions }} />
                  </colgroup>

                  <thead>
                    <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                      {["Sel", "ID", "Location", "Status", "Start", "End", "Created", "Updated", "Created By", "Notes", "Actions"].map(
                        (h) => (
                          <th key={h} style={th}>
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>

                  <tbody>
                    {workOrders.map((wo) => {
                      const createdByLabel = wo.createdByUser
                        ? `${wo.createdByUser.name} (${wo.createdByUser.email})`
                        : wo.createdByUserId;

                      return (
                        <tr key={wo.id} style={{ borderTop: "1px solid rgba(128,128,128,0.18)" }}>
                          <td style={td}>
                            <input type="checkbox" name="ids" value={wo.id} aria-label={`Select ${wo.id}`} />
                          </td>

                          <td style={{ ...td, fontWeight: 900 }}>
                            <div style={ellipsis}>{wo.id.slice(0, 10)}...</div>
                            <div style={{ fontSize: 12, opacity: 0.75, ...ellipsis }}>id: {wo.id}</div>
                          </td>

                          <td style={td}>
                            <div style={ellipsis}>{wo.location?.name ?? "-"}</div>
                          </td>

                          <td style={{ ...td, fontWeight: 900 }}>
                            <div style={ellipsis}>{String(wo.status ?? "-")}</div>
                          </td>

                          <td style={td}>
                            <div style={ellipsis}>{fmtLocal(wo.startTime)}</div>
                          </td>

                          <td style={td}>
                            <div style={ellipsis}>{fmtLocal(wo.endTime)}</div>
                          </td>

                          <td style={td}>
                            <div style={ellipsis}>{fmtLocal(wo.createdAt)}</div>
                          </td>

                          <td style={td}>
                            <div style={ellipsis}>{fmtLocal(wo.updatedAt)}</div>
                          </td>

                          <td style={td}>
                            <div style={ellipsis}>{createdByLabel ?? "-"}</div>
                          </td>

                          <td style={td}>
                            <div style={ellipsis}>{wo.notes ?? "-"}</div>
                          </td>

                          <td style={td}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <Link href={`/admin/work-orders/${wo.id}`} style={btn}>
                                Edit / View
                              </Link>

                              <a href={`/admin/work-orders/print?ids=${encodeURIComponent(wo.id)}`} target="_blank" rel="noreferrer" style={btn}>
                                Print
                              </a>

                              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                <input name={`confirm_${wo.id}`} placeholder="DELETE" style={input} />
                                <button type="submit" name="id" value={wo.id} formAction={purgeWorkOrderAction} style={btnDanger}>
                                  Purge
                                </button>
                              </div>
                            </div>

                            <div style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
                              To purge, type <code>DELETE</code>.
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {workOrders.length === 0 ? (
                      <tr>
                        <td colSpan={11} style={{ padding: 14, opacity: 0.85 }}>
                          No work orders found.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
