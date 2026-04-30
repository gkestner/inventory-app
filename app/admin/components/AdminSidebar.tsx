"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";

import SignOutButton from "@/app/components/SignOutButton";
import type { AdminSidebarItemPreference } from "@/app/lib/user-preferences";

export type AdminSidebarCatalogItem = {
  key: string;
  label: string;
  href: string;
  tag: string;
  group: string;
};

type RenderedSidebarItem = {
  id: string;
  label: string;
  href: string;
  tag: string;
  group: string;
  type: "preset" | "custom";
};

type Props = {
  email: string;
  roleLabel: string;
  availableItems: AdminSidebarCatalogItem[];
  defaultItems: AdminSidebarItemPreference[];
  initialItems: AdminSidebarItemPreference[];
};

function buildRenderedItems(
  items: AdminSidebarItemPreference[],
  presetMap: Map<string, AdminSidebarCatalogItem>,
): RenderedSidebarItem[] {
  const rendered: RenderedSidebarItem[] = [];

  items.forEach((item, index) => {
    if (item.type === "preset") {
      const preset = presetMap.get(item.key);
      if (!preset) return;
      rendered.push({
        id: `preset:${item.key}:${index}`,
        label: preset.label,
        href: preset.href,
        tag: preset.tag,
        group: preset.group,
        type: "preset",
      });
      return;
    }

    rendered.push({
      id: `custom:${item.href}:${index}`,
      label: item.label,
      href: item.href,
      tag: "Custom",
      group: "Custom",
      type: "custom",
    });
  });

  return rendered;
}

