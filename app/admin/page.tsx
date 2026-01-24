import AdminNav from "@/app/admin/components/AdminNav";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import TopNav from "@/app/components/TopNav";

export default async function AdminPage() {
  const session: any = await getServerSession(authOptions);
  if (!session) redirect("/login");

  if (session.user?.role !== "ADMIN") redirect("/");

  const [locationCount, userCount, locations] = await Promise.all([
    prisma.location.count(),
    prisma.user.count(),
    prisma.location.findMany({
      orderBy: { name: "asc" },
      take: 25,
      select: { id: true, name: true },
    }),
  ]);

  return (
    <main>
      <TopNav isAdmin={true} />
      <div style={{ padding: 16 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>Admin Dashboard</h1>
        <AdminNav />


        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <div style={{ border: "1px solid #333", borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Locations</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{locationCount}</div>
          </div>

          <div style={{ border: "1px solid #333", borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Users</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{userCount}</div>
          </div>
        </div>

        <h2 style={{ marginTop: 22, fontSize: 18, fontWeight: 700 }}>
          Locations (sample)
        </h2>

        <ul style={{ marginTop: 10 }}>
          {locations.map((l) => (
            <li key={l.id}>{l.name}</li>
          ))}
        </ul>
      </div>
    </main>
  );
}
