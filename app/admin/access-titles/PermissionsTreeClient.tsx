"use client";

import { useEffect, useMemo, useState } from "react";
import { Permission } from "@prisma/client";
import { PERMISSION_CATALOG, buildPermissionTreeForModule } from "@/app/lib/permissionCatalog";

type UiEntry = {
  permission: Permission; // ✅ strongly typed
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

function uniqPerms(vals: Permission[]): Permission[] {
  const seen = new Set<string>();
  const out: Permission[] = [];
  for (const p of vals) {
    const k = String(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

function buildOtherModuleTree(entries: UiEntry[]): UiNode[] {
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

function collectLeafPerms(node: UiNode): Permission[] {
  if (node.kind === "leaf") return [node.entry.permission];
  const out: Permission[] = [];
  for (const ch of node.children) out.push(...collectLeafPerms(ch));
  return out;
}

function filterTreeByQuery(nodes: UiNode[], qLower: string): UiNode[] {
  if (!qLower) return nodes;

  function keepNode(n: UiNode): UiNode | null {
    if (n.kind === "leaf") {
      const hay =
        `${n.entry.permission} ${n.entry.label} ${n.entry.description ?? ""} ${n.entry.path.join(" ")}`.toLowerCase();
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
  selected: Set<Permission>;
  setSelected: (next: Set<Permission>) => void;
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

  const leafPerms = useMemo(() => uniqPerms(collectLeafPerms(node)), [node]);
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
  // ✅ normalize enum-permissions from strings
  const allPerms = useMemo(() => {
    const raw = uniqStrings(allPermissions.map((p) => String(p)));
    return raw.filter(isPermissionValue);
  }, [allPermissions]);

  const catalogByPerm = useMemo(() => {
    const m = new Map<Permission, UiEntry>();
    for (const ce of PERMISSION_CATALOG) {
      m.set(ce.permission, {
        permission: ce.permission,
        module: ce.module,
        path: ce.path,
        label: ce.label,
        description: ce.description,
      });
    }
    return m;
  }, []);

  const initialSelected = useMemo(() => {
    const raw = uniqStrings(selectedPermissions.map((p) => String(p)));
    const perms = raw.filter(isPermissionValue).filter((p) => allPerms.includes(p));
    return new Set<Permission>(perms);
  }, [selectedPermissions, allPerms]);

  const [selected, setSelected] = useState<Set<Permission>>(initialSelected);
  const [q, setQ] = useState("");

  useEffect(() => {
    setSelected(initialSelected);
  }, [initialSelected]);

  // ✅ Build module list from catalog + add Other if any enum-perms missing from catalog
  const baseModules = useMemo(() => {
    const s = new Set<string>();
    for (const ce of PERMISSION_CATALOG) s.add(ce.module);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, []);

  const allModules = useMemo(() => {
    const unknown = allPerms.filter((p) => !catalogByPerm.has(p));
    const mods = new Set<string>(baseModules);
    if (unknown.length > 0) mods.add("Other");
    return Array.from(mods).sort((a, b) => a.localeCompare(b));
  }, [baseModules, allPerms, catalogByPerm]);

  const defaultModule = useMemo(() => {
    for (const mod of allModules) {
      if (mod === "Other") {
        const unknown = allPerms.filter((p) => !catalogByPerm.has(p));
        if (unknown.length) return "Other";
      } else {
        const rawTree = buildPermissionTreeForModule(mod);
        const collect = (x: any): Permission[] => {
          if (x.kind === "leaf") return [x.entry.permission as Permission];
          return (x.children ?? []).flatMap(collect);
        };
        const modulePerms = rawTree.flatMap(collect).filter((p) => allPerms.includes(p));
        if (modulePerms.length) return mod;
      }
    }
    return allModules[0] ?? "Other";
  }, [allModules, allPerms, catalogByPerm]);

  const [activeModule, setActiveModule] = useState<string>(defaultModule);

  useEffect(() => {
    setActiveModule(defaultModule);
  }, [defaultModule]);

  const moduleTree: UiNode[] = useMemo(() => {
    const qLower = q.trim().toLowerCase();

    if (activeModule === "Other") {
      const unknownEntries: UiEntry[] = allPerms
        .filter((p) => !catalogByPerm.has(p))
        .map((p) => ({
          permission: p,
          module: "Other",
          path: ["Uncategorized"],
          label: String(p),
        }));

      const tree = buildOtherModuleTree(unknownEntries);
      return filterTreeByQuery(tree, qLower);
    }

    const raw = buildPermissionTreeForModule(activeModule);

    const convert = (n: any): UiNode | null => {
      if (n.kind === "leaf") {
        const perm = n.entry.permission as Permission;
        if (!allPerms.includes(perm)) return null;

        const ce = catalogByPerm.get(perm);
        const entry: UiEntry =
          ce ??
          ({
            permission: perm,
            module: activeModule,
            path: [],
            label: String(perm),
          } as UiEntry);

        return { kind: "leaf", key: `perm:${perm}`, entry };
      }

      const children = (n.children ?? []).map(convert).filter(Boolean) as UiNode[];
      if (children.length === 0) return null;
      return { kind: "group", key: String(n.key), name: String(n.name), children };
    };

    const converted = raw.map(convert).filter(Boolean) as UiNode[];
    return filterTreeByQuery(converted, qLower);
  }, [activeModule, q, allPerms, catalogByPerm]);

  const totalSelected = selected.size;

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
          onClick={() => setSelected(new Set(allPerms))}
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
          Selected: <b>{totalSelected}</b> / Total: <b>{allPerms.length}</b>
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
              .map(String)
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