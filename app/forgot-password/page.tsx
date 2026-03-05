import Link from "next/link";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { createHash } from "crypto";

import { prisma } from "@/app/lib/prisma";

type SearchParams = {
  email?: string;
  error?: string;
  ok?: string;
};

const FORGOT_RESET_WINDOW_MS = 15 * 60 * 1000;
const FORGOT_RESET_MAX_ATTEMPTS = 5;
const DUMMY_ANSWER_HASH = bcrypt.hashSync("dummy-security-answer", 10);

type ForgotResetAttemptState = {
  count: number;
  windowStart: number;
  blockedUntil: number;
};

type ResetRateLimitRow = {
  key: string;
  failedCount: number;
  windowStartedAt: Date;
  blockedUntil: Date | null;
};

const forgotResetAttempts: Map<string, ForgotResetAttemptState> =
  (globalThis as unknown as { __forgotResetAttempts?: Map<string, ForgotResetAttemptState> }).__forgotResetAttempts ??
  new Map<string, ForgotResetAttemptState>();

(globalThis as unknown as { __forgotResetAttempts?: Map<string, ForgotResetAttemptState> }).__forgotResetAttempts =
  forgotResetAttempts;

function clientIpFromHeaders(h: Headers): string {
  const xff = h.get("x-forwarded-for") ?? "";
  const firstIp = xff.split(",")[0]?.trim();
  return firstIp || "unknown";
}

function getAttemptKey(email: string, ip: string): string {
  return createHash("sha256").update(`${email}|${ip}`).digest("hex");
}

function getRetrySecondsIfBlockedFromMemory(key: string, nowMs: number): number | null {
  const state = forgotResetAttempts.get(key);
  if (!state) return null;
  if (state.blockedUntil <= nowMs) return null;
  return Math.ceil((state.blockedUntil - nowMs) / 1000);
}

function registerFailedAttemptInMemory(key: string, nowMs: number): void {
  const existing = forgotResetAttempts.get(key);
  if (!existing || nowMs - existing.windowStart > FORGOT_RESET_WINDOW_MS) {
    forgotResetAttempts.set(key, {
      count: 1,
      windowStart: nowMs,
      blockedUntil: 0,
    });
    return;
  }

  const nextCount = existing.count + 1;
  const next: ForgotResetAttemptState = {
    count: nextCount,
    windowStart: existing.windowStart,
    blockedUntil: existing.blockedUntil,
  };

  if (nextCount >= FORGOT_RESET_MAX_ATTEMPTS) {
    next.blockedUntil = nowMs + FORGOT_RESET_WINDOW_MS;
  }

  forgotResetAttempts.set(key, next);
}

function clearFailedAttemptsInMemory(key: string): void {
  forgotResetAttempts.delete(key);
}

function resetRateLimitStore() {
  return (prisma as unknown as { passwordResetRateLimit?: { findUnique: Function; create: Function; update: Function; deleteMany: Function } }).
    passwordResetRateLimit;
}

async function getRetrySecondsIfBlocked(key: string, nowMs: number): Promise<number | null> {
  const store = resetRateLimitStore();
  if (!store) return getRetrySecondsIfBlockedFromMemory(key, nowMs);

  try {
    const row = (await store.findUnique({
      where: { key },
      select: { blockedUntil: true },
    })) as { blockedUntil: Date | null } | null;

    if (!row?.blockedUntil) return null;
    const blockedUntilMs = row.blockedUntil.getTime();
    if (blockedUntilMs <= nowMs) return null;
    return Math.ceil((blockedUntilMs - nowMs) / 1000);
  } catch {
    return getRetrySecondsIfBlockedFromMemory(key, nowMs);
  }
}

async function registerFailedAttempt(key: string, nowMs: number): Promise<void> {
  const store = resetRateLimitStore();
  if (!store) {
    registerFailedAttemptInMemory(key, nowMs);
    return;
  }

  try {
    const now = new Date(nowMs);
    const row = (await store.findUnique({
      where: { key },
      select: {
        key: true,
        failedCount: true,
        windowStartedAt: true,
        blockedUntil: true,
      },
    })) as ResetRateLimitRow | null;

    if (!row) {
      await store.create({
        data: {
          key,
          failedCount: 1,
          windowStartedAt: now,
          blockedUntil: null,
          lastAttemptAt: now,
        },
      });
      return;
    }

    const blockedMs = row.blockedUntil?.getTime() ?? 0;
    if (blockedMs > nowMs) {
      await store.update({
        where: { key },
        data: { lastAttemptAt: now },
      });
      return;
    }

    const outsideWindow = nowMs - row.windowStartedAt.getTime() > FORGOT_RESET_WINDOW_MS;
    if (outsideWindow) {
      await store.update({
        where: { key },
        data: {
          failedCount: 1,
          windowStartedAt: now,
          blockedUntil: null,
          lastAttemptAt: now,
        },
      });
      return;
    }

    const nextCount = row.failedCount + 1;
    const nextBlockedUntil =
      nextCount >= FORGOT_RESET_MAX_ATTEMPTS ? new Date(nowMs + FORGOT_RESET_WINDOW_MS) : null;

    await store.update({
      where: { key },
      data: {
        failedCount: nextCount,
        blockedUntil: nextBlockedUntil,
        lastAttemptAt: now,
      },
    });
  } catch {
    registerFailedAttemptInMemory(key, nowMs);
  }
}

