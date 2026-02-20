// app/lib/session.ts
import { Role } from "@prisma/client";

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: Role;
};

export function getSessionUser(session: unknown): SessionUser | null {
  if (!session || typeof session !== "object") return null;
  const s = session as Record<string, unknown>;
  const u = s["user"];
  if (!u || typeof u !== "object") return null;

  const r = u as Record<string, unknown>;
  const id = r["id"];
  const role = r["role"];

  if (typeof id !== "string") return null;
  if (typeof role !== "string") return null;

  // Role is a string enum; validate against Role values
  const roleOk = Object.values(Role).includes(role as Role);
  if (!roleOk) return null;

  return {
    id,
    role: role as Role,
    name: typeof r["name"] === "string" ? (r["name"] as string) : null,
    email: typeof r["email"] === "string" ? (r["email"] as string) : null,
  };
}
