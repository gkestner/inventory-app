"use client";

import { useEffect, useMemo, useState } from "react";

type ThemeMode = "system" | "light" | "dark";
type DensityMode = "comfortable" | "compact";

const STORAGE_THEME = "theme";
const STORAGE_DENSITY = "ui_density";
const STORAGE_REDUCED_MOTION = "ui_reduce_motion";
const STORAGE_LABELS_COPIES = "labels_default_copies";
const STORAGE_LABELS_AUTOPRINT = "labels_autoprint";
const STORAGE_LABELS_AUTOCLOSE = "labels_autoclose";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(STORAGE_THEME);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

function readDensity(): DensityMode {
  if (typeof window === "undefined") return "comfortable";
  const raw = window.localStorage.getItem(STORAGE_DENSITY);
  return raw === "compact" ? "compact" : "comfortable";
}

function readReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_REDUCED_MOTION) === "1";
}

function readLabelsCopies(): number {
  if (typeof window === "undefined") return 1;
  const raw = Number(window.localStorage.getItem(STORAGE_LABELS_COPIES) || "1");
  if (!Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(20, Math.floor(raw)));
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return fallback;
}

function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const resolved = mode === "system" ? getSystemTheme() : mode;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

function applyDensity(mode: DensityMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.density = mode;
}

function applyReducedMotion(on: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.reducedMotion = on ? "true" : "false";
}

export default function SettingsPanel() {
  const [theme, setTheme] = useState<ThemeMode>(() => readTheme());
  const [density, setDensity] = useState<DensityMode>(() => readDensity());
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => readReducedMotion());

  const [labelsCopies, setLabelsCopies] = useState<number>(() => readLabelsCopies());
  const [labelsAutoprint, setLabelsAutoprint] = useState<boolean>(() => readBool(STORAGE_LABELS_AUTOPRINT, false));
  const [labelsAutoclose, setLabelsAutoclose] = useState<boolean>(() => readBool(STORAGE_LABELS_AUTOCLOSE, false));

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_THEME, theme);

    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  useEffect(() => {
    applyDensity(density);
    window.localStorage.setItem(STORAGE_DENSITY, density);
  }, [density]);

  useEffect(() => {
    applyReducedMotion(reducedMotion);
    window.localStorage.setItem(STORAGE_REDUCED_MOTION, reducedMotion ? "1" : "0");
  }, [reducedMotion]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_LABELS_COPIES, String(labelsCopies));
  }, [labelsCopies]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_LABELS_AUTOPRINT, labelsAutoprint ? "1" : "0");
  }, [labelsAutoprint]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_LABELS_AUTOCLOSE, labelsAutoclose ? "1" : "0");
  }, [labelsAutoclose]);

  const themeLabel = useMemo(() => {
    if (theme === "system") return `System (${getSystemTheme()})`;
    return theme[0].toUpperCase() + theme.slice(1);
  }, [theme]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Appearance</h2>

        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.8 }}>Theme</span>
            <select
              value={theme}
              onChange={(e) => setTheme((e.target.value as ThemeMode) || "system")}
              style={{ padding: "8px 10px", borderRadius: 10 }}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <span style={{ fontSize: 12, opacity: 0.75 }}>Current: {themeLabel}</span>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.8 }}>Table density</span>
            <select
              value={density}
              onChange={(e) => setDensity((e.target.value as DensityMode) || "comfortable")}
              style={{ padding: "8px 10px", borderRadius: 10 }}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={reducedMotion}
              onChange={(e) => setReducedMotion(e.target.checked)}
            />
            Reduce motion and animations
          </label>
        </div>
      </section>

      <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Label Printing</h2>

        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.8 }}>Default copies</span>
            <input
              type="number"
              min={1}
              max={20}
              value={labelsCopies}
              onChange={(e) => {
                const n = Number(e.target.value || "1");
                setLabelsCopies(Math.max(1, Math.min(20, Number.isFinite(n) ? Math.floor(n) : 1)));
              }}
              style={{ width: 120, padding: "8px 10px", borderRadius: 10 }}
            />
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={labelsAutoprint}
              onChange={(e) => setLabelsAutoprint(e.target.checked)}
            />
            Open print dialog automatically
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={labelsAutoclose}
              onChange={(e) => setLabelsAutoclose(e.target.checked)}
            />
            Auto-close label popup after print
          </label>
        </div>
      </section>

      <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Quick Actions</h2>
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => {
              setTheme("system");
              setDensity("comfortable");
              setReducedMotion(false);
              setLabelsCopies(1);
              setLabelsAutoprint(false);
              setLabelsAutoclose(false);
            }}
            style={{ padding: "8px 12px", borderRadius: 10, fontWeight: 700 }}
          >
            Reset Preferences to Default
          </button>
        </div>
      </section>
    </div>
  );
}
