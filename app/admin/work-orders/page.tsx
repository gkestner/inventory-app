// app/admin/work-orders/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { Role } from "@prisma/client";

export const dynamic = "force-dynamic";

const TZ = "America/New_York";

type AdminSession = {
  user?: {
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

function requireAdmin(session: AdminSession) {
  if (!session) redirect("/login");
  if (session.user?.role !== Role.ADMIN) redirect("/");
}

function fmtLocal(d: Date | null): string {
  if (!d) return "—";
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

export default async function AdminWorkOrdersPage() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  requireAdmin(session);

  async function purgeWorkOrderAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as AdminSession;
    requireAdmin(session);

    const id = String(formData.get("id") ?? "").trim();
    if (!id) throw new Error("Missing work order id");

    const confirmText = String(formData.get("confirm") ?? "").trim().toUpperCase();
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

  const workOrders = await prisma.workOrder.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
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
  });

  const pings = await prisma.workOrderPing.findMany({
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
  });

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

  // Column widths (must sum <= 100%; fixed table layout will respect these)
  // Adjust anytime without causing page overflow.
  const colId = "14%";
  const colLoc = "10%";
  const colStatus = "8%";
  const colStart = "10%";
  const colEnd = "10%";
  const colCreated = "10%";
  const colUpdated = "10%";
  const colBy = "12%";
  const colNotes = "12%";
  const colActions = "14%";

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1300, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Admin: Work Orders</h1>
          <div style={{ opacity: 0.75, fontSize: 13 }}>
            {workOrders.length} shown • Times in <b>{TZ}</b>
          </div>
        </div>

        <div style={{ ...card, marginTop: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Location Pings (Admin Only)</div>
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
                  {[
                    "Time",
                    "Event",
                    "Location",
                    "User",
                    "Note",
                    "Work Order",
                  ].map((h) => (
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
                      <div style={ellipsis}>{p.location?.name ?? "—"}</div>
                    </td>
                    <td style={td}>
                      <div style={ellipsis}>{p.actorUser ? `${p.actorUser.name} (${p.actorUser.email})` : "—"}</div>
                    </td>
                    <td style={td}>
                      <div style={ellipsis}>{p.note ?? "—"}</div>
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
            <div style={tableWrap}>
              <table style={table}>
                <colgroup>
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
                    {["ID", "Location", "Status", "Start", "End", "Created", "Updated", "Created By", "Notes", "Actions"].map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {workOrders.map((wo) => {
                    const createdByLabel = wo.createdByUser
                      ? `${wo.createdByUser.name} (${wo.createdByUser.email})`
                      : wo.createdByUserId;

                    return (
                      <tr key={wo.id} style={{ borderTop: "1px solid rgba(128,128,128,0.18)" }}>
                        <td style={{ ...td, fontWeight: 900 }}>
                          <div style={ellipsis}>{wo.id.slice(0, 10)}…</div>
                          <div style={{ fontSize: 12, opacity: 0.75, ...ellipsis }}>id: {wo.id}</div>
                        </td>

                        <td style={td}>
                          <div style={ellipsis}>{wo.location?.name ?? "—"}</div>
                        </td>

                        <td style={{ ...td, fontWeight: 900 }}>
                          <div style={ellipsis}>{String(wo.status ?? "—")}</div>
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
                          <div style={ellipsis}>{createdByLabel ?? "—"}</div>
                        </td>

                        <td style={td}>
                          <div style={ellipsis}>{wo.notes ?? "—"}</div>
                        </td>

                        <td style={td}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <Link href={`/admin/work-orders/${wo.id}`} style={btn}>
                              Edit / View
                            </Link>

                            <form action={purgeWorkOrderAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <input type="hidden" name="id" value={wo.id} />
                              <input name="confirm" placeholder="DELETE" style={input} />
                              <button type="submit" style={btnDanger}>
                                Purge
                              </button>
                            </form>
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
                      <td colSpan={10} style={{ padding: 14, opacity: 0.85 }}>
                        No work orders found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}