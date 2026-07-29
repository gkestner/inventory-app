"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

type SaveAction = (formData: FormData) => Promise<void>;

type TitleRow = {
  id: string;
  name: string;
  description: string | null;
};

type Props = {
  roleId: string;
  allPermissions: string[];
  initialSelectedPermissions: string[]; // Permission enum values as strings
  titles: TitleRow[];
  initialSelectedTitleIds: string[];
  saveAction: SaveAction;
};

type Group = {
  key: string;
  label: string;
  permissions: string[];
};

const GROUPS: Group[] = [
  {
    key: "nav",
    label: "App Navigation / Modules",
    permissions: [
      "VIEW_HOME",
      "VIEW_CHECKOUT",
      "VIEW_INVENTORY",
      "CREATE_CHECKOUT",
      "VIEW_ROOM_DIAGRAMS",
      "EDIT_QUICK_COUNT",
      "VIEW_LIVE_ORDERS",
      "VIEW_WORK_ORDERS",
      "CREATE_WORK_ORDERS",
      "CREATE_WORK_ORDERS_FOR_OTHERS",
      "UPDATE_OWN_WORK_ORDERS",
      "SUBMIT_OWN_WORK_ORDERS",
    ],
  },
  {
    key: "items",
    label: "Admin — Items",
    permissions: ["ADMIN_VIEW_ITEMS", "ADMIN_EDIT_ITEMS", "ADMIN_IMPORT_EXPORT_ITEMS"],
  },
  {
    key: "users",
    label: "Admin — Users",
    permissions: ["ADMIN_VIEW_USERS", "ADMIN_EDIT_USERS"],
  },
  {
    key: "locations",
    label: "Admin — Locations",
    permissions: ["ADMIN_VIEW_LOCATIONS", "ADMIN_EDIT_LOCATIONS"],
  },
  {
    key: "workOrders",
    label: "Admin — Work Orders",
    permissions: ["ADMIN_VIEW_WORK_ORDERS", "ADMIN_EDIT_WORK_ORDERS", "ADMIN_DELETE_WORK_ORDERS"],
  },
  {
    key: "maintenanceTickets",
    label: "Admin — Maintenance Tickets",
    permissions: ["ADMIN_VIEW_MAINTENANCE_TICKETS", "ADMIN_EXPORT_MAINTENANCE_TICKETS"],
  },
];

function setIndeterminate(el: HTMLInputElement | null, v: boolean) {
  if (!el) return;
  el.indeterminate = v;
}

