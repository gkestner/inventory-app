import { Permission, type PrismaClient } from "@prisma/client";
import { hasAnyPermission, type LoadedPermissions } from "./permissions";

export async function restoreIgnoredInventoryItems(
  db: Pick<PrismaClient, "$transaction">,
  permissions: LoadedPermissions
): Promise<number> {
  if (!hasAnyPermission(permissions, [Permission.ADMIN_EDIT_ITEMS])) {
    throw new Error("Forbidden");
  }

  return db.$transaction(async (tx) => {
    const { count } = await tx.item.updateMany({
      where: { reorderIgnored: true },
      data: { reorderIgnored: false },
    });

    if (count > 0) {
      await tx.auditLog.create({
        data: {
          actorUserId: permissions.userId,
          module: "INVENTORY",
          action: "UNIGNORE_ALL",
          entityType: "Item",
          message: `Restored ordering checks for ${count} ignored item${count === 1 ? "" : "s"}.`,
          metadata: { count },
        },
      });
    }

    return count;
  });
}
