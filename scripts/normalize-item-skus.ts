import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type ParsedSku = {
  location: string;
  shelf: string;
  bin: string;
  key: string;
};

function twoDigits(input: string, fallback: string): string {
  const n = String(input ?? "").replace(/\D/g, "").slice(0, 2);
  if (!n) return fallback;
  return n.padStart(2, "0");
}

function sanitizeKey(input: string): string {
  return String(input ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function labelKey(labelNumber: number | null): string {
  if (typeof labelNumber === "number" && Number.isFinite(labelNumber) && labelNumber >= 0) {
    return Math.trunc(labelNumber).toString(36).toUpperCase();
  }
  return "";
}

function parseSku(sku: string, itemId: string, labelNumber: number | null): ParsedSku {
  const raw = String(sku ?? "").trim();

  // Preferred format: LLSSBB - KEY
  const compact = raw.match(/^(\d{6})\s*-\s*([A-Za-z0-9]+)$/);
  if (compact) {
    return {
      location: compact[1].slice(0, 2),
      shelf: compact[1].slice(2, 4),
      bin: compact[1].slice(4, 6),
      key: sanitizeKey(compact[2]),
    };
  }

  // Legacy format: ZZ-LLSSBB-KEY
  const zoned = raw.match(/^([^-]+)-([^ -]+)-(.+)$/);
  if (zoned) {
    const middleDigits = String(zoned[2] ?? "").replace(/\D/g, "");
    const location = twoDigits(middleDigits.slice(0, 2), "01");
    const shelf = twoDigits(middleDigits.slice(2, 4), "01");
    const bin = twoDigits(middleDigits.slice(4, 6), "01");
    const key = sanitizeKey(zoned[3]);
    if (key) {
      return { location, shelf, bin, key };
    }
  }

  // Fallback: derive location from any leading digits, key from label number or item id.
  const leadingDigits = raw.match(/^\D*(\d{2})/)?.[1] ?? "01";
  const fallbackKey = sanitizeKey(labelKey(labelNumber)) || sanitizeKey(itemId.slice(-8)) || "ITEM";

  return {
    location: twoDigits(leadingDigits, "01"),
    shelf: "01",
    bin: "01",
    key: fallbackKey,
  };
}

function buildSku(location: string, shelf: string, bin: string, key: string): string {
  return `${location}${shelf}${bin} - ${key}`;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const items = await prisma.item.findMany({
    select: {
      id: true,
      sku: true,
      labelNumber: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const usedSkus = new Set<string>();
  const updates: Array<{ id: string; fromSku: string; toSku: string }> = [];

  for (const item of items) {
    const parsed = parseSku(item.sku, item.id, item.labelNumber ?? null);
    let key = parsed.key;
    if (!key) {
      key = sanitizeKey(labelKey(item.labelNumber ?? null)) || sanitizeKey(item.id.slice(-8)) || "ITEM";
    }

    let nextSku = buildSku(parsed.location, parsed.shelf, parsed.bin, key);

    // Ensure uniqueness in one pass (DB also enforces unique sku)
    if (usedSkus.has(nextSku)) {
      const suffixBase = sanitizeKey(labelKey(item.labelNumber ?? null)) || sanitizeKey(item.id.slice(-6)) || "X";
      nextSku = buildSku(parsed.location, parsed.shelf, parsed.bin, `${key}${suffixBase}`);
    }

    usedSkus.add(nextSku);

    if (nextSku !== item.sku) {
      updates.push({ id: item.id, fromSku: item.sku, toSku: nextSku });
    }
  }

  console.log(`items: ${items.length}`);
  console.log(`updates needed: ${updates.length}`);

  if (updates.length > 0) {
    console.log("sample updates:");
    for (const row of updates.slice(0, 15)) {
      console.log(`- ${row.fromSku} -> ${row.toSku}`);
    }
  }

  if (dryRun) {
    console.log("dry-run mode; no changes applied");
    return;
  }

  for (const row of updates) {
    await prisma.item.update({
      where: { id: row.id },
      data: { sku: row.toSku },
    });
  }

  console.log(`applied updates: ${updates.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