export default function RolePermissionTreeClient({
  roleId,
  allPermissions,
  initialSelectedPermissions,
  titles,
  initialSelectedTitleIds,
  saveAction,
}: Props) {
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(
    () => new Set(initialSelectedPermissions)
  );
  const [selectedTitles, setSelectedTitles] = useState<Set<string>>(
    () => new Set(initialSelectedTitleIds)
  );

  const groups = useMemo(() => {
    const grouped = new Set(GROUPS.flatMap((group) => group.permissions));
    const otherPermissions = allPermissions.filter((permission) => !grouped.has(permission));
    return otherPermissions.length
      ? [...GROUPS, { key: "other", label: "Other permissions", permissions: otherPermissions }]
      : GROUPS;
  }, [allPermissions]);

  const allPerms = useMemo(() => Array.from(new Set(allPermissions)), [allPermissions]);

  const globalRef = useRef<HTMLInputElement | null>(null);

  const globalState = useMemo(() => {
    const total = allPerms.length;
    const count = allPerms.reduce((acc, p) => (selectedPerms.has(p) ? acc + 1 : acc), 0);
    return { total, count, all: count === total && total > 0, none: count === 0, ind: count > 0 && count < total };
  }, [allPerms, selectedPerms]);

  useEffect(() => {
    setIndeterminate(globalRef.current, globalState.ind);
  }, [globalState.ind]);

  const styles = useMemo(() => {
    const card: CSSProperties = {
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: 12,
      background: "var(--background)",
    };

    const btn: CSSProperties = {
      padding: "9px 12px",
      borderRadius: 10,
      border: "1px solid var(--border)",
      background: "var(--surface)",
      color: "var(--text)",
      fontWeight: 800,
      cursor: "pointer",
    };

    const checkboxRow: CSSProperties = {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "6px 0",
      flexWrap: "wrap",
    };

    const label: CSSProperties = { fontSize: 13, fontWeight: 700 };

    const subtle: CSSProperties = { fontSize: 12, color: "var(--mutedText)" };

    const grid: CSSProperties = {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12,
    };

    const twoColResponsive: CSSProperties = {
      ...grid,
    };

    return { card, btn, checkboxRow, label, subtle, twoColResponsive };
  }, []);

  function togglePermission(p: string, checked: boolean) {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (checked) next.add(p);
      else next.delete(p);
      return next;
    });
  }

  function setGroup(group: Group, checked: boolean) {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      for (const p of group.permissions) {
        if (checked) next.add(p);
        else next.delete(p);
      }
      return next;
    });
  }

  function setAll(checked: boolean) {
    setSelectedPerms(() => {
      if (!checked) return new Set();
      return new Set(allPerms);
    });
  }

  function toggleTitle(id: string, checked: boolean) {
    setSelectedTitles((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <form action={saveAction} style={{ display: "grid", gap: 12 }}>
      <input type="hidden" name="roleId" value={roleId} />

      {/* Hidden multi-select values for server action */}
      {Array.from(selectedPerms).map((p) => (
        <input key={p} type="hidden" name="permissions" value={p} />
      ))}
      {Array.from(selectedTitles).map((id) => (
        <input key={id} type="hidden" name="titleIds" value={id} />
      ))}

      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 900 }}>Direct permissions</div>
            <div style={styles.subtle}>
              Selected: <b style={{ color: "var(--text)" }}>{globalState.count}</b> / {globalState.total}
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              ref={globalRef}
              type="checkbox"
              checked={globalState.all}
              onChange={(e) => setAll(e.target.checked)}
            />
            <span style={{ fontSize: 13, fontWeight: 800 }}>Select all</span>
          </label>
        </div>

        <div style={{ height: 10 }} />

        <div style={styles.twoColResponsive}>
          {groups.map((g) => {
            const groupCount = g.permissions.reduce((acc, p) => (selectedPerms.has(p) ? acc + 1 : acc), 0);
            const groupAll = groupCount === g.permissions.length && g.permissions.length > 0;
            const groupInd = groupCount > 0 && groupCount < g.permissions.length;

            return (
              <div key={g.key} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 900 }}>{g.label}</div>
                    <div style={styles.subtle}>
                      Selected: <b style={{ color: "var(--text)" }}>{groupCount}</b> / {g.permissions.length}
                    </div>
                  </div>

                  <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      ref={(el) => {
                        setIndeterminate(el, groupInd);
                      }}
                      type="checkbox"
                      checked={groupAll}
                      onChange={(e) => setGroup(g, e.target.checked)}
                    />
                    <span style={{ fontSize: 13, fontWeight: 800 }}>All</span>
                  </label>
                </div>

                <div style={{ height: 10 }} />

                <div style={{ display: "grid", gap: 6 }}>
                  {g.permissions.map((p) => (
                    <label key={p} style={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={selectedPerms.has(p)}
                        onChange={(e) => togglePermission(p, e.target.checked)}
                      />
                      <span style={styles.label}>{p}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={styles.card}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Permission Titles granted by this role</div>
        <div style={styles.subtle}>
          Titles are reusable bundles. Selecting a title grants its permissions to any user with this role.
        </div>

        <div style={{ height: 10 }} />

        {titles.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--mutedText)" }}>
            No active Permission Titles yet. Create them in your Access Titles page first.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {titles.map((t) => (
              <label key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0" }}>
                <input
                  type="checkbox"
                  checked={selectedTitles.has(t.id)}
                  onChange={(e) => toggleTitle(t.id, e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span style={{ display: "block" }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 900 }}>{t.name}</span>
                  {t.description ? <span style={{ display: "block", fontSize: 12, color: "var(--mutedText)" }}>{t.description}</span> : null}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" style={styles.btn}>
          Save grants
        </button>
        <div style={{ fontSize: 12, color: "var(--mutedText)" }}>
          Saves are atomic: role permissions and role title links are replaced in a single transaction.
        </div>
      </div>

      <div style={{ fontSize: 12, color: "var(--mutedText)" }}>
        Permissions without a named group appear under Other permissions, so new permissions remain editable.
      </div>
    </form>
  );
}
