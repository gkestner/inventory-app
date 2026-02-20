// scripts/seed-admin.ts
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function env(name: string, fallback?: string) {
  const v = process.env[name];
  if (v && v.trim()) return v.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing env var: ${name}`);
}

async function main() {
  const email = env("ADMIN_EMAIL").toLowerCase();
  const password = env("ADMIN_PASSWORD");
  const name = env("ADMIN_NAME", "Admin");
  const locationName = env("ADMIN_LOCATION", "MAIN");

  const passwordHash = await bcrypt.hash(password, 12);

  /**
   * CRITICAL:
   * Your Location table does NOT have `updatedAt`.
   * Prisma upsert returns all scalar fields by default, which causes it to reference
   * updatedAt in RETURNING, throwing P2022.
   *
   * Fix: explicit select only known columns.
   */
  const location = await prisma.location.upsert({
    where: { name: locationName },
    update: {},
    create: { name: locationName },
    select: {
      id: true,
      name: true,
    },
  });

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      role: Role.ADMIN,
      active: true,
      locationId: location.id,
      passwordHash,
    },
    create: {
      email,
      name,
      role: Role.ADMIN,
      active: true,
      locationId: location.id,
      passwordHash,
    },
    select: {
      id: true,
      email: true,
      role: true,
      active: true,
      locationId: true,
    },
  });

  console.log(`✅ Seeded admin: ${user.email} @ location "${location.name}" (${location.id})`);
}

main()
  .catch((e) => {
    console.error("❌ seed-admin failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
