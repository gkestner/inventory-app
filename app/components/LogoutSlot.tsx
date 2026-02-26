// app/components/LogoutSlot.tsx
"use client";

import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import SignOutButton from "@/app/components/SignOutButton";

type Props = {
  style?: CSSProperties;
  className?: string;
  callbackUrl?: string;
};

export default function LogoutSlot({ style, className, callbackUrl = "/login" }: Props) {
  const pathname = usePathname();
  const isAdminRoute = (pathname ?? "").startsWith("/admin");

  // Admin pages already have logout in the sidebar layout.
  if (isAdminRoute) return null;

  return <SignOutButton style={style} className={className} callbackUrl={callbackUrl} />;
}