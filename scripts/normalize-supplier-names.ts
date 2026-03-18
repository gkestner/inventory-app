import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type VariantStats = {
  value: string;
  count: number;
};

function normalizeWhitespace(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function supplierGroupKey(value: string): string {
  return normalizeWhitespace(value).toLocaleLowerCase();
}

function displayRank(value: string): number {
  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);

  if (hasLower && hasUpper) return 0;
  if (hasUpper) return 1;
  if (hasLower) return 2;
  return 3;
}

function chooseCanonicalVariant(variants: VariantStats[]): string {
  return [...variants]
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;

      const rankDiff = displayRank(left.value) - displayRank(right.value);
      if (rankDiff !== 0) return rankDiff;

      return left.value.localeCompare(right.value, undefined, { sensitivity: "base" });
    })[0]?.value ?? "";
}

async function main() {
  const [orders, items] = await Promise.all([
    prisma.inventoryOrder.findMany({
      where: { supplierName: { not: null } },
      select: { id: true, supplierName: true },
    }),
    prisma.item.findMany({
      where: { orderFrom: { not: null } },
      select: { id: true, orderFrom: true },
    }),
  ]);

  const statsByGroup = new Map<string, Map<string, number>>();

  for (const order of orders) {
    const normalized = normalizeWhitespace(order.supplierName);
    if (!normalized) continue;

    const groupKey = supplierGroupKey(normalized);
    const variants = statsByGroup.get(groupKey) ?? new Map<string, number>();
    variants.set(normalized, (variants.get(normalized) ?? 0) + 1);
    statsByGroup.set(groupKey, variants);
  }

  for (const item of items) {
    const normalized = normalizeWhitespace(item.orderFrom);
    if (!normalized) continue;

    const groupKey = supplierGroupKey(normalized);
    const variants = statsByGroup.get(groupKey) ?? new Map<string, number>();
    variants.set(normalized, (variants.get(normalized) ?? 0) + 1);
    statsByGroup.set(groupKey, variants);
  }

  const canonicalByGroup = new Map<string, string>();
  for (const [groupKey, variants] of statsByGroup.entries()) {
    const entries = Array.from(variants.entries()).map(([value, count]) => ({ value, count }));
    canonicalByGroup.set(groupKey, chooseCanonicalVariant(entries));
  }

  let updatedOrders = 0;
  let updatedItems = 0;
  const changedGroups: Array<{ canonical: string; variants: string[] }> = [];

  for (const [groupKey, variants] of statsByGroup.entries()) {
    if (variants.size <= 1) continue;

    const canonical = canonicalByGroup.get(groupKey) ?? "";
    const variantList = Array.from(variants.keys()).filter((value) => value !== canonical);
    if (!canonical || variantList.length === 0) continue;

    changedGroups.push({ canonical, variants: variantList });
  }

  for (const order of orders) {
    const normalized = normalizeWhitespace(order.supplierName);
    if (!normalized) continue;

    const canonical = canonicalByGroup.get(supplierGroupKey(normalized)) ?? normalized;
    if (normalized === canonical) continue;

    await prisma.inventoryOrder.update({
      where: { id: order.id },
      data: { supplierName: canonical },
    });
    updatedOrders += 1;
  }

  for (const item of items) {
    const normalized = normalizeWhitespace(item.orderFrom);
    if (!normalized) continue;

    const canonical = canonicalByGroup.get(supplierGroupKey(normalized)) ?? normalized;
    if (normalized === canonical) continue;

    await prisma.item.update({
      where: { id: item.id },
      data: { orderFrom: canonical },
    });
    updatedItems += 1;
  }

  console.log(`Supplier normalization complete. Updated ${updatedOrders} orders and ${updatedItems} items.`);
  if (changedGroups.length === 0) {
    console.log("No casing variants were found.");
    return;
  }

  for (const group of changedGroups.sort((left, right) => left.canonical.localeCompare(right.canonical, undefined, { sensitivity: "base" }))) {
    console.log(`Canonical: ${group.canonical} <- ${group.variants.join(", ")}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });