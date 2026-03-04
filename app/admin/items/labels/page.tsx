import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

import DymoClient from "./DymoClient";

export const dynamic = "force-dynamic";

type SearchParams = {
  ids?: string | string[];
};

function first(v: string | string[] | undefined): string {
  if (!v) return "";
  return Array.isArray(v) ? v[0] ?? "" : v;
}

function parseIds(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  );
}

export default async function ItemLabelsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const role =
    (session.user as unknown as { role?: Role | null } | null)?.role ?? null;
  if (role !== Role.ADMIN) redirect("/");

  const sp = await searchParams;
  const ids = parseIds(first(sp.ids));

  const items = ids.length
    ? await prisma.item.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          sku: true,
          name: true,
          description: true,
          partNumber: true,
        },
      })
    : [];

  const idOrder = new Map(ids.map((id, idx) => [id, idx]));
  const orderedItems = items
    .slice()
    .sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

  // Pass only serializable fields to the client component
  const clientItems = orderedItems.map((it) => ({
    id: it.id,
    sku: it.sku,
    name: it.name,
    description: it.description ?? "",
    partNumber: it.partNumber ?? "",
  }));

  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
        DYMO Labels
      </h1>

      <p style={{ margin: "0 0 12px", fontSize: 13, opacity: 0.85 }}>
        Instant printing uses the DYMO Web Service on this computer. If printing
        doesn’t work, install DYMO Connect and make sure the DYMO service is
        running.
      </p>

      <DymoClient items={clientItems} />

      {clientItems.length === 0 ? (
        <div
          style={{
            marginTop: 16,
            border: "1px dashed #aaa",
            borderRadius: 8,
            padding: 12,
            background: "#fff",
            maxWidth: 720,
          }}
        >
          No items selected. Go back to Items and use “Print Label” or “Print
          Selected Labels”.
        </div>
      ) : null}
    </main>
  );
}