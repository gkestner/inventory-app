import type { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";

export function reportItemOptions(where: Prisma.ItemWhereInput = {}) {
  return prisma.item.findMany({
    where,
    orderBy: [{ sku: "asc" }, { id: "asc" }],
    select: {
      id: true,
      labelNumber: true,
      sku: true,
      partNumber: true,
      name: true,
      category: true,
      manufacturer: true,
      orderFrom: true,
    },
  });
}