async function clearFailedAttempts(key: string): Promise<void> {
  const store = resetRateLimitStore();
  if (!store) {
    clearFailedAttemptsInMemory(key);
    return;
  }

  try {
    await store.deleteMany({ where: { key } });
  } catch {
    clearFailedAttemptsInMemory(key);
  }
}

function normEmail(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim().toLowerCase();
}

function nonEmpty(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const email = String(sp.email ?? "").trim().toLowerCase();
  const error = String(sp.error ?? "").trim();
  const ok = String(sp.ok ?? "").trim();

  const userForQuestion = email
    ? await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          active: true,
          securityQuestionsEnabled: true,
          securityQuestionPrompt: true,
          securityQuestionAnswerHash: true,
        },
      })
    : null;

  const canShowRealQuestion =
    !!userForQuestion &&
    userForQuestion.active &&
    userForQuestion.securityQuestionsEnabled &&
    !!userForQuestion.securityQuestionPrompt &&
    !!userForQuestion.securityQuestionAnswerHash;

  const showResetForm = email.length > 0;
  const promptText = canShowRealQuestion
    ? String(userForQuestion?.securityQuestionPrompt ?? "")
    : "Security question on file";

  async function resetWithSecurityQuestionAction(formData: FormData) {
    "use server";

    const email = normEmail(formData.get("email"));
    const answer = nonEmpty(formData.get("securityAnswer"));
    const newPassword = nonEmpty(formData.get("newPassword"));
    const confirmPassword = nonEmpty(formData.get("confirmPassword"));

    const requestHeaders = await headers();
    const ip = clientIpFromHeaders(requestHeaders);
    const key = getAttemptKey(email || "unknown", ip);
    const nowMs = Date.now();
    const retrySeconds = await getRetrySecondsIfBlocked(key, nowMs);

    if (retrySeconds !== null) {
      redirect(
        "/forgot-password?email=" +
          encodeURIComponent(email) +
          "&error=" +
          encodeURIComponent(`Too many attempts. Try again in ${retrySeconds} seconds.`)
      );
    }

    if (!email) redirect("/forgot-password?error=" + encodeURIComponent("Email is required."));
    if (!answer) redirect("/forgot-password?email=" + encodeURIComponent(email) + "&error=" + encodeURIComponent("Security answer is required."));
    if (!newPassword || !confirmPassword) {
      redirect(
        "/forgot-password?email=" +
          encodeURIComponent(email) +
          "&error=" +
          encodeURIComponent("Enter and confirm your new password.")
      );
    }
    if (newPassword !== confirmPassword) {
      redirect(
        "/forgot-password?email=" +
          encodeURIComponent(email) +
          "&error=" +
          encodeURIComponent("New Password and Confirm Password do not match.")
      );
    }
    if (newPassword.length < 8) {
      redirect(
        "/forgot-password?email=" +
          encodeURIComponent(email) +
          "&error=" +
          encodeURIComponent("Password must be at least 8 characters.")
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        active: true,
        securityQuestionsEnabled: true,
        securityQuestionAnswerHash: true,
      },
    });

    // Always run a compare to reduce account-enumeration timing differences.
    const compareHash = user?.securityQuestionAnswerHash || DUMMY_ANSWER_HASH;
    const answerOk = await bcrypt.compare(answer, compareHash);

    const canReset =
      !!user &&
      user.active &&
      user.securityQuestionsEnabled &&
      !!user.securityQuestionAnswerHash &&
      answerOk;

    if (!canReset) {
      await registerFailedAttempt(key, nowMs);
      redirect(
        "/forgot-password?email=" +
          encodeURIComponent(email) +
          "&error=" +
          encodeURIComponent("Could not reset password. Check your details and try again.")
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await clearFailedAttempts(key);

    redirect("/forgot-password?ok=" + encodeURIComponent("Password reset successful. You can sign in now."));
  }

  return (
    <main style={{ maxWidth: 560, margin: "80px auto", padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Forgot your password?</h1>
      <p style={{ marginTop: 12, lineHeight: 1.6 }}>
        Enter your email to load your security question, then reset your password.
      </p>

      {error ? (
        <div style={{ marginTop: 12, padding: 10, border: "1px solid #c66", borderRadius: 8, background: "#fff5f5" }}>
          {error}
        </div>
      ) : null}

      {ok ? (
        <div style={{ marginTop: 12, padding: 10, border: "1px solid #6a6", borderRadius: 8, background: "#f4fff4" }}>
          {ok}
        </div>
      ) : null}

      <form method="get" action="/forgot-password" style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <input
          name="email"
          type="email"
          required
          defaultValue={email}
          placeholder="Email"
          style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
        />
        <button type="submit" style={{ padding: 10, borderRadius: 8 }}>
          Show Security Question
        </button>
      </form>

      {showResetForm ? (
        <form action={resetWithSecurityQuestionAction} style={{ display: "grid", gap: 10, marginTop: 16 }}>
          <input type="hidden" name="email" value={email} />

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 700 }}>Security Question</span>
            <div style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}>{promptText}</div>
          </label>

          <input
            name="securityAnswer"
            required
            placeholder="Your answer"
            style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
          />

          <input
            name="newPassword"
            type="password"
            required
            placeholder="New password"
            autoComplete="new-password"
            style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
          />

          <input
            name="confirmPassword"
            type="password"
            required
            placeholder="Confirm new password"
            autoComplete="new-password"
            style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
          />

          <button type="submit" style={{ padding: 10, borderRadius: 8 }}>
            Reset Password
          </button>
        </form>
      ) : null}

      <div style={{ marginTop: 20 }}>
        <Link href="/login">Back to sign in</Link>
      </div>
    </main>
  );
}
