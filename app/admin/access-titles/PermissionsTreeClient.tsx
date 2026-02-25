// app/admin/access-titles/PermissionsTreeClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { PERMISSION_CATALOG, type PermissionCatalogEntry } from "@/app/lib/permissionCatalog";

type TreeNode =
  | {
      kind: "group";
      key: string;
      label: string;
      children: TreeNode[];
      perms: string[]; // all descendant perms
    }
  | {
      kind: "leaf";
      key: string;
      entry: PermissionCatalogEntry & { permission: string };
      perms: string[]; // [permission]
    };

function uniqSorted(vals: string[]) {
  return Array.from(new Set(vals)).sort((a, b) => a.localeCompare(b));
}

function buildTree(entries: Array<PermissionCatalogEntry & { permission: string }>, moduleName: string): TreeNode[] {
  type Group = {
    key: string;
    label: string;
    children: Map<string, Group>;
    leaves: Array<PermissionCatalogEntry & { permission: string }>;
  };

  const root: Group = {
    key: `module:${moduleName}`,
    label: moduleName,
    children: new Map(),
    leaves: [],
  };

  const makeGroup = (parent: Group, seg: string, key: string) => {
    const existing = parent.children.get(key);
    if (existing) return existing;
    const g: Group = { key, label: seg, children: new Map(), leaves: [] };
    parent.children.set(key, g);
    return g;
  };

  for (const e of entries) {
    let cur = root;
    const path = e.path ?? [];
    let keyAcc = `module:${moduleName}`;
    for (const seg of path) {
      keyAcc += `/${seg}`;
      cur = makeGroup(cur, seg, keyAcc);
    }
    cur.leaves.push(e);
  }

  const groupToNode = (g: Group): TreeNode => {
    const childGroups = Array.from(g.children.values()).sort((a, b) => a.label.localeCompare(b.label));
    const leaves = [...g.leaves].sort((a, b) => a.label.localeCompare(b.label));

    const children: TreeNode[] = [
      ...childGroups.map(groupToNode),
      ...leaves.map((e) => ({
        kind: "leaf" as const,
        key: `perm:${e.permission}`,
        entry: e,
        perms: [e.permission],
      })),
    ];

    const perms = uniqSorted(children.flatMap((c) => c.perms));
    return { kind: "group", key: g.key, label: g.label, children, perms };
  };

  const rootChildren = Array.from(root.children.values()).sort((a, b) => a.label.localeCompare(b.label));
  const rootLeaves = [...root.leaves].sort((a, b) => a.label.localeCompare(b.label));

  return [
    ...rootChildren.map(groupToNode),
    ...rootLeaves.map((e) => ({
      kind: "leaf" as const,
      key: `perm:${e.permission}`,
      entry: e,
      perms: [e.permission],
    })),
  ];
}

function filterTreeByQuery(nodes: TreeNode[], q: string): TreeNode[] {
  const qq = q.trim().toLowerCase();
  if (!qq) return nodes;

  const matchLeaf = (leaf: Extract<TreeNode, { kind: "leaf" }>) => {
    const e = leaf.entry;
    const hay = `${e.label} ${e.description ?? ""} ${(e.path ?? []).join(" ")} ${e.permission}`.toLowerCase();
    return hay.includes(qq);
  };

  const recur = (n: TreeNode): TreeNode | null => {
    if (n.kind === "leaf") return matchLeaf(n) ? n : null;

    const kids = n.children.map(recur).filter((x): x is TreeNode => Boolean(x));
    if (kids.length === 0) return null;

    const perms = uniqSorted(kids.flatMap((c) => c.perms));
    return { ...n, children: kids, perms };
  };

  return nodes.map(recur).filter((x): x is TreeNode => Boolean(x));
}

