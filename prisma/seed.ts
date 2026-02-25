// prisma/seed.ts
import { PrismaClient, Permission, Role } from "@prisma/client";

const prisma = new PrismaClient();

function normName(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

type SystemRoleSpec = {
  name: string; // must match the "system admin" check in permissions.ts (ADMIN)
  description: string;
  isSystem: true;
};

const SYSTEM_ROLES: SystemRoleSpec[] = [
  { name: "ADMIN", description: "System admin (allow-all).", isSystem: true },
  { name: "MANAGER", description: "System manager role (seeded for compatibility).", isSystem: true },
  { name: "EMPLOYEE", description: "System employee role (seeded for compatibility).", isSystem: true },
  { name: "MAINTENANCE", description: "System maintenance role (seeded for compatibility).", isSystem: true },
];

async function ensureSystemRoles() {
  for (const r of SYSTEM_ROLES) {
    const name = normName(r.name);
    await prisma.appRole.upsert({
      where: { name },
      update: {
        isSystem: true,
        description: r.description,
      },
      create: {
        name,
        isSystem: true,
        description: r.description,
      },
    });
  }
}

/**
 * Optional: seed a small baseline for system MAINTENANCE role,
 * matching your current loadUserPermissions baseline.
 *
 * This is safe even if you later manage it via UI.
 */
async function ensureMaintenanceBaselinePermissions() {
  const maint = await prisma.appRole.findUnique({
    where: { name: "MAINTENANCE" },
    select: { id: true },
  });
  if (!maint) return;

  const baseline: Permission[] = [
    Permission.VIEW_HOME,
    Permission.VIEW_WORK_ORDERS,
    Permission.CREATE_WORK_ORDERS,
    Permission.UPDATE_OWN_WORK_ORDERS,
    Permission.SUBMIT_OWN_WORK_ORDERS,
  ];

  // Replace-only for this baseline set (keeps it deterministic)
  await prisma.$transaction(async (tx) => {
    await tx.appRolePermission.deleteMany({ where: { roleId: maint.id } });
    await tx.appRolePermission.createMany({
      data: baseline.map((permission) => ({ roleId: maint.id, permission })),
      skipDuplicates: true,
    });
  });
}

/**
 * Backfill: assign users a system AppRole based on legacy enum User.role.
 * - Does NOT remove any existing UserRole rows; it only adds missing ones.
 * - So it's safe to re-run.
 */
async function backfillUserRolesFromEnum() {
  const roleByName = new Map<string, string>();
  const roles = await prisma.appRole.findMany({
    where: { isSystem: true },
    select: { id: true, name: true },
  });

  for (const r of roles) roleByName.set(r.name, r.id);

  // Only map enum values that exist in your schema
  const enumValues = Object.values(Role) as string[];

  // For each enum role, assign the matching system AppRole if present.
  for (const enumRole of enumValues) {
    const appRoleId = roleByName.get(enumRole);
    if (!appRoleId) continue;

    const users = await prisma.user.findMany({
      where: { role: enumRole as Role },
      select: { id: true },
    });

    if (users.length === 0) continue;

    await prisma.userRole.createMany({
      data: users.map((u) => ({ userId: u.id, roleId: appRoleId })),
      skipDuplicates: true,
    });
  }
}

/**
 * Optional: create a starter "Inventory Clerk" business role
 * (not system) to demonstrate the feature.
 */
async function maybeCreateStarterBusinessRole() {
  const exists = await prisma.appRole.findUnique({
    where: { name: "Inventory Clerk" },
    select: { id: true },
  });
  if (exists) return;

  await prisma.appRole.create({
    data: {
      name: "Inventory Clerk",
      description: "Starter business role (edit as needed).",
      isSystem: false,
      permissions: {
        createMany: {
          data: [
            { permission: Permission.VIEW_HOME },
            { permission: Permission.VIEW_CHECKOUT },
            { permission: Permission.CREATE_CHECKOUT },
            { permission: Permission.ADMIN_VIEW_ITEMS },
          ],
          skipDuplicates: true,
        },
      },
    },
    select: { id: true },
  });
}

async function main() {
  console.log("Seeding system roles...");
  await ensureSystemRoles();

  console.log("Seeding MAINTENANCE baseline permissions...");
  await ensureMaintenanceBaselinePermissions();

  console.log("Backfilling user roles from legacy enum...");
  await backfillUserRolesFromEnum();

  console.log("Optional starter business role...");
  await maybeCreateStarterBusinessRole();

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });