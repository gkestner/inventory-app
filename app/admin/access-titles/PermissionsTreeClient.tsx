// app/admin/access-titles/PermissionsTreeClient.tsx
"use client";

import { useMemo, useState } from "react";

type Group = {
  key: string;
  label: string;
  perms: string[];
};

export default function PermissionsTreeClient({
  allPermissions,
  selectedPermissions,
}: {
  allPermissions: string[];
  selectedPermissions: string[];
}) {
  const [q, setQ] = useState("");

  const selected = useMemo(() => new Set(selectedPermissions), [selectedPermissions]);

  const GROUPS: Group[] = useMemo(() => {
    const byPrefix: Array<[string, string]> = [
      ["VIEW_", "Navigation / View"],
      ["CREATE_", "Create"],
      ["UPDATE_", "Update"],
      ["SUBMIT_", "Submit"],
      ["ADMIN_VIEW_", "Admin: View"],
      ["ADMIN_EDIT_", "Admin: Edit"],
      ["ADMIN_IMPORT_EXPORT_", "Admin: Import/Export"],
      ["ADMIN_DELETE_", "Admin: Delete"],
      ["ADMIN_EXPORT_", "Admin: Export"],
    ];

    const used = new Set<string>();
    const groups: Group[] = [];

    for (const [prefix, label] of byPrefix) {
      const perms = allPermissions.filter((p) => p.startsWith(prefix));
      if (perms.length) {
        perms.forEach((p) => used.add(p));
        groups.push({ key: prefix, label, perms });
      }
    }

    const remainder = allPermissions.filter((p) => !used.has(p));
    if (remainder.length) groups.push({ key: "OTHER", label: "Other", perms: remainder });

    for (const g of groups) g.perms = [...g.perms].sort((a, b) => a.localeCompare(b));
    return groups;
  }, [allPermissions]);

  const filteredGroups = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return GROUPS;

    return GROUPS.map((g) => {
      const perms = g.perms.filter((p) => p.toLowerCase().includes(qq));
      return { ...g, perms };
    }).filter((g) => g.perms.length > 0);
  }, [GROUPS, q]);

  function isGroupAllSelected(perms: string[]) {
    if (!perms.length) return false;
    for (const p of perms) if (!selected.has(p)) return false;
    return true;
  }

  function isGroupSomeSelected(perms: string[]) {
    for (const p of perms) if (selected.has(p)) return true;
    return false;
  }

  function applySelectAll(value: boolean) {
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="permissions"]')
    );
    for (const el of inputs) el.checked = value;
  }

  function applyGroupToggle(perms: string[], value: boolean) {
    const set = new Set(perms);
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="permissions"]')
    );
    for (const el of inputs) {
      if (set.has(el.value)) el.checked = value;
    }
  }

  const totalVisible = filteredGroups.reduce((acc, g) => acc + g.perms.length, 0);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search permissions…"
          style={{
            flex: "1 1 280px",
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(128,128,128,0.25)",
            background: "var(--background)",
            color: "var(--foreground)",
            outline: "none",
            fontSize: 14,
          }}
        />

        <button
          type="button"
          onClick={() => applySelectAll(true)}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(128,128,128,0.25)",
            background: "rgba(33,150,243,0.18)",
            color: "var(--foreground)",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Select all
        </button>

        <button
          type="button"
          onClick={() => applySelectAll(false)}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(128,128,128,0.25)",
            background: "rgba(244,67,54,0.14)",
            color: "var(--foreground)",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Clear all
        </button>

        <div style={{ fontSize: 12, opacity: 0.75 }}>
          Visible: <b>{totalVisible}</b> / Total: <b>{allPermissions.length}</b>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {filteredGroups.map((g) => {
          const allSel = isGroupAllSelected(g.perms);
          const someSel = isGroupSomeSelected(g.perms);

          return (
            <details
              key={g.key}
              open
              style={{
                border: "1px solid rgba(128,128,128,0.25)",
                borderRadius: 14,
                padding: 10,
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <summary style={{ cursor: "pointer", fontWeight: 900, display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={allSel}
                  ref={(el) => {
                    if (!el) return;
                    el.indeterminate = !allSel && someSel;
                  }}
                  onChange={(e) => applyGroupToggle(g.perms, e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                <span>{g.label}</span>
                <span style={{ fontSize: 12, opacity: 0.7 }}>
                  ({g.perms.length} permission{g.perms.length === 1 ? "" : "s"})
                </span>
              </summary>

              <div
                style={{
                  marginTop: 10,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                  gap: 8,
                }}
              >
                {g.perms.map((perm) => (
                  <label
                    key={perm}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      padding: "6px 8px",
                      borderRadius: 10,
                      border: "1px solid rgba(128,128,128,0.18)",
                      background: "rgba(255,255,255,0.02)",
                    }}
                  >
                    <input
                      type="checkbox"
                      name="permissions"
                      value={perm}
                      defaultChecked={selected.has(perm)}
                      style={{ width: 18, height: 18 }}
                    />
                    <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                      {perm}
                    </span>
                  </label>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}