"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 20;

  useEffect(() => {
    const id = window.setInterval(() => {
      router.refresh();
    }, safeSeconds * 1000);

    return () => window.clearInterval(id);
  }, [router, safeSeconds]);

  return (
    <div style={{ fontSize: 12, opacity: 0.8 }}>
      Auto-refresh every {safeSeconds}s
    </div>
  );
}
