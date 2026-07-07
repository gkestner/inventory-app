import type { Prisma } from "@prisma/client";

const DOMAIN_SUFFIXES = new Set(["com", "net", "org", "co", "us", "biz", "io"]);
const BUSINESS_SUFFIXES = new Set(["inc", "llc", "ltd", "corp", "corporation", "company", "co"]);

export function cleanSupplierDisplayName(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeSupplierKey(value: string | null | undefined): string {
  const cleaned = cleanSupplierDisplayName(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (!cleaned) return "";

  const words = cleaned
    .split(/\s+/g)
    .filter((word) => word && !BUSINESS_SUFFIXES.has(word));

  while (words.length > 1 && DOMAIN_SUFFIXES.has(words[words.length - 1])) {
    words.pop();
  }

  return words.join(" ");
}

export async function findSupplierByNormalizedKey(
  tx: Prisma.TransactionClient,
  normalizedKey: string,
): Promise<{ id: string; name: string } | null> {
  if (!normalizedKey) return null;

  const supplier = await tx.supplier.findUnique({
    where: { normalizedKey },
    select: { id: true, name: true },
  });
  if (supplier) return supplier;

  const alias = await tx.supplierAlias.findUnique({
    where: { normalizedKey },
    select: { supplier: { select: { id: true, name: true } } },
  });

  return alias?.supplier ?? null;
}

export async function ensureSupplierForName(
  tx: Prisma.TransactionClient,
  rawName: string,
): Promise<{ id: string; name: string } | null> {
  const name = cleanSupplierDisplayName(rawName);
  const normalizedKey = normalizeSupplierKey(name);
  if (!name || !normalizedKey) return null;

  const existing = await findSupplierByNormalizedKey(tx, normalizedKey);
  if (existing) {
    if (existing.name !== name) {
      await tx.supplierAlias.upsert({
        where: { normalizedKey },
        update: { supplierId: existing.id, name },
        create: { supplierId: existing.id, name, normalizedKey },
      });
    }
    return existing;
  }

  return tx.supplier.create({
    data: {
      name,
      normalizedKey,
      aliases: {
        create: { name, normalizedKey },
      },
    },
    select: { id: true, name: true },
  });
}
