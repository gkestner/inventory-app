"use client";

import * as React from "react";
import { signOut } from "next-auth/react";

export type SignOutButtonProps = {
  label?: string;
  callbackUrl?: string;
  style?: React.CSSProperties;
  className?: string;
};

export default function SignOutButton({
  label = "Logout",
  callbackUrl = "/login",
  style,
  className,
}: SignOutButtonProps) {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl })}
      style={style}
      className={className}
    >
      {label}
    </button>
  );
}