export default function PermissionsTreeClient({
  allPermissions,
  selectedPermissions,
}: {
  allPermissions: string[];
  selectedPermissions: string[];
}) {
  const [q, setQ] = useState("");
  const [activeModule, setActiveModule] = useState<string>("");

  const [selectedSet, setSelectedSet] = useState<Set<string>>(() => new Set(selectedPermissions));

  useEffect(() => {
    setSelectedSet(new Set(selectedPermissions));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPermissions.join("|")]);

  const allPermSet = useMemo(() => new Set(allPermissions), [allPermissions]);

  const catalogByPerm = useMemo(() => {
    const m = new Map<string, PermissionCatalogEntry>();
    for (const e of PERMISSION_CATALOG) m.set(String(e.permission), e);
    return m;
  }, []);

  const entries = useMemo(() => {
    const out: Array<PermissionCatalogEntry & { permission: string }> = [];
    for (const p of allPermissions) {
      const ce = catalogByPerm.get(p);
      if (ce) {
        out.push({ ...ce, permission: p });
      } else {
        out.push({
          permission: p,
          module: "Other",
          path: ["Uncategorized"],
          label: p,
          description: "Not yet mapped in permissionCatalog.ts",
        });
      }
    }
    return out;
  }, [allPermissions, catalogByPerm]);

  const modules = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) s.add(e.module);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  useEffect(() => {
    if (!activeModule) setActiveModule(modules[0] ?? "Other");
  }, [activeModule, modules]);

  const moduleEntries = useMemo(() => entries.filter((e) => e.module === activeModule), [entries, activeModule]);

  const fullTree = useMemo(() => buildTree(moduleEntries, activeModule), [moduleEntries, activeModule]);
  const visibleTree = useMemo(() => filterTreeByQuery(fullTree, q), [fullTree, q]);

  const visiblePerms = useMemo(() => {
    const collect = (nodes: TreeNode[]): string[] => nodes.flatMap((n) => (n.kind === "leaf" ? [n.entry.permission] : n.perms));
    return uniqSorted(collect(visibleTree));
  }, [visibleTree]);

  const moduleAllPerms = useMemo(() => uniqSorted(moduleEntries.map((e) => e.permission)), [moduleEntries]);

  function isAllSelected(perms: string[]) {
    if (perms.length === 0) return false;
    for (const p of perms) if (!selectedSet.has(p)) return false;
    return true;
  }

  function isSomeSelected(perms: string[]) {
    for (const p of perms) if (selectedSet.has(p)) return true;
    return false;
  }

  function togglePerm(p: string, value: boolean) {
    if (!allPermSet.has(p)) return;
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (value) next.add(p);
      else next.delete(p);
      return next;
    });
  }

  function toggleMany(perms: string[], value: boolean) {
    const filtered = perms.filter((p) => allPermSet.has(p));
    setSelectedSet((prev) => {
      const next = new Set(prev);
      for (const p of filtered) {
        if (value) next.add(p);
        else next.delete(p);
      }
      return next;
    });
  }

  function selectAllVisible() {
    toggleMany(visiblePerms, true);
  }
  function clearAllVisible() {
    toggleMany(visiblePerms, false);
  }
  function selectAllModule() {
    toggleMany(moduleAllPerms, true);
  }
  function clearAllModule() {
    toggleMany(moduleAllPerms, false);
  }

  const border = "1px solid rgba(128,128,128,0.25)";
  const surface = "var(--background)";
  const fg = "var(--foreground)";

  function Tree({ nodes, depth }: { nodes: TreeNode[]; depth: number }) {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {nodes.map((n) => {
          if (n.kind === "leaf") {
            const perm = n.entry.permission;
            return (
              <label
                key={n.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "20px 1fr",
                  gap: 10,
                  alignItems: "start",
                  padding: "8px 10px",
                  borderRadius: 12,
                  border: "1px solid rgba(128,128,128,0.18)",
                  background: "rgba(255,255,255,0.02)",
                  marginLeft: depth ? depth * 12 : 0,
                }}
              >
                <input
                  type="checkbox"
                  name="permissions"
                  value={perm}
                  checked={selectedSet.has(perm)}
                  onChange={(e) => togglePerm(perm, e.target.checked)}
                  style={{ width: 18, height: 18, marginTop: 2 }}
                />
                <div style={{ display: "grid", gap: 2 }}>
                  <div style={{ fontWeight: 900 }}>{n.entry.label}</div>
                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.75,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    }}
                  >
                    {perm}
                  </div>
                  {n.entry.description ? <div style={{ fontSize: 12, opacity: 0.75 }}>{n.entry.description}</div> : null}
                </div>
              </label>
            );
          }

          const allSel = isAllSelected(n.perms);
          const someSel = isSomeSelected(n.perms);

          return (
            <details
              key={n.key}
              open={depth < 2}
              style={{
                border,
                borderRadius: 14,
                padding: 10,
                background: "rgba(255,255,255,0.02)",
                marginLeft: depth ? depth * 12 : 0,
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  fontWeight: 900,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  listStylePosition: "inside",
                }}
              >
                <input
                  type="checkbox"
                  checked={allSel}
                  ref={(el) => {
                    if (!el) return;
                    el.indeterminate = !allSel && someSel;
                  }}
                  onChange={(e) => toggleMany(n.perms, e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                <span>{n.label}</span>
                <span style={{ fontSize: 12, opacity: 0.7 }}>
                  ({n.perms.length} permission{n.perms.length === 1 ? "" : "s"})
                </span>
              </summary>

              <div style={{ marginTop: 10 }}>
                <Tree nodes={n.children} depth={depth + 1} />
              </div>
            </details>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 12, alignItems: "start" }}>
      <aside
        style={{
          border,
          borderRadius: 14,
          background: surface,
          padding: 10,
          position: "sticky",
          top: 12,
          color: fg,
          maxHeight: "calc(100vh - 24px)",
          overflow: "auto",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Modules</div>
        <div style={{ display: "grid", gap: 6 }}>
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
                  border: active ? "1px solid rgba(33,150,243,0.55)" : border,
                  background: active ? "rgba(33,150,243,0.18)" : "rgba(255,255,255,0.02)",
                  color: fg,
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                {m}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
          Selected: <b>{selectedSet.size}</b> / <b>{allPermissions.length}</b>
        </div>
      </aside>

      <section style={{ display: "grid", gap: 10, color: fg }}>
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
            border,
            borderRadius: 14,
            background: surface,
            padding: 10,
          }}
        >
          <div style={{ fontWeight: 900, marginRight: 6 }}>{activeModule}</div>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search permissions in ${activeModule}…`}
            style={{
              flex: "1 1 320px",
              padding: "10px 12px",
              borderRadius: 12,
              border,
              background: surface,
              color: fg,
              outline: "none",
              fontSize: 14,
              minWidth: 240,
            }}
          />

          <button
            type="button"
            onClick={selectAllVisible}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border,
              background: "rgba(33,150,243,0.18)",
              color: fg,
              fontWeight: 900,
              cursor: "pointer",
            }}
            title="Select all visible permissions (current module + search)"
          >
            All (visible)
          </button>

          <button
            type="button"
            onClick={clearAllVisible}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border,
              background: "rgba(244,67,54,0.14)",
              color: fg,
              fontWeight: 900,
              cursor: "pointer",
            }}
            title="Clear all visible permissions (current module + search)"
          >
            None (visible)
          </button>

          <div style={{ flexBasis: "100%", height: 0 }} />

          <button
            type="button"
            onClick={selectAllModule}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border,
              background: "rgba(33,150,243,0.10)",
              color: fg,
              fontWeight: 900,
              cursor: "pointer",
            }}
            title="Select everything in this module (ignores search)"
          >
            All (module)
          </button>

          <button
            type="button"
            onClick={clearAllModule}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border,
              background: "rgba(244,67,54,0.08)",
              color: fg,
              fontWeight: 900,
              cursor: "pointer",
            }}
            title="Clear everything in this module (ignores search)"
          >
            None (module)
          </button>

          <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.75 }}>
            Visible: <b>{visiblePerms.length}</b> / Module: <b>{moduleAllPerms.length}</b>
          </div>
        </div>

        {moduleEntries.length === 0 ? (
          <div style={{ border, borderRadius: 14, background: surface, padding: 12, opacity: 0.85 }}>
            No permissions in this module.
          </div>
        ) : visibleTree.length === 0 ? (
          <div style={{ border, borderRadius: 14, background: surface, padding: 12, opacity: 0.85 }}>
            No matches for “{q.trim()}”.
          </div>
        ) : (
          <div style={{ border, borderRadius: 14, background: surface, padding: 12 }}>
            <Tree nodes={visibleTree} depth={0} />
          </div>
        )}
      </section>
    </div>
  );
}