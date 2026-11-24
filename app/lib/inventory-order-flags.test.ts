import assert from "node:assert/strict";
import { test } from "node:test";
import { InventoryAlertType, Permission, Role, type PrismaClient } from "@prisma/client";
import type { LoadedPermissions } from "./permissions";
import { dismissInventoryOrderFlag } from "./inventory-order-flags";

const editor: LoadedPermissions = {
  userId: "editor", role: Role.EMPLOYEE, isAdmin: false, allowAll: false,
  permissions: new Set([Permission.ADMIN_EDIT_ITEMS]),
};

function fixture(addConcurrentFlag = false) {
  const newFlag = (id: string, type: InventoryAlertType = InventoryAlertType.TECH_REQUEST_ORDER) => ({
    id, itemId: "part-379007", checkoutId: `checkout-${id}`, type,
    resolvedAt: null as Date | null, note: "Technician requested reorder.",
    resolvedByUserId: null as string | null, resolvedByName: null as string | null,
  });
  const flags = [newFlag("displayed-request"), newFlag("another-persons-request"), newFlag("stock-alert", InventoryAlertType.BELOW_MIN)];
  const audits: Array<{ data: { entityId: string; actorUserId: string; action: string } }> = [];
  let transactions = 0;
  const tx = {
    inventoryAlert: {
      async findUnique({ where }: { where: { id: string } }) { return flags.find((flag) => flag.id === where.id) ?? null; },
      async updateMany({ where, data }: {
        where: { id: string; type: InventoryAlertType; resolvedAt: null };
        data: { resolvedAt: Date; resolvedByUserId: string | null; resolvedByName: string; note: string };
      }) {
        if (addConcurrentFlag) { flags.push(newFlag("new-request-during-dismissal")); addConcurrentFlag = false; }
        const matches = flags.filter((flag) => flag.id === where.id && flag.type === where.type && flag.resolvedAt === where.resolvedAt);
        for (const flag of matches) Object.assign(flag, data);
        return { count: matches.length };
      },
    },
    auditLog: { async create(args: typeof audits[number]) { audits.push(args); } },
    // A dismissal must not alter stock, permanent Ignore settings, or checkout history.
    item: { async update() { throw new Error("Unexpected item write"); }, async updateMany() { throw new Error("Unexpected item write"); } },
    partsCheckoutTicket: { async update() { throw new Error("Unexpected checkout write"); } },
  };
  const db = { async $transaction<T>(run: (client: typeof tx) => Promise<T>) { transactions++; return run(tx); } } as unknown as Pick<PrismaClient, "$transaction">;
  return { db, flags, audits, get transactions() { return transactions; } };
}

test("dismissal resolves only the selected request, preserving other people's and concurrent new flags", async () => {
  const f = fixture(true);
  const now = new Date("2026-11-24T13:00:00Z");
  assert.equal(await dismissInventoryOrderFlag(f.db, editor, "displayed-request", "Inventory Editor", now), true);
  assert.equal(f.flags[0].resolvedAt, now);
  assert.equal(f.flags[0].resolvedByUserId, "editor");
  assert.match(f.flags[0].note, /^Technician requested reorder\.\n\[DISMISSED/);
  assert.deepEqual(f.flags.filter((flag) => flag.type === InventoryAlertType.TECH_REQUEST_ORDER && flag.resolvedAt === null).map((flag) => flag.id), ["another-persons-request", "new-request-during-dismissal"]);
  assert.equal(f.flags[2].resolvedAt, null);
  assert.equal(f.audits[0].data.entityId, "displayed-request");
  assert.equal(f.audits[0].data.actorUserId, "editor");
});

test("dismissing an already handled request is safe and does not dismiss later requests", async () => {
  const f = fixture();
  assert.equal(await dismissInventoryOrderFlag(f.db, editor, "displayed-request", "Editor"), true);
  assert.equal(await dismissInventoryOrderFlag(f.db, editor, "displayed-request", "Editor"), false);
  assert.equal(await dismissInventoryOrderFlag(f.db, editor, "missing-request", "Editor"), false);
  assert.equal(f.flags[1].resolvedAt, null);
  assert.equal(f.audits.length, 1);
});

test("view-only access cannot dismiss flags, and stock alerts cannot be dismissed through this action", async () => {
  const f = fixture();
  await assert.rejects(dismissInventoryOrderFlag(f.db, { ...editor, permissions: new Set([Permission.ADMIN_VIEW_ITEMS]) }, "displayed-request", "Viewer"), /Forbidden/);
  assert.equal(f.transactions, 0);
  await assert.rejects(dismissInventoryOrderFlag(f.db, editor, "stock-alert", "Editor"), /Not an order-more flag/);
  assert.equal(f.flags.every((flag) => flag.resolvedAt === null), true);
  assert.equal(f.audits.length, 0);
});
