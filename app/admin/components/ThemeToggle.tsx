// app/admin/components/ThemeToggle.tsx
"use client";

import { useCallback, useMemo, useState } from "react";

type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "theme";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;

  const resolved = mode === "system" ? getSystemTheme() : mode;

  // Use data-theme so the rest of your app can key off CSS vars.
  // If your CSS uses a different mechanism, adjust here only.
  document.documentElement.dataset.theme = resolved;

  // Optional: helps built-in form controls match theme.
  document.documentElement.style.colorScheme = resolved;
}

function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

function storeTheme(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, mode);
}

export default function ThemeToggle() {
  // IMPORTANT: initialize from storage *in the state initializer*
  // so we don't call setState inside an effect.
  const [mode, setMode] = useState<ThemeMode>(() => readStoredTheme());

  // Apply immediately on render (client only). This keeps it simple and avoids effect lint rules.
  // It's safe because it only touches the DOM in the browser.
  if (typeof window !== "undefined") {
    applyTheme(mode);
  }

  const label = useMemo(() => {
    if (mode === "system") return `Theme: System (${getSystemTheme()})`;
    return `Theme: ${mode[0].toUpperCase()}${mode.slice(1)}`;
  }, [mode]);

  const set = useCallback((next: ThemeMode) => {
    setMode(next);
    storeTheme(next);
    applyTheme(next);
  }, []);

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 12, opacity: 0.85 }}>{label}</span>

      <select
        value={mode}
        onChange={(e) => set(e.target.value as ThemeMode)}
        style={{
          padding: "6px 10px",
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "var(--card, var(--background))",
          color: "var(--text)",
          cursor: "pointer",
        }}
        aria-label="Theme"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  );
}
