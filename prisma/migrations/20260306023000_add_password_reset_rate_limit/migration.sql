-- Create shared password-reset rate limiting store.
CREATE TABLE "PasswordResetRateLimit" (
  "key" TEXT NOT NULL,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "blockedUntil" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PasswordResetRateLimit_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "PasswordResetRateLimit_blockedUntil_idx" ON "PasswordResetRateLimit"("blockedUntil");
CREATE INDEX "PasswordResetRateLimit_lastAttemptAt_idx" ON "PasswordResetRateLimit"("lastAttemptAt");
