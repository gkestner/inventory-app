"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <main style={{ maxWidth: 380, margin: "80px auto", padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Sign in</h1>

      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
        />

        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
        />

        <button
          onClick={() =>
            signIn("credentials", {
              email,
              password,
              callbackUrl: "/",
            })
          }
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
            Forgot password? Get help signing in ?
          </Link>
        </div>
      </div>
    </main>
  );
}
