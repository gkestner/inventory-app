CREATE TABLE "AppConfig" (
  "id" TEXT NOT NULL,
  "liveOrdersAddedRetentionDays" INTEGER NOT NULL DEFAULT 14,
  "orderHistoryPerPage" INTEGER NOT NULL DEFAULT 25,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AppConfig" ("id", "liveOrdersAddedRetentionDays", "orderHistoryPerPage")
VALUES ('default', 14, 25)
ON CONFLICT ("id") DO NOTHING;