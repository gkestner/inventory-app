import Link from "next/link";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";

import { prisma } from "@/app/lib/prisma";

type SearchParams = {
  email?: string;
  error?: string;
};

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

  const canShowQuestion =
    !!userForQuestion &&
    userForQuestion.active &&
    userForQuestion.securityQuestionsEnabled &&
    !!userForQuestion.securityQuestionPrompt &&
    !!userForQuestion.securityQuestionAnswerHash;

  async function resetWithSecurityQuestionAction(formData: FormData) {
    "use server";

    const email = normEmail(formData.get("email"));
    const answer = nonEmpty(formData.get("securityAnswer"));
    const newPassword = nonEmpty(formData.get("newPassword"));
    const confirmPassword = nonEmpty(formData.get("confirmPassword"));

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

    if (!user || !user.active || !user.securityQuestionsEnabled || !user.securityQuestionAnswerHash) {
      redirect(
        "/forgot-password?email=" +
          encodeURIComponent(email) +
          "&error=" +
          encodeURIComponent("Security question reset is not enabled for this account.")
      );
    }

    const answerOk = await bcrypt.compare(answer, user.securityQuestionAnswerHash);
    if (!answerOk) {
      redirect(
        "/forgot-password?email=" +
          encodeURIComponent(email) +
          "&error=" +
          encodeURIComponent("Security answer is incorrect.")
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    redirect("/login?reset=1");
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

      {canShowQuestion ? (
        <form action={resetWithSecurityQuestionAction} style={{ display: "grid", gap: 10, marginTop: 16 }}>
          <input type="hidden" name="email" value={email} />

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 700 }}>Security Question</span>
            <div style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}>{userForQuestion.securityQuestionPrompt}</div>
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
      ) : email ? (
        <p style={{ marginTop: 14, opacity: 0.8 }}>
          Security question reset is not enabled for this account. Contact an administrator.
        </p>
      ) : null}

      <div style={{ marginTop: 20 }}>
        <Link href="/login">Back to sign in</Link>
      </div>
    </main>
  );
}
