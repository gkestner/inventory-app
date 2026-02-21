import Link from "next/link";

export default function ForgotPasswordPage() {
  return (
    <main style={{ maxWidth: 560, margin: "80px auto", padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Forgot your password?</h1>
      <p style={{ marginTop: 12, lineHeight: 1.6 }}>
        Reach out to an administrator so they can reset your account password.
      </p>
      <p style={{ marginTop: 8, lineHeight: 1.6 }}>
        If you are the only administrator and got locked out, use the Neon SQL bootstrap script in
        <code style={{ marginLeft: 4 }}>scripts/create-admin-user.sql</code> to restore access.
      </p>

      <div style={{ marginTop: 20 }}>
        <Link href="/login">Back to sign in</Link>
      </div>
    </main>
  );
}
