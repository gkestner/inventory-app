const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

async function main() {
  const email = "admin@company.com";
  const password = "ChangeMe123!";

  const hash = await bcrypt.hash(password, 12);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("Admin already exists:", email);
    return;
  }

  await prisma.user.create({
    data: {
      name: "Admin",
      email,
      passwordHash: hash,
      role: "ADMIN",
      active: true,
    },
  });

  console.log("Admin created:", email, "password:", password);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
