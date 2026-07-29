// app/admin/access-titles/PermissionsTreeClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type CatalogEntry = {
  permission: string;
  module: string;
  path: string[];
  label: string;
  description?: string;
};

type UiEntry = CatalogEntry;

type UiNode =
  | { kind: "group"; key: string; name: string; children: UiNode[] }
  | { kind: "leaf"; key: string; entry: UiEntry };

function uniqStrings(vals: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of vals) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function buildPermissionTreeForModuleFromCatalog(module: string, catalog: CatalogEntry[]): UiNode[] {
  const entries = catalog.filter((e) => e.module === module).slice();

  entries.sort((a, b) => {
    const ap = (a.path ?? []).join(" > ");
    const bp = (b.path ?? []).join(" > ");
    if (ap !== bp) return ap.localeCompare(bp);
    return a.label.localeCompare(b.label);
  });

  const root: UiNode = { kind: "group", key: `module:${module}`, name: module, children: [] };

  function getOrCreateGroup(parent: UiNode[], name: string, key: string) {
    const existing = parent.find((n) => n.kind === "group" && n.key === key);
    if (existing && existing.kind === "group") return existing;
    const g: UiNode = { kind: "group", key, name, children: [] };
    parent.push(g);
    return g as Extract<UiNode, { kind: "group" }>;
  }

  for (const entry of entries) {
    let children = (root as Extract<UiNode, { kind: "group" }>).children;
    let currentKey = `module:${module}`;

    const segs = entry.path?.length ? entry.path : ["General"];
    for (const seg of segs) {
      currentKey += `/${seg}`;
      const g = getOrCreateGroup(children, seg, currentKey);
      children = g.children;
    }

    children.push({ kind: "leaf", key: `perm:${entry.permission}`, entry });
  }

  return (root as Extract<UiNode, { kind: "group" }>).children;
}

function collectLeafPerms(node: UiNode): string[] {
  if (node.kind === "leaf") return [node.entry.permission];
  const out: string[] = [];
  for (const ch of node.children) out.push(...collectLeafPerms(ch));
  return out;
}

function filterTreeByQuery(nodes: UiNode[], qLower: string): UiNode[] {
  if (!qLower) return nodes;

  function keepNode(n: UiNode): UiNode | null {
    if (n.kind === "leaf") {
      const hay = `${n.entry.permission} ${n.entry.label} ${n.entry.description ?? ""} ${(n.entry.path ?? []).join(" ")}`.toLowerCase();
      return hay.includes(qLower) ? n : null;
    }

    const keptChildren = n.children.map(keepNode).filter(Boolean) as UiNode[];
    if (keptChildren.length === 0) return null;
    return { ...n, children: keptChildren };
  }

  return nodes.map(keepNode).filter(Boolean) as UiNode[];
}

function TreeNode({
  node,
  selected,
  setSelected,
  depth,
}: {
  node: UiNode;
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
  depth: number;
}) {
  if (node.kind === "leaf") {
    const checked = selected.has(node.entry.permission);

    return (
      <label
        style={{
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid rgba(128,128,128,0.18)",
          background: "rgba(255,255,255,0.02)",
          marginLeft: depth ? depth * 14 : 0,
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            const next = new Set(selected);
            if (e.target.checked) next.add(node.entry.permission);
            else next.delete(node.entry.permission);
            setSelected(next);
          }}
          style={{ width: 18, height: 18, marginTop: 3 }}
        />

        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ fontWeight: 900, lineHeight: 1.2 }}>{node.entry.label}</div>
          <div
            style={{
              fontSize: 12,
              opacity: 0.85,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              lineHeight: 1.2,
            }}
          >
            {node.entry.permission}
          </div>
          {node.entry.description ? (
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2, lineHeight: 1.25 }}>
              {node.entry.description}
            </div>
          ) : null}
        </div>
      </label>
    );
  }

  const leafPerms = uniqStrings(collectLeafPerms(node));
  const allSelected = leafPerms.length > 0 && leafPerms.every((p) => selected.has(p));
  const someSelected = leafPerms.some((p) => selected.has(p));

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid rgba(128,128,128,0.25)",
          background: "rgba(255,255,255,0.02)",
          marginLeft: depth ? depth * 14 : 0,
        }}
      >
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => {
            if (!el) return;
            el.indeterminate = !allSelected && someSelected;
          }}
          onChange={(e) => {
            const next = new Set(selected);
            if (e.target.checked) leafPerms.forEach((p) => next.add(p));
            else leafPerms.forEach((p) => next.delete(p));
            setSelected(next);
          }}
          style={{ width: 18, height: 18 }}
        />

        <div style={{ fontWeight: 900, lineHeight: 1.2 }}>
          {node.name}{" "}
          <span style={{ fontSize: 12, opacity: 0.75 }}>
            ({leafPerms.filter((p) => selected.has(p)).length}/{leafPerms.length})
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {node.children.map((ch) => (
          <TreeNode key={ch.key} node={ch} selected={selected} setSelected={setSelected} depth={depth + 1} />
        ))}
      </div>
    </div>
  );
}

