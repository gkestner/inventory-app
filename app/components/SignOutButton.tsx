// app/components/SignOutButton.tsx
"use client";

import { signOut } from "next-auth/react";
import type { CSSProperties, ReactNode } from "react";

type Props = {
  label?: string;
  callbackUrl?: string;
  style?: CSSProperties;
  className?: string;
  children?: ReactNode;
};

export default function SignOutButton({
  label,
  callbackUrl = "/login",
  style,
  className,
  children,
}: Props) {
  const text = children ?? label ?? "Logout";

  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl })}
      style={style}
      className={className}
    >
      {text}
    </button>
  );
}