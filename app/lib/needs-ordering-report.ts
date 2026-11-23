import { Prisma } from "@prisma/client";
import { pendingInventoryOrderTotalsSql } from "./inventory-pending-orders";

export type NeedsOrderingRow = {
  id: string;
  sku: string;
  partNumber: string | null;
  name: string;
  cost: Prisma.Decimal | null;
  orderFrom: string | null;
  manufacturer: string | null;
  webUrl: string | null;
  onHandQty: number;
  pendingOrderedQty: number;
  minQty: number;
  reorderIgnored: boolean;
  openTechRequests: number;
  techRequestDetails: string | null;
};

// Shared by the page and Excel export so both use pending orders, not the
// historical Ordered total. A pending order only covers its actual quantity.
export function needsOrderingReportQuery(q = "", includeIgnored = false): Prisma.Sql {
  const search = q.trim();
  const like = `%${search}%`;
  return Prisma.sql`
    WITH tech_req AS (
      SELECT ia."itemId", COUNT(*)::int AS "openTechRequests",
        COALESCE(STRING_AGG(DISTINCT CONCAT(
          COALESCE(NULLIF(BTRIM(COALESCE(ia."createdByName", u."name", u."email", '')), ''), 'Unknown'),
          ' (', TO_CHAR(ia."createdAt" AT TIME ZONE 'America/New_York', 'MM/DD/YYYY'), ')'
        ), ', '), '') AS "techRequestDetails"
      FROM "InventoryAlert" ia
      INNER JOIN "PartsCheckoutTicket" pct ON pct."id" = ia."checkoutId"
      LEFT JOIN "User" u ON u."id" = ia."createdByUserId"
      WHERE ia."type" = 'TECH_REQUEST_ORDER'::"InventoryAlertType"
        AND ia."resolvedAt" IS NULL
        AND pct."needToOrderMore" = true
      GROUP BY ia."itemId"
    ), pending_orders AS (${pendingInventoryOrderTotalsSql})
    SELECT i."id", i."sku", i."partNumber", i."name", i."cost",
      i."orderFrom", i."manufacturer", i."webUrl", i."onHandQty",
      COALESCE(p."pendingOrderedQty", 0) AS "pendingOrderedQty",
      i."minQty", i."reorderIgnored",
      COALESCE(t."openTechRequests", 0) AS "openTechRequests",
      COALESCE(t."techRequestDetails", '') AS "techRequestDetails"
    FROM "Item" i
    LEFT JOIN tech_req t ON t."itemId" = i."id"
    LEFT JOIN pending_orders p ON p."itemId" = i."id"
    WHERE i."active" = true
      AND (
        i."minQty" > (i."onHandQty" + COALESCE(p."pendingOrderedQty", 0))
        OR COALESCE(t."openTechRequests", 0) > 0
      )
      AND ${search ? Prisma.sql`(
        i."sku" ILIKE ${like} OR i."name" ILIKE ${like}
        OR COALESCE(i."partNumber", '') ILIKE ${like}
        OR COALESCE(i."orderFrom", '') ILIKE ${like}
        OR COALESCE(i."manufacturer", '') ILIKE ${like}
      )` : Prisma.sql`TRUE`}
      AND ${includeIgnored ? Prisma.sql`TRUE` : Prisma.sql`i."reorderIgnored" = false`}
    ORDER BY i."reorderIgnored" ASC, i."sku" ASC
  `;
}
