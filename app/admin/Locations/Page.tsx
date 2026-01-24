// app/admin/locations/page.tsx
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import TopNav from "@/app/components/TopNav";
import AdminNav from "@/app/admin/components/AdminNav";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export default async function AdminLocationsPage() {
  const session: any = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user?.role !== "ADMIN") redirect("/");

  const [locations, usersByLocation] = await Promise.all([
    prisma.location.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, createdAt: true },
    }),
    prisma.user.groupBy({
      by: ["locationId"],
      _count: { _all: true },
      where: { locationId: { not: null } },
    }),
  ]);

  const userCountByLocationId = new Map<string, number>();
  for (const row of usersByLocation) {
    const id = row.locationId;
    if (id) userCountByLocationId.set(id, row._count._all);
  }

  async function createLocationAction(formData: FormData): Promise<void> {
    "use server";

    const session: any = await getServerSession(authOptions);
    if (!session) redirect("/login");
    if (session.user?.role !== "ADMIN") redirect("/");

    const nameRaw = asString(formData.get("name"));
    const name = normalizeName(nameRaw);

    if (!name) throw new Error("Location name is required.");

    const existing = await prisma.location.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) throw new Error("That location name already exists.");

    await prisma.location.create({
      data: { name },
    });

    revalidatePath("/admin/locations");
  }

  async function renameLocationAction(formData: FormData): Promise<void> {
    "use server";

    const session: any = await getServerSession(authOptions);
    if (!session) redirect("/login");
    if (session.user?.role !== "ADMIN") redirect("/");

    const id = asString(formData.get("id"));
    const nameRaw = asString(formData.get("name"));
    const name = normalizeName(nameRaw);

    if (!id) throw new Error("Missing location id.");
    if (!name) throw new Error("Location name is required.");

    const exists = await prisma.location.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new Error("Location not found.");

    const dup = await prisma.location.findFirst({
      where: {
        id: { not: id },
        name: { equals: name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (dup) throw new Error("Another location already uses that name.");

    await prisma.location.update({
      where: { id },
      data: { name },
    });

    revalidatePath("/admin/locations");
  }

  async function deleteLocationAction(formData: FormData): Promise<void> {
    "use server";

    const session: any = await getServerSession(authOptions);
    if (!session) redirect("/login");
    if (session.user?.role !== "ADMIN") redirect("/");

    const id = asString(formData.get("id"));
    if (!id) throw new Error("Missing location id.");

    // Block delete if users are assigned
    const usersAtLocation = await prisma.user.count({ where: { locationId: id } });
    if (usersAtLocation > 0) {
      throw new Error("Cannot delete: users are assigned to this location.");
    }

    await prisma.location.delete({ where: { id } });

    revalidatePath("/admin/locations");
  }

  return (
    <main>
      <TopNav isAdmin={true} />
      <div style={{ padding: 16 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>Admin: Locations</h1>
        <AdminNav />

        {/* CREATE */}
        <form
          action={createLocationAction}
          style={{
            border: "1px solid #333",
            padding: 12,
            borderRadius: 10,
            marginTop: 16,
            display: "grid",
            gap: 8,
            maxWidth: 520,
          }}
        >
          <h2 style={{ margin: 0 }}>Create Location</h2>
          <input name="name" placeholder="Location name (e.g., CORPORATE)" required />
          <button type="submit">Create Location</button>

          <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
            Names are treated as unique (case-insensitive).
          </p>
        </form>

        {/* LIST */}
        <div
          style={{
            marginTop: 16,
            border: "1px solid #333",
            borderRadius: 10,
            padding: 12,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Locations</h2>

          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Name", "Users Assigned", "Actions"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: 8,
                        borderBottom: "1px solid #333",
                        fontSize: 12,
                        opacity: 0.8,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {locations.map((l) => {
                  const assigned = userCountByLocationId.get(l.id) ?? 0;

                  return (
                    <tr key={l.id}>
                      {/* NAME + RENAME */}
                      <td style={{ padding: 8, borderBottom: "1px solid #222", minWidth: 260 }}>
                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ fontWeight: 700 }}>{l.name}</div>

                          <form
                            action={renameLocationAction}
                            style={{ display: "flex", gap: 8, alignItems: "center" }}
                          >
                            <input type="hidden" name="id" value={l.id} />
                            <input name="name" defaultValue={l.name} style={{ flex: 1 }} />
                            <button type="submit">Rename</button>
                          </form>
                        </div>
                      </td>

                      {/* USERS ASSIGNED */}
                      <td style={{ padding: 8, borderBottom: "1px solid #222" }}>{assigned}</td>

                      {/* ACTIONS */}
                      <td style={{ padding: 8, borderBottom: "1px solid #222", minWidth: 220 }}>
                        <form action={deleteLocationAction}>
                          <input type="hidden" name="id" value={l.id} />
                          <button
                            type="submit"
                            disabled={assigned > 0}
                            title={assigned > 0 ? "Move users off this location before deleting." : ""}
                          >
                            Delete
                          </button>
                        </form>

                        {assigned > 0 && (
                          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                            Delete blocked: {assigned} user(s) assigned.
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {locations.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ padding: 12, opacity: 0.8 }}>
                      No locations found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
            Next step: add Inventory Items + Stock per Location.
          </p>
        </div>
      </div>
    </main>
  );
}
