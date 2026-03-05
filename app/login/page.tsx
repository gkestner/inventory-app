"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const resetOk = searchParams.get("reset") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await signIn("credentials", {
      email,
      password,
      callbackUrl: "/",
    });
  }

  return (
    <main style={{ maxWidth: 380, margin: "80px auto", padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Sign in</h1>

      {resetOk ? (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            border: "1px solid #8bbf8b",
            borderRadius: 8,
            background: "#f3fff3",
            fontSize: 13,
          }}
        >
          Your password was reset. Sign in with your new password.
        </div>
      ) : null}

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <input
          name="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
        />

        <input
          name="password"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
        />

        <button
          type="submit"
          style={{ padding: 10, borderRadius: 8 }}
        >
          Sign in
        </button>

        <div
          style={{
            textAlign: "center",
            marginTop: 8,
            padding: 12,
            border: "1px solid var(--foreground)",
            borderRadius: 8,
          }}
        >
          <p style={{ margin: 0, marginBottom: 8, fontSize: 13 }}>Can&apos;t access your account?</p>
          <Link
            href="/forgot-password"
            style={{
              fontSize: 14,
              textDecoration: "underline",
              textUnderlineOffset: 2,
              color: "var(--foreground)",
              fontWeight: 700,
            }}
          >
            Forgot password? Reset with security question
          </Link>
        </div>
      </form>
    </main>
  );
}
