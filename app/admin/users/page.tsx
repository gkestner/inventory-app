import bcrypt from "bcrypt";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import TopNav from "@/app/components/TopNav";
import AdminNav from "@/app/admin/components/AdminNav";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { Role } from "@prisma/client";

function isAdmin(session: any) {
  return session?.user?.role === "ADMIN";
}

export default async function AdminUsersPage() {
  const session: any = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!isAdmin(session)) redirect("/");

  const [users, locations] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        locationId: true,
        createdAt: true,
      },
    }),
    prisma.location.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const locNameById = new Map(locations.map((l) => [l.id, l.name]));

  return (
    <main>
      <TopNav isAdmin={true} />

      <div style={{ padding: 16 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>Admin: Users</h1>
        <AdminNav />

        {/* CREATE USER */}
        <form
          action={async (formData) => {
            "use server";

            const session: any = await getServerSession(authOptions);
            if (!session) redirect("/login");
            if (!isAdmin(session)) redirect("/");

            const name = String(formData.get("name") || "").trim();
            const email = String(formData.get("email") || "")
              .trim()
              .toLowerCase();
            const password = String(formData.get("password") || "");
            const roleRaw = String(formData.get("role") || "EMPLOYEE");
            const locationIdRaw = formData.get("locationId");
            const locationId = locationIdRaw ? String(locationIdRaw) : null;

            if (!name || !email || !password) throw new Error("Missing fields");

            const allowedRoles: Role[] = [Role.EMPLOYEE, Role.MANAGER, Role.ADMIN];
            if (!allowedRoles.includes(roleRaw as Role)) {
              throw new Error(`Invalid role: ${roleRaw}`);
            }
            const role = roleRaw as Role;

            const existing = await prisma.user.findUnique({ where: { email } });
            if (existing) throw new Error("Email already exists");

            const passwordHash = await bcrypt.hash(password, 10);

            await prisma.user.create({
              data: { name, email, passwordHash, role, active: true, locationId },
            });

            revalidatePath("/admin/users");
            redirect("/admin/users");
          }}
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
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Create User</h2>

          <label style={{ display: "grid", gap: 4, fontSize: 12, opacity: 0.9 }}>
            Name
            <input name="name" placeholder="Name" required />
          </label>

          <label style={{ display: "grid", gap: 4, fontSize: 12, opacity: 0.9 }}>
            Email
            <input name="email" placeholder="Email" type="email" required />
          </label>

          <label style={{ display: "grid", gap: 4, fontSize: 12, opacity: 0.9 }}>
            Temp Password
            <input name="password" placeholder="Temp Password" required />
          </label>

          <label style={{ display: "grid", gap: 4, fontSize: 12, opacity: 0.9 }}>
            Role
            <select name="role" defaultValue="EMPLOYEE">
              <option value="EMPLOYEE">EMPLOYEE</option>
              <option value="MANAGER">MANAGER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 4, fontSize: 12, opacity: 0.9 }}>
            Location
            <select name="locationId" defaultValue="">
              <option value="">No Location</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" style={{ marginTop: 6 }}>
            Create User
          </button>
        </form>

        {/* USERS TABLE + ACTIONS */}
        <div
          style={{
            marginTop: 16,
            border: "1px solid #333",
            borderRadius: 10,
            padding: 12,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Users</h2>

          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Name", "Email", "Role", "Location", "Active", "Actions"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: 8,
                        borderBottom: "1px solid #333",
                        fontSize: 12,
                        opacity: 0.8,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {users.map((u) => {
                  const isSelf = u.email === session.user?.email;
                  const disableLabel = u.active ? "Disable" : "Enable";

                  return (
                    <tr key={u.id}>
                      <td style={{ padding: 8, borderBottom: "1px solid #222" }}>{u.name}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #222" }}>{u.email}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #222" }}>{u.role}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #222" }}>
                        {u.locationId ? locNameById.get(u.locationId) : "—"}
                      </td>
                      <td style={{ padding: 8, borderBottom: "1px solid #222" }}>
                        {u.active ? "Yes" : "No"}
                      </td>

                      <td style={{ padding: 8, borderBottom: "1px solid #222" }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {/* Disable/Enable */}
                          <form
                            action={async () => {
                              "use server";
                              const session: any = await getServerSession(authOptions);
                              if (!session) redirect("/login");
                              if (!isAdmin(session)) redirect("/");

                              // Prevent locking yourself out
                              if (u.email === session.user?.email) {
                                throw new Error("You cannot disable your own account.");
                              }

                              await prisma.user.update({
                                where: { id: u.id },
                                data: { active: !u.active },
                              });

                              revalidatePath("/admin/users");
                              redirect("/admin/users");
                            }}
                          >
                            <button type="submit" disabled={isSelf} title={isSelf ? "Can't disable yourself" : ""}>
                              {disableLabel}
                            </button>
                          </form>

                          {/* Reset Password */}
                          <form
                            action={async (formData) => {
                              "use server";
                              const session: any = await getServerSession(authOptions);
                              if (!session) redirect("/login");
                              if (!isAdmin(session)) redirect("/");

                              const newPassword = String(formData.get("newPassword") || "");
                              if (!newPassword || newPassword.length < 6) {
                                throw new Error("Password must be at least 6 characters.");
                              }

                              const passwordHash = await bcrypt.hash(newPassword, 10);

                              await prisma.user.update({
                                where: { id: u.id },
                                data: { passwordHash },
                              });

                              revalidatePath("/admin/users");
                              redirect("/admin/users");
                            }}
                            style={{ display: "flex", gap: 6, alignItems: "center" }}
                          >
                            <input
                              name="newPassword"
                              placeholder="New password"
                              style={{ width: 160 }}
                            />
                            <button type="submit">Reset</button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {users.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: 12, opacity: 0.8 }}>
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
            Disable prevents login. Reset sets a new password hash for the user.
          </p>
        </div>
      </div>
    </main>
  );
}
