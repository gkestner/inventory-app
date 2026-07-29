import type { PrismaClient } from "@prisma/client";

import { cleanSupplierDisplayName, normalizeSupplierKey } from "@/app/lib/suppliers";

export type SupplierDirectorySort = "name" | "profile" | "orders" | "latest" | "payment" | "terms";
export type SupplierDirectoryDirection = "asc" | "desc";

export type SupplierDirectoryRow = {
  key: string;
  displayName: string;
  supplierId: string | null;
  paymentMethod: string | null;
  terms: string | null;
  accountNumber: string | null;
  phone: string | null;
  extension: string | null;
  email: string | null;
  partsSummary: string | null;
  notes: string | null;
  aliases: string[];
  partLabels: string[];
  orderCount: number;
  latestOrderAt: Date | null;
  hasProfile: boolean;
};

type SupplierBucket = Omit<SupplierDirectoryRow, "aliases" | "partLabels"> & {
  aliases: Set<string>;
  partLabels: Set<string>;
};

export function parseSupplierSort(value: string | null | undefined): SupplierDirectorySort {
  if (value === "profile" || value === "orders" || value === "latest" || value === "payment" || value === "terms") {
    return value;
  }
  return "name";
}

export function parseSupplierDirection(value: string | null | undefined): SupplierDirectoryDirection {
  return value === "desc" ? "desc" : "asc";
}

function addNameToBucket(buckets: Map<string, SupplierBucket>, rawName: string | null | undefined): SupplierBucket | null {
  const displayName = cleanSupplierDisplayName(rawName);
  const key = normalizeSupplierKey(displayName);
  if (!displayName || !key) return null;

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = {
      key,
      displayName,
      supplierId: null,
      paymentMethod: null,
      terms: null,
      accountNumber: null,
      phone: null,
      extension: null,
      email: null,
      partsSummary: null,
      notes: null,
      aliases: new Set<string>(),
      partLabels: new Set<string>(),
      orderCount: 0,
      latestOrderAt: null,
      hasProfile: false,
    };
    buckets.set(key, bucket);
  }

  bucket.aliases.add(displayName);
  return bucket;
}

function partLabel(item: { sku: string; partNumber: string | null; name: string }): string {
  return `${item.sku}${item.partNumber ? ` - ${item.partNumber}` : ""} - ${item.name}`;
}

export async function loadSupplierDirectory(db: PrismaClient): Promise<SupplierDirectoryRow[]> {
  const [profiles, orderRows, itemRows] = await Promise.all([
    db.supplier.findMany({
      include: { aliases: { orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    }),
    db.inventoryOrder.findMany({
      where: {
        supplierName: { not: null },
      },
      select: {
        supplierName: true,
        orderedAt: true,
        item: { select: { sku: true, partNumber: true, name: true } },
      },
      orderBy: { orderedAt: "desc" },
    }),
    db.item.findMany({
      where: {
        orderFrom: { not: null },
      },
      select: {
        orderFrom: true,
        sku: true,
        partNumber: true,
        name: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const buckets = new Map<string, SupplierBucket>();

  for (const supplier of profiles) {
    const bucket = addNameToBucket(buckets, supplier.name);
    if (!bucket) continue;

    bucket.displayName = supplier.name;
    bucket.supplierId = supplier.id;
    bucket.paymentMethod = supplier.paymentMethod;
    bucket.terms = supplier.terms;
    bucket.accountNumber = supplier.accountNumber;
    bucket.phone = supplier.phone;
    bucket.extension = supplier.extension;
    bucket.email = supplier.email;
    bucket.partsSummary = supplier.partsSummary;
    bucket.notes = supplier.notes;
    bucket.hasProfile = true;

    for (const alias of supplier.aliases) {
      bucket.aliases.add(alias.name);
    }
  }

  for (const order of orderRows) {
    const bucket = addNameToBucket(buckets, order.supplierName);
    if (!bucket) continue;
    bucket.orderCount += 1;
    if (!bucket.latestOrderAt || order.orderedAt > bucket.latestOrderAt) bucket.latestOrderAt = order.orderedAt;
    if (order.item) bucket.partLabels.add(partLabel(order.item));
  }

  for (const item of itemRows) {
    const bucket = addNameToBucket(buckets, item.orderFrom);
    if (!bucket) continue;
    bucket.partLabels.add(partLabel(item));
  }

  return Array.from(buckets.values()).map((supplier) => ({
    ...supplier,
    aliases: Array.from(supplier.aliases).sort((a, b) => a.localeCompare(b)),
    partLabels: Array.from(supplier.partLabels).sort((a, b) => a.localeCompare(b)),
  }));
}

export function filterSupplierDirectory(rows: SupplierDirectoryRow[], query: string): SupplierDirectoryRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;

  return rows.filter((supplier) => {
    const haystack = [
      supplier.displayName,
      ...supplier.aliases,
      supplier.paymentMethod,
      supplier.terms,
      supplier.accountNumber,
      supplier.phone,
      supplier.email,
      supplier.partsSummary,
      supplier.notes,
      ...supplier.partLabels,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function sortSupplierDirectory(
  rows: SupplierDirectoryRow[],
  sort: SupplierDirectorySort,
  direction: SupplierDirectoryDirection,
): SupplierDirectoryRow[] {
  const dir = direction === "desc" ? -1 : 1;
  return rows.slice().sort((a, b) => {
    let result = 0;

    if (sort === "profile") {
      result = Number(b.hasProfile) - Number(a.hasProfile);
    } else if (sort === "orders") {
      result = a.orderCount - b.orderCount;
    } else if (sort === "latest") {
      result = (a.latestOrderAt?.getTime() ?? 0) - (b.latestOrderAt?.getTime() ?? 0);
    } else if (sort === "payment") {
      result = (a.paymentMethod ?? "").localeCompare(b.paymentMethod ?? "");
    } else if (sort === "terms") {
      result = (a.terms ?? "").localeCompare(b.terms ?? "");
    } else {
      result = a.displayName.localeCompare(b.displayName);
    }

    if (result === 0) result = a.displayName.localeCompare(b.displayName);
    return result * dir;
  });
}