function normalizeCustomHref(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed.replace(/^\/+/, "")}`;
}

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminSidebar({ email, roleLabel, availableItems, defaultItems, initialItems }: Props) {
  const pathname = usePathname() ?? "";
  const [items, setItems] = useState<AdminSidebarItemPreference[]>(initialItems);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [customLabel, setCustomLabel] = useState<string>("");
  const [customHref, setCustomHref] = useState<string>("");
  const [editorMessage, setEditorMessage] = useState<string>("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const brand: CSSProperties = {
    fontWeight: 900,
    fontSize: 16,
    marginBottom: 10,
  };

  const meta: CSSProperties = {
    fontSize: 12,
    color: "var(--muted)",
    marginBottom: 14,
    lineHeight: 1.3,
  };

  const nav: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  };

  const linkStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "10px 10px",
    textDecoration: "none",
    color: "var(--foreground)",
    background: "var(--surface)",
    fontSize: 13,
  };

  const activeLinkStyle: CSSProperties = {
    borderColor: "color-mix(in srgb, var(--brand) 45%, var(--border))",
    background: "color-mix(in srgb, var(--brand) 12%, var(--surface))",
  };

  const pill: CSSProperties = {
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid var(--border)",
    background: "var(--surface-2)",
    color: "var(--muted)",
    whiteSpace: "nowrap",
  };

  const sectionTitle: CSSProperties = {
    marginTop: 14,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: 800,
    color: "var(--muted)",
    letterSpacing: 0.2,
  };

  const actionButton: CSSProperties = {
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--surface-2)",
    color: "var(--foreground)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 800,
  };

  const fieldStyle: CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--foreground)",
    outline: "none",
    boxSizing: "border-box",
  };

  const presetMap = useMemo(() => new Map(availableItems.map((item) => [item.key, item])), [availableItems]);
  const renderedItems = useMemo(() => buildRenderedItems(items, presetMap), [items, presetMap]);
  const selectedPresetKeys = useMemo(
    () => new Set(items.filter((item) => item.type === "preset").map((item) => item.key)),
    [items],
  );
  const addablePresets = useMemo(
    () => availableItems.filter((item) => !selectedPresetKeys.has(item.key)),
    [availableItems, selectedPresetKeys],
  );

  async function saveItems(nextItems: AdminSidebarItemPreference[]) {
    setItems(nextItems);
    setSaveState("saving");
    setEditorMessage("");

    try {
      const res = await fetch("/api/me/admin-sidebar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sidebar: { items: nextItems } }),
      });

      if (!res.ok) throw new Error("Save failed");
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 900);
    } catch {
      setSaveState("error");
      setEditorMessage("Sidebar save failed. Try again.");
    }
  }

  function moveItem(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    const nextItems = items.slice();
    const [item] = nextItems.splice(index, 1);
    nextItems.splice(nextIndex, 0, item);
    void saveItems(nextItems);
  }

  function removeItem(index: number) {
    const nextItems = items.filter((_, itemIndex) => itemIndex !== index);
    void saveItems(nextItems);
  }

  function addPreset() {
    if (!selectedKey) return;
    const nextItems = [...items, { type: "preset", key: selectedKey } satisfies AdminSidebarItemPreference];
    setSelectedKey("");
    void saveItems(nextItems);
  }

  function addCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = customLabel.trim();
    const href = normalizeCustomHref(customHref);

    if (!label || !href) {
      setEditorMessage("Custom pages need both a label and an app path.");
      return;
    }

    const nextItems = [...items, { type: "custom", label, href } satisfies AdminSidebarItemPreference];
    setCustomLabel("");
    setCustomHref("");
    setEditorMessage("");
    void saveItems(nextItems);
  }

  function resetDefaults() {
    void saveItems(defaultItems);
  }

  return (
    <>
      <div style={brand}>Admin</div>
      <div style={meta}>
        <div>{email}</div>
        <div style={{ marginTop: 2 }}>Role: {roleLabel}</div>
      </div>

      <div style={sectionTitle}>Sidebar Pages</div>
      <nav style={nav}>
        {renderedItems.length > 0 ? (
          renderedItems.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              style={isActivePath(pathname, item.href) ? { ...linkStyle, ...activeLinkStyle } : linkStyle}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
              <span style={pill}>{item.tag}</span>
            </Link>
          ))
        ) : (
          <div style={{ ...linkStyle, justifyContent: "center", color: "var(--muted)" }}>No pages pinned yet.</div>
        )}
      </nav>

      <details style={{ marginTop: 16 }} open={renderedItems.length === 0}>
        <summary style={{ ...sectionTitle, marginTop: 0, cursor: "pointer" }}>Customize Sidebar</summary>
        <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>Current order</div>
            {items.length > 0 ? (
              items.map((item, index) => {
                const preset = item.type === "preset" ? presetMap.get(item.key) : null;
                const label = item.type === "preset" ? preset?.label ?? item.key : item.label;
                const sublabel = item.type === "preset" ? preset?.group ?? "Preset" : item.href;

                return (
                  <div
                    key={`${item.type}-${index}-${label}`}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: 10,
                      display: "grid",
                      gap: 8,
                      background: "var(--surface)",
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>{label}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{sublabel}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button type="button" style={actionButton} onClick={() => moveItem(index, -1)} disabled={index === 0}>
                        Up
                      </button>
                      <button
                        type="button"
                        style={actionButton}
                        onClick={() => moveItem(index, 1)}
                        disabled={index === items.length - 1}
                      >
                        Down
                      </button>
                      <button type="button" style={actionButton} onClick={() => removeItem(index)}>
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Add a page below to start building your sidebar.</div>
            )}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>Add existing page</div>
            <select style={fieldStyle} value={selectedKey} onChange={(event) => setSelectedKey(event.currentTarget.value)}>
              <option value="">Choose a page…</option>
              {addablePresets.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.group} - {item.label}
                </option>
              ))}
            </select>
            <button type="button" style={actionButton} onClick={addPreset} disabled={!selectedKey}>
              Add Page
            </button>
          </div>

          <form style={{ display: "grid", gap: 8 }} onSubmit={addCustom}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>Add custom page</div>
            <input
              style={fieldStyle}
              value={customLabel}
              onChange={(event) => setCustomLabel(event.currentTarget.value)}
              placeholder="Sidebar label"
            />
            <input
              style={fieldStyle}
              value={customHref}
              onChange={(event) => setCustomHref(event.currentTarget.value)}
              placeholder="/admin/reports/your-page"
            />
            <button type="submit" style={actionButton}>
              Add Custom Page
            </button>
          </form>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={actionButton} onClick={resetDefaults}>
              Reset Default Sidebar
            </button>
            <span style={{ fontSize: 12, color: saveState === "error" ? "#f87171" : "var(--muted)" }}>
              {saveState === "saving"
                ? "Saving…"
                : saveState === "saved"
                  ? "Saved"
                  : editorMessage || "Changes save to your account."}
            </span>
          </div>
        </div>
      </details>

      <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
        <Link href="/settings" style={{ ...linkStyle, justifyContent: "center" }}>
          Account Settings
        </Link>

        <Link href="/" style={{ ...linkStyle, justifyContent: "center", background: "var(--surface-2)" }}>
          ← Back to App
        </Link>

        <SignOutButton
          label="Logout"
          callbackUrl="/login"
          style={{ ...linkStyle, justifyContent: "center", cursor: "pointer" }}
        />
      </div>
    </>
  );
}