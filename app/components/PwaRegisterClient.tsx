"use client";

import { useEffect } from "react";

export default function PwaRegisterClient() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch {
        // Non-fatal: app still works without PWA registration.
      }
    };

    void register();
  }, []);

  return null;
}
