// app/admin/page.tsx
import Link from "next/link";
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

type CardProps = {
  title: string;
  value: string | number;
  href: string;
  subtitle?: string;
};

function StatCard({ title, value, href, subtitle }: CardProps) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: 24,
        minWidth: 220,
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div style={{ fontSize: 14, opacity: 0.85, fontWeight: 800 }}>{title}</div>
      {subtitle ? <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>{subtitle}</div> : null}
      <div style={{ fontSize: 40, fontWeight: 900, marginTop: 10 }}>{value}</div>
      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10, fontWeight: 800 }}>Open →</div>
    </Link>
  );
}

export default async function AdminDashboardPage() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  requireAdmin(session);

  const [locationsCount, usersCount, itemsCount, vendorConfigCount] = await Promise.all([
    prisma.location.count(),
    prisma.user.count(),
    prisma.item.count(),
    prisma.invoiceVendorConfig.count(),
  ]);

  return (
    <main style={{ padding: 32 }}>
      <h1 style={{ fontSize: 42, fontWeight: 900, marginBottom: 24 }}>Admin Dashboard</h1>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <StatCard title="Locations" value={locationsCount} href="/admin/locations" />
        <StatCard title="Users" value={usersCount} href="/admin/users" />
        <StatCard title="Items" value={itemsCount} href="/admin/items" />
        <StatCard
          title="Vendor Config"
          value={vendorConfigCount}
          href="/admin/vendor-config"
          subtitle="Tax + Cost Formula settings"
        />
      </div>

      <div style={{ marginTop: 28, fontSize: 12, opacity: 0.7 }}>
        Tip: If “Vendor Config” link 404s, tell me what route you want it under (or paste your existing vendor-config page/route),
        and I’ll do a full drop-in for that page to add the Cost Formula input + save.
      </div>
    </main>
  );
}