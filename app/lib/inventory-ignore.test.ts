import assert from "node:assert/strict";
import { test } from "node:test";
import { Permission, Role, type PrismaClient } from "@prisma/client";
import type { LoadedPermissions } from "./permissions";
import { restoreIgnoredInventoryItems } from "./inventory-ignore";

function permissions(allowAll: boolean, grants: Permission[] = []): LoadedPermissions {
  return { userId: "inventory-editor", role: Role.EMPLOYEE, isAdmin: allowAll, allowAll, permissions: new Set(grants) };
}

function fixture() {
  const items = [
    { id: "379007", reorderIgnored: true, onHandQty: 0, minQty: 3 },
    { id: "another-supplier", reorderIgnored: true, onHandQty: 8, minQty: 2 },
    { id: "already-visible", reorderIgnored: false, onHandQty: 1, minQty: 4 },
  ];
  const audits: Array<{ data: { actorUserId: string; action: string; metadata: { count: number } } }> = [];
  let transactions = 0;
  const tx = {
    item: {
      async updateMany({ where, data }: { where: { reorderIgnored: boolean }; data: { reorderIgnored: boolean } }) {
        const matches = items.filter((item) => item.reorderIgnored === where.reorderIgnored);
        for (const item of matches) item.reorderIgnored = data.reorderIgnored;
        return { count: matches.length };
      },
    },
    auditLog: { async create(args: typeof audits[number]) { audits.push(args); } },
  };
  const db = {
    async $transaction<T>(run: (client: typeof tx) => Promise<T>) { transactions++; return run(tx); },
  } as unknown as Pick<PrismaClient, "$transaction">;
  return { db, items, audits, get transactions() { return transactions; } };
}

test("Unignore All restores ignored items across suppliers and stock levels, preserving quantities", async () => {
  const f = fixture();
  const quantities = f.items.map(({ id, onHandQty, minQty }) => ({ id, onHandQty, minQty }));
  assert.equal(await restoreIgnoredInventoryItems(f.db, permissions(false, [Permission.ADMIN_EDIT_ITEMS])), 2);
  assert.equal(f.items.every((item) => !item.reorderIgnored), true);
  assert.deepEqual(f.items.map(({ id, onHandQty, minQty }) => ({ id, onHandQty, minQty })), quantities);
  assert.equal(f.audits[0].data.actorUserId, "inventory-editor");
  assert.equal(f.audits[0].data.action, "UNIGNORE_ALL");
  assert.deepEqual(f.audits[0].data.metadata, { count: 2 });
});

test("view-only report access cannot unignore items", async () => {
  const f = fixture();
  await assert.rejects(restoreIgnoredInventoryItems(f.db, permissions(false, [Permission.ADMIN_VIEW_ITEMS])), /Forbidden/);
  assert.equal(f.transactions, 0);
  assert.equal(f.items[0].reorderIgnored, true);
  assert.equal(f.audits.length, 0);
});

test("administrators can restore items and repeated submissions safely restore zero", async () => {
  const f = fixture();
  assert.equal(await restoreIgnoredInventoryItems(f.db, permissions(true)), 2);
  assert.equal(await restoreIgnoredInventoryItems(f.db, permissions(true)), 0);
  assert.equal(f.audits.length, 1);
});