export default function PermissionsTreeClient({
  allPermissions,
  selectedPermissions,
  catalog,
}: {
  allPermissions: string[];
  selectedPermissions: string[];
  catalog: CatalogEntry[];
}) {
  const allPermStrings = useMemo(() => uniqStrings(allPermissions.map((p) => String(p))), [allPermissions]);

  const catalogByPerm = useMemo(() => {
    const m = new Map<string, UiEntry>();
    for (const ce of catalog) m.set(String(ce.permission), ce);
    return m;
  }, [catalog]);

  const modules = useMemo(() => {
    const s = new Set<string>();
    for (const e of catalog) s.add(e.module);
    // include "Other" if unknown perms exist
    const unknown = allPermStrings.filter((p) => !catalogByPerm.has(p));
    if (unknown.length) s.add("Other");
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [catalog, allPermStrings, catalogByPerm]);

  const initialSelected = useMemo(
    () => new Set(uniqStrings(selectedPermissions.map(String)).filter((p) => allPermStrings.includes(p))),
    [selectedPermissions, allPermStrings]
  );

  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  const [q, setQ] = useState("");

  useEffect(() => setSelected(initialSelected), [initialSelected]);

  const defaultModule = useMemo(() => modules[0] ?? "Other", [modules]);
  const [activeModule, setActiveModule] = useState<string>(defaultModule);
  useEffect(() => setActiveModule(defaultModule), [defaultModule]);

  const moduleTree: UiNode[] = useMemo(() => {
    const qLower = q.trim().toLowerCase();

    if (activeModule === "Other") {
      const unknownEntries: UiEntry[] = allPermStrings
        .filter((p) => !catalogByPerm.has(p))
        .map((p) => ({
          permission: p,
          module: "Other",
          path: ["Uncategorized"],
          label: p,
        }));

      const root: UiNode = { kind: "group", key: "module:Other", name: "Other", children: [] };
      root.children = buildPermissionTreeForModuleFromCatalog("Other", unknownEntries);
      return filterTreeByQuery(root.children, qLower);
    }

    const rawTree = buildPermissionTreeForModuleFromCatalog(activeModule, catalog);

    // Only show permissions that exist in current Prisma enum list
    const filterExisting = (nodes: UiNode[]): UiNode[] => {
      const walk = (n: UiNode): UiNode | null => {
        if (n.kind === "leaf") {
          return allPermStrings.includes(n.entry.permission) ? n : null;
        }
        const children = n.children.map(walk).filter(Boolean) as UiNode[];
        if (!children.length) return null;
        return { ...n, children };
      };
      return nodes.map(walk).filter(Boolean) as UiNode[];
    };

    const trimmed = filterExisting(rawTree);
    return filterTreeByQuery(trimmed, qLower);
  }, [activeModule, q, catalog, allPermStrings, catalogByPerm]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
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
          onClick={() => setSelected(new Set(allPermStrings))}
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
          onClick={() => setSelected(new Set())}
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
          Selected: <b>{selected.size}</b> / Total: <b>{allPermStrings.length}</b>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 12 }}>
        <aside
          style={{
            border: "1px solid rgba(128,128,128,0.25)",
            borderRadius: 14,
            padding: 10,
            background: "rgba(255,255,255,0.02)",
            height: "fit-content",
            position: "sticky",
            top: 12,
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Modules</div>

          <div style={{ display: "grid", gap: 8 }}>
            {modules.map((m) => {
              const active = m === activeModule;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setActiveModule(m)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: active ? "1px solid rgba(33,150,243,0.65)" : "1px solid rgba(128,128,128,0.25)",
                    background: active ? "rgba(33,150,243,0.12)" : "rgba(255,255,255,0.02)",
                    color: "var(--foreground)",
                    fontWeight: active ? 900 : 800,
                    cursor: "pointer",
                  }}
                >
                  {m}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75, lineHeight: 1.45 }}>
            Pick a module to edit. Parent checkboxes apply to all descendants.
          </div>
        </aside>

        <section style={{ display: "grid", gap: 10 }}>
          {moduleTree.length === 0 ? (
            <div style={{ opacity: 0.8, padding: 10 }}>No permissions match this module/search.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {moduleTree.map((n) => (
                <TreeNode key={n.key} node={n} selected={selected} setSelected={setSelected} depth={0} />
              ))}
            </div>
          )}

          {/* submit values */}
          <div style={{ display: "none" }}>
            {Array.from(selected)
              .sort((a, b) => a.localeCompare(b))
              .map((p) => (
                <input key={p} type="hidden" name="permissions" value={p} />
              ))}
          </div>
        </section>
      </div>
    </div>
  );
}
