import { InventoryOrderStatus, Prisma } from "@prisma/client";

// Match the unfinished phases on the live order board. Completed/cancelled
// orders and the editable Item.orderedQty history never count as incoming stock.
export const PENDING_INVENTORY_ORDER_STATUSES: InventoryOrderStatus[] = ["ORDERED", "ARRIVED"];

export const pendingInventoryOrderTotalsSql = Prisma.sql`
  SELECT io."itemId", SUM(io."quantity")::int AS "pendingOrderedQty"
  FROM "InventoryOrder" io
  WHERE io."status" IN (${Prisma.join(
    PENDING_INVENTORY_ORDER_STATUSES.map((status) => Prisma.sql`${status}::"InventoryOrderStatus"`)
  )})
  GROUP BY io."itemId"
`;

export async function loadPendingInventoryOrderQuantities(
  db: Pick<Prisma.TransactionClient, "inventoryOrder">,
  itemIds: string[]
): Promise<Map<string, number>> {
  if (itemIds.length === 0) return new Map();
  const totals = await db.inventoryOrder.groupBy({
    by: ["itemId"],
    where: { itemId: { in: itemIds }, status: { in: PENDING_INVENTORY_ORDER_STATUSES } },
    _sum: { quantity: true },
  });
  return new Map(totals.map((row) => [row.itemId, row._sum.quantity ?? 0]));
}
