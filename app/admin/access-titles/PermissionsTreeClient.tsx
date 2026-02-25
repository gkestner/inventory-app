// app/admin/access-titles/PermissionsTreeClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Permission } from "@prisma/client";
import { PERMISSION_CATALOG, getPermissionModules, buildPermissionTreeForModule } from "@/app/lib/permissionCatalog";

type UiEntry = {
  permission: string; // submit value (Permission enum string)
  module: string;
  path: string[];
  label: string;
  description?: string;
};

type UiNode =
  | { kind: "group"; key: string; name: string; children: UiNode[] }
  | { kind: "leaf"; key: string; entry: UiEntry };

function isPermissionValue(v: string): v is Permission {
  return (Object.values(Permission) as string[]).includes(v);
}

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

function buildOtherModuleTree(entries: UiEntry[]): UiNode[] {
  // Group as Other > Uncategorized (or path if provided)
  const root: UiNode = { kind: "group", key: "module:Other", name: "Other", children: [] };

  function getOrCreateGroup(parent: UiNode[], name: string, key: string) {
    const existing = parent.find((n) => n.kind === "group" && n.key === key);
    if (existing && existing.kind === "group") return existing;
    const g: UiNode = { kind: "group", key, name, children: [] };
    parent.push(g);
    return g as Extract<UiNode, { kind: "group" }>;
  }

  const sorted = [...entries].sort((a, b) => {
    const ap = a.path.join(" > ");
    const bp = b.path.join(" > ");
    if (ap !== bp) return ap.localeCompare(bp);
    return a.label.localeCompare(b.label);
  });

  for (const e of sorted) {
    let children = (root as Extract<UiNode, { kind: "group" }>).children;
    let currentKey = "module:Other";

    const segs = e.path?.length ? e.path : ["Uncategorized"];
    for (const seg of segs) {
      currentKey += `/${seg}`;
      const g = getOrCreateGroup(children, seg, currentKey);
      children = g.children;
    }

    children.push({ kind: "leaf", key: `perm:${e.permission}`, entry: e });
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
      const hay = `${n.entry.permission} ${n.entry.label} ${n.entry.description ?? ""} ${n.entry.path.join(" ")}`.toLowerCase();
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
          padding: "8px 10px",
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
          style={{ width: 18, height: 18, marginTop: 2 }}
        />

        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ fontWeight: 900 }}>{node.entry.label}</div>
          <div
            style={{
              fontSize: 12,
              opacity: 0.85,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            }}
          >
            {node.entry.permission}
          </div>
          {node.entry.description ? (
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>{node.entry.description}</div>
          ) : null}
        </div>
      </label>
    );
  }

  const leafPerms = useMemo(() => uniqStrings(collectLeafPerms(node)), [node]);
  const allSelected = leafPerms.length > 0 && leafPerms.every((p) => selected.has(p));
  const someSelected = leafPerms.some((p) => selected.has(p));

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 10px",
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
        <div style={{ fontWeight: 900 }}>
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
}: {
  allPermissions: string[];
  selectedPermissions: string[];
}) {
  const catalogByPerm = useMemo(() => {
    const m = new Map<string, UiEntry>();
    for (const ce of PERMISSION_CATALOG) {
      const key = String(ce.permission);
      m.set(key, {
        permission: key,
        module: ce.module,
        path: ce.path,
        label: ce.label,
        description: ce.description,
      });
    }
    return m;
  }, []);

  const allPermStrings = useMemo(() => uniqStrings(allPermissions.map((p) => String(p))), [allPermissions]);

  const initialSelected = useMemo(
    () => new Set(uniqStrings(selectedPermissions.map((p) => String(p))).filter((p) => allPermStrings.includes(p))),
    [selectedPermissions, allPermStrings]
  );

  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  const [q, setQ] = useState("");

  // keep in sync if title changes
  useEffect(() => {
    setSelected(initialSelected);
  }, [initialSelected]);

  // Build module list:
  const baseModules = useMemo(() => getPermissionModules(), []);
  const allModules = useMemo(() => {
    // include "Other" if any permissions not in catalog OR catalog module missing
    const unknown = allPermStrings.filter((p) => !catalogByPerm.has(p));
    const mods = new Set<string>(baseModules);
    if (unknown.length > 0) mods.add("Other");
    return Array.from(mods).sort((a, b) => a.localeCompare(b));
  }, [baseModules, allPermStrings, catalogByPerm]);

  // Default active module: first module that actually has permissions present
  const defaultModule = useMemo(() => {
    for (const mod of allModules) {
      if (mod === "Other") {
        const unknown = allPermStrings.filter((p) => !catalogByPerm.has(p));
        if (unknown.length) return "Other";
      } else {
        const moduleTree = buildPermissionTreeForModule(mod);
        const modulePerms = moduleTree
          .flatMap((n) => {
            // collect from catalog tree (Permission typed)
            const collect = (x: any): string[] => {
              if (x.kind === "leaf") return [String(x.entry.permission)];
              return (x.children ?? []).flatMap(collect);
            };
            return collect(n);
          })
          .filter((p) => allPermStrings.includes(p));

        if (modulePerms.length) return mod;
      }
    }
    return allModules[0] ?? "Other";
  }, [allModules, allPermStrings, catalogByPerm]);

  const [activeModule, setActiveModule] = useState<string>(defaultModule);

  useEffect(() => {
    setActiveModule(defaultModule);
  }, [defaultModule]);

  // Build module tree nodes (UiNode[])
  const moduleTree: UiNode[] = useMemo(() => {
    const qLower = q.trim().toLowerCase();

    if (activeModule === "Other") {
      const unknown = allPermStrings
        .filter((p) => !catalogByPerm.has(p))
        .map<UiEntry>((p) => ({
          permission: p,
          module: "Other",
          path: ["Uncategorized"],
          label: p,
        }));

      const tree = buildOtherModuleTree(unknown);
      return filterTreeByQuery(tree, qLower);
    }

    // Use catalog tree structure, but only show permissions that exist in allPermissions
    const raw = buildPermissionTreeForModule(activeModule);

    const convert = (n: any): UiNode | null => {
      if (n.kind === "leaf") {
        const permStr = String(n.entry.permission);
        if (!allPermStrings.includes(permStr)) return null;

        const ce = catalogByPerm.get(permStr);
        const entry: UiEntry = ce
          ? ce
          : {
              permission: permStr,
              module: activeModule,
              path: [],
              label: permStr,
            };

        return { kind: "leaf", key: `perm:${permStr}`, entry };
      }

      const children = (n.children ?? []).map(convert).filter(Boolean) as UiNode[];
      if (children.length === 0) return null;
      return { kind: "group", key: String(n.key), name: String(n.name), children };
    };

    const converted = raw.map(convert).filter(Boolean) as UiNode[];
    return filterTreeByQuery(converted, qLower);
  }, [activeModule, q, allPermStrings, catalogByPerm]);

  const totalSelected = selected.size;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Top controls */}
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
          Selected: <b>{totalSelected}</b> / Total: <b>{allPermStrings.length}</b>
        </div>
      </div>

      {/* Layout: module sidebar + tree */}
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
            {allModules.map((m) => {
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

          {/* ✅ Submit values for server action */}
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