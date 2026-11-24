import { InventoryAlertType, Permission, type PrismaClient } from "@prisma/client";
import { hasAnyPermission, type LoadedPermissions } from "./permissions";

export async function dismissInventoryOrderFlag(
  db: Pick<PrismaClient, "$transaction">,
  permissions: LoadedPermissions,
  flagId: string,
  resolverName: string,
  now = new Date()
): Promise<boolean> {
  if (!hasAnyPermission(permissions, [Permission.ADMIN_EDIT_ITEMS])) throw new Error("Forbidden");
  const id = flagId.trim();
  if (!id) throw new Error("Missing order-more flag");

  return db.$transaction(async (tx) => {
    const flag = await tx.inventoryAlert.findUnique({
      where: { id },
      select: { id: true, itemId: true, checkoutId: true, type: true, resolvedAt: true, note: true },
    });
    if (!flag || flag.resolvedAt) return false;
    if (flag.type !== InventoryAlertType.TECH_REQUEST_ORDER) throw new Error("Not an order-more flag");

    const name = resolverName.trim() || "Inventory administrator";
    const stamp = `[DISMISSED ${now.toISOString()} by ${name}] Dismissed this specific order-more flag from Needs Ordering.`;
    const { count } = await tx.inventoryAlert.updateMany({
      // Target the displayed request by ID. A later request for the same item
      // must never be swept into this dismissal, including concurrent requests.
      where: { id: flag.id, type: InventoryAlertType.TECH_REQUEST_ORDER, resolvedAt: null },
      data: {
        resolvedAt: now,
        resolvedByUserId: permissions.userId,
        resolvedByName: name,
        note: flag.note ? `${flag.note}\n${stamp}` : stamp,
      },
    });
    if (count === 0) return false;

    await tx.auditLog.create({
      data: {
        actorUserId: permissions.userId,
        module: "INVENTORY",
        action: "DISMISS_ORDER_MORE_FLAG",
        entityType: "InventoryAlert",
        entityId: flag.id,
        message: "Dismissed one order-more request; future requests remain eligible.",
        metadata: { itemId: flag.itemId, checkoutId: flag.checkoutId },
      },
    });
    return true;
  });
}
