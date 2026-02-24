// app/admin/work-orders/page.tsx
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { Role } from "@prisma/client";

export const dynamic = "force-dynamic";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

function fmt(d: Date | null) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export default async function AdminWorkOrdersPage() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session?.user?.email) redirect("/login");
  if (session.user.role !== Role.ADMIN) redirect("/");

  const rows = await prisma.workOrder.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      startTime: true,
      endTime: true,
      startingMileage: true,
      endingMileage: true,
      location: { select: { name: true } },
      // createdByUserId exists in your snippet; keep it optional in case schema changes
      createdByUserId: true as any,
    },
  });

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Admin · Work Orders</h1>
          <div style={{ opacity: 0.75, fontSize: 14 }}>{rows.length} shown</div>
        </div>

        <div
          style={{
            marginTop: 14,
            border: "1px solid rgba(128,128,128,0.25)",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                  <th style={{ textAlign: "left", padding: 12, fontSize: 13, opacity: 0.85 }}>ID</th>
                  <th style={{ textAlign: "left", padding: 12, fontSize: 13, opacity: 0.85 }}>Location</th>
                  <th style={{ textAlign: "left", padding: 12, fontSize: 13, opacity: 0.85 }}>Status</th>
                  <th style={{ textAlign: "left", padding: 12, fontSize: 13, opacity: 0.85 }}>Start</th>
                  <th style={{ textAlign: "left", padding: 12, fontSize: 13, opacity: 0.85 }}>End</th>
                  <th style={{ textAlign: "left", padding: 12, fontSize: 13, opacity: 0.85 }}>Mileage</th>
                  <th style={{ textAlign: "left", padding: 12, fontSize: 13, opacity: 0.85 }}>Created</th>
                  <th style={{ textAlign: "left", padding: 12, fontSize: 13, opacity: 0.85 }}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid rgba(128,128,128,0.18)" }}>
                    <td style={{ padding: 12, fontSize: 14, fontWeight: 800 }}>
                      <Link href={`/admin/work-orders/${r.id}`} style={{ textDecoration: "none" }}>
                        {r.id.slice(0, 8)}…
                      </Link>
                    </td>
                    <td style={{ padding: 12, fontSize: 14 }}>{r.location?.name ?? "—"}</td>
                    <td style={{ padding: 12, fontSize: 14 }}>{String(r.status ?? "—")}</td>
                    <td style={{ padding: 12, fontSize: 14 }}>{fmt(r.startTime ?? null)}</td>
                    <td style={{ padding: 12, fontSize: 14 }}>{fmt(r.endTime ?? null)}</td>
                    <td style={{ padding: 12, fontSize: 14 }}>
                      {(r.startingMileage ?? "—") as any} → {(r.endingMileage ?? "—") as any}
                    </td>
                    <td style={{ padding: 12, fontSize: 14 }}>{fmt(r.createdAt)}</td>
                    <td style={{ padding: 12, fontSize: 14 }}>{fmt(r.updatedAt)}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 16, opacity: 0.75 }}>
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