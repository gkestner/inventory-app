// app/admin/page.tsx
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { Role } from "@prisma/client";

export const dynamic = "force-dynamic";

type AdminSession = {
  user?: { role?: Role | null } | null;
} | null;

function requireAdmin(session: AdminSession) {
  if (!session) redirect("/login");
  if (session.user?.role !== Role.ADMIN) redirect("/");
}

export default async function AdminDashboardPage() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  requireAdmin(session);

  const [locationsCount, usersCount] = await Promise.all([
    prisma.location.count(),
    prisma.user.count(),
  ]);

  return (
    <main style={{ padding: 32 }}>
      <h1 style={{ fontSize: 42, fontWeight: 900, marginBottom: 24 }}>
        Admin Dashboard
      </h1>

      <div style={{ display: "flex", gap: 24 }}>
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: 24,
            minWidth: 180,
          }}
        >
          <div style={{ fontSize: 14, opacity: 0.8 }}>Locations</div>
          <div style={{ fontSize: 40, fontWeight: 900 }}>
            {locationsCount}
          </div>
        </div>

        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: 24,
            minWidth: 180,
          }}
        >
          <div style={{ fontSize: 14, opacity: 0.8 }}>Users</div>
          <div style={{ fontSize: 40, fontWeight: 900 }}>
            {usersCount}
          </div>
        </div>
      </div>
    </main>
  );
}
