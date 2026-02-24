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

    const confirmText = String(formData.get("confirm") ?? "")
      .trim()
      .toUpperCase();

    if (confirmText !== "DELETE") {
      throw new Error('Type "DELETE" to confirm purge.');
    }

    await prisma.$transaction(async (tx) => {
      // remove children first (avoids FK constraint problems)
      await tx.workOrderEquipmentArea.deleteMany({ where: { workOrderId: id } });
      await tx.workOrder.delete({ where: { id } });
    });

    revalidatePath("/admin/work-orders");
    revalidatePath(`/admin/work-orders/${id}`);
    revalidatePath("/maintenance/work-orders"); // if maintenance list shows them
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
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                  {["ID", "Location", "Status", "Start", "End", "Created", "Updated", "Created By", "Notes", "Actions"].map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "10px 10px",
                          borderBottom: "1px solid rgba(128,128,128,0.25)",
                          fontSize: 12,
                          opacity: 0.9,
                          whiteSpace: "nowrap",
                        }}
                      >
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
                      <td style={{ padding: "12px 10px", fontWeight: 900 }}>
                        {wo.id.slice(0, 10)}…
                        <div style={{ fontSize: 12, opacity: 0.75 }}>id: {wo.id}</div>
                      </td>

                      <td style={{ padding: "12px 10px" }}>{wo.location?.name ?? "—"}</td>
                      <td style={{ padding: "12px 10px", fontWeight: 900 }}>{String(wo.status ?? "—")}</td>
                      <td style={{ padding: "12px 10px" }}>{fmtLocal(wo.startTime)}</td>
                      <td style={{ padding: "12px 10px" }}>{fmtLocal(wo.endTime)}</td>
                      <td style={{ padding: "12px 10px" }}>{fmtLocal(wo.createdAt)}</td>
                      <td style={{ padding: "12px 10px" }}>{fmtLocal(wo.updatedAt)}</td>
                      <td style={{ padding: "12px 10px", maxWidth: 240 }}>
                        <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {createdByLabel}
                        </div>
                      </td>

                      <td style={{ padding: "12px 10px", maxWidth: 320 }}>
                        <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {wo.notes ?? "—"}
                        </div>
                      </td>

                      <td style={{ padding: "12px 10px" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <Link href={`/admin/work-orders/${wo.id}`} style={btn}>
                            Edit / View
                          </Link>

                          <form action={purgeWorkOrderAction} style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
    </main>
  );
}