import assert from "node:assert/strict";
import { test } from "node:test";
import type { InventoryOrderStatus, PrismaClient } from "@prisma/client";

test("reorder recommendations use unfinished orders while preserving the Ordered history", async () => {
  const items = [
    { id: "379007", orderedQty: 6, onHandQty: 0, minQty: 3 },
    { id: "partially-covered", orderedQty: 100, onHandQty: 1, minQty: 5 },
    { id: "fully-covered", orderedQty: 0, onHandQty: 0, minQty: 3 },
  ].map((item) => ({
    ...item, sku: item.id, name: item.id, active: true,
    createdAt: new Date("2025-01-01T00:00:00Z"), suggestedMinQtyOverride: item.minQty,
  }));
  const orders: Array<{ itemId: string; status: InventoryOrderStatus; quantity: number }> = [
    { itemId: "379007", status: "ADDED_TO_INVENTORY", quantity: 6 },
    { itemId: "379007", status: "CANCELLED", quantity: 10 },
    { itemId: "partially-covered", status: "ORDERED", quantity: 1 },
    { itemId: "partially-covered", status: "ARRIVED", quantity: 1 },
    { itemId: "partially-covered", status: "ADDED_TO_INVENTORY", quantity: 20 },
    { itemId: "fully-covered", status: "ORDERED", quantity: 3 },
  ];
  type GroupArgs = { where: { itemId: { in: string[] }; status: { in: InventoryOrderStatus[] } } };
  const db = {
    appConfig: { findUnique: async () => null, upsert: async () => { throw new Error("Unexpected write"); } },
    item: { findMany: async () => items },
    partsCheckoutTicket: { findMany: async () => [] },
    inventoryOrder: {
      findMany: async () => [], // No lead-time samples are needed for these fixtures.
      groupBy: async ({ where }: GroupArgs) => {
        const totals = new Map<string, number>();
        for (const order of orders) {
          if (!where.itemId.in.includes(order.itemId) || !where.status.in.includes(order.status)) continue;
          totals.set(order.itemId, (totals.get(order.itemId) ?? 0) + order.quantity);
        }
        return [...totals].map(([itemId, quantity]) => ({ itemId, _sum: { quantity } }));
      },
    },
  };
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db as unknown as PrismaClient;
  const { getInventoryDemandRecommendations } = await import("./inventory-demand");
  const recommendations = await getInventoryDemandRecommendations({ now: new Date("2026-11-23T12:00:00Z") });
  const actual = recommendations.map((row) => ({
    id: row.itemId, history: row.orderedQty, pending: row.pendingOrderedQty,
    available: row.availableQty, reorder: row.suggestedReorderQty90Day,
  }));
  assert.deepEqual(actual, [
    { id: "379007", history: 6, pending: 0, available: 0, reorder: 3 },
    { id: "partially-covered", history: 100, pending: 2, available: 3, reorder: 2 },
    { id: "fully-covered", history: 0, pending: 3, available: 3, reorder: 0 },
  ]);
  assert.equal(items[0].orderedQty, 6);
});
