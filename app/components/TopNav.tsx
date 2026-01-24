"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";

export default function TopNav({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        alignItems: "center",
        padding: 12,
        borderBottom: "1px solid #333",
      }}
    >
      <Link href="/">Home</Link>
      {isAdmin && <Link href="/admin">Admin</Link>}

      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        style={{ marginLeft: "auto", padding: "6px 10px" }}
      >
        Logout
      </button>
    </div>
  );
}
