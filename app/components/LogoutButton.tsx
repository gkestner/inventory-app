"use client";

import { signOut } from "next-auth/react";
import type { CSSProperties } from "react";

export default function LogoutButton({ style }: { style?: CSSProperties }) {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      style={style}
    >
      Logout
    </button>
  );
}
