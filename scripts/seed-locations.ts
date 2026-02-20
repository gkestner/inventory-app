// scripts/seed-locations.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Provide locations as:
 *   LOCATIONS="MAIN,SHOP,WAREHOUSE"
 * If omitted, defaults to "MAIN".
 */
function parseLocations(): string[] {
  const raw = (process.env.LOCATIONS || "MAIN").trim();
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

async function main() {
  const names = parseLocations();

  for (const name of names) {
    await prisma.location.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  console.log(`✅ Seeded locations: ${names.join(", ")}`);
}

main()
  .catch((e) => {
    console.error("❌ seed-locations failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
