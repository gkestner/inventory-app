import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();

function computeLandedUnitCost(args: {
  unitPrice: Decimal | string | number;
  shippingCost?: Decimal | string | number | null;
  taxCost?: Decimal | string | number | null;
  quantity: number;
}): Decimal {
  const unit = new Decimal(args.unitPrice);
  const shipping = args.shippingCost ? new Decimal(args.shippingCost) : new Decimal(0);
  const tax = args.taxCost ? new Decimal(args.taxCost) : new Decimal(0);
  const qty = Number.isFinite(args.quantity) && args.quantity > 0 ? Math.trunc(args.quantity) : 1;

  return new Decimal(unit.add(shipping.add(tax).div(qty)).toFixed(2));
}

function asMoneyString(value: Decimal | null | undefined): string | null {
  return value ? new Decimal(value).toFixed(2) : null;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const orders = await prisma.inventoryOrder.findMany({
    where: {
      unitPrice: { not: null },
    },
    orderBy: [{ itemId: "asc" }, { orderedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      itemId: true,
      quantity: true,
      unitPrice: true,
      shippingCost: true,
      taxCost: true,
      orderedAt: true,
    },
  });

  const latestOrderByItem = new Map<string, (typeof orders)[number]>();
  for (const order of orders) {
    if (!latestOrderByItem.has(order.itemId)) {
      latestOrderByItem.set(order.itemId, order);
    }
  }

  const itemIds = Array.from(latestOrderByItem.keys());
  const items = await prisma.item.findMany({
    where: { id: { in: itemIds } },
    select: {
      id: true,
      sku: true,
      name: true,
      cost: true,
    },
  });

  const itemById = new Map(items.map((item) => [item.id, item]));

  const changes: Array<{
    itemId: string;
    sku: string;
    name: string;
    previousCost: string | null;
    nextCost: string;
    sourceOrderId: string;
    orderedAt: Date;
  }> = [];

  for (const [itemId, order] of latestOrderByItem.entries()) {
    const item = itemById.get(itemId);
    if (!item || !order.unitPrice) continue;

    const landedUnitCost = computeLandedUnitCost({
      unitPrice: order.unitPrice,
      shippingCost: order.shippingCost,
      taxCost: order.taxCost,
      quantity: order.quantity,
    });

    const previousCost = asMoneyString(item.cost);
    const nextCost = landedUnitCost.toFixed(2);

    if (previousCost === nextCost) continue;

    changes.push({
      itemId,
      sku: item.sku,
      name: item.name,
      previousCost,
      nextCost,
      sourceOrderId: order.id,
      orderedAt: order.orderedAt,
    });
  }

  console.log(`Preview mode: ${apply ? "OFF" : "ON"}`);
  console.log(`Items with order history considered: ${itemIds.length}`);
  console.log(`Items needing cost update: ${changes.length}`);

  for (const row of changes.slice(0, 25)) {
    console.log(
      `${row.sku} | ${row.previousCost ?? "null"} -> ${row.nextCost} | order=${row.sourceOrderId} | orderedAt=${row.orderedAt.toISOString()} | ${row.name}`
    );
  }

  if (changes.length > 25) {
    console.log(`...and ${changes.length - 25} more`);
  }

  if (!apply || changes.length === 0) {
    return;
  }

  for (const row of changes) {
    await prisma.item.update({
      where: { id: row.itemId },
      data: {
        cost: new Decimal(row.nextCost),
      },
    });
  }

  console.log(`Applied ${changes.length} item cost updates.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });