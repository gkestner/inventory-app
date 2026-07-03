"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";

export type ReportHubItem = {
  key: string;
  title: string;
  description: string;
  href: string;
};

export type ReportHubSection = {
  key: string;
  title: string;
  items: ReportHubItem[];
};

type Props = {
  sections: ReportHubSection[];
  initialSectionOrder: Record<string, string[]>;
};

function mergeOrder(items: ReportHubItem[], order: string[] | undefined): ReportHubItem[] {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const ordered: ReportHubItem[] = [];
  const seen = new Set<string>();

  for (const key of order ?? []) {
    const item = byKey.get(key);
    if (!item || seen.has(key)) continue;
    ordered.push(item);
    seen.add(key);
  }

  for (const item of items) {
    if (seen.has(item.key)) continue;
    ordered.push(item);
  }

  return ordered;
}

function moveKey(keys: string[], index: number, direction: -1 | 1): string[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= keys.length) return keys;
  const next = keys.slice();
  const [key] = next.splice(index, 1);
  next.splice(nextIndex, 0, key);
  return next;
}

export default function ReportsHubClient({ sections, initialSectionOrder }: Props) {
  const [sectionOrder, setSectionOrder] = useState<Record<string, string[]>>(initialSectionOrder);
  const [customizing, setCustomizing] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const orderedSections = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        items: mergeOrder(section.items, sectionOrder[section.key]),
      })),
    [sections, sectionOrder],
  );

  const border = "1px solid var(--border)";
  const cardStyle: CSSProperties = {
    border,
    borderRadius: 16,
    padding: 14,
    background: "var(--surface)",
    color: "var(--foreground)",
    textDecoration: "none",
    display: "grid",
    gap: 8,
    minHeight: 110,
    boxShadow: "var(--shadow)",
  };
  const titleStyle: CSSProperties = { fontWeight: 900, fontSize: 16, margin: 0 };
  const descStyle: CSSProperties = { opacity: 0.85, lineHeight: 1.45, margin: 0, fontSize: 13 };
  const buttonStyle: CSSProperties = {
    padding: "7px 10px",
    borderRadius: 10,
    border,
    background: "var(--surface-2)",
    color: "var(--foreground)",
    fontWeight: 900,
    cursor: "pointer",
  };

  async function saveOrder(nextOrder: Record<string, string[]>) {
    setSectionOrder(nextOrder);
    setSaveState("saving");

    try {
      const res = await fetch("/api/me/report-hub", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportHub: { sectionOrder: nextOrder } }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1000);
    } catch {
      setSaveState("error");
    }
  }

  function moveItem(section: ReportHubSection, index: number, direction: -1 | 1) {
    const current = mergeOrder(section.items, sectionOrder[section.key]).map((item) => item.key);
    const nextKeys = moveKey(current, index, direction);
    void saveOrder({ ...sectionOrder, [section.key]: nextKeys });
  }

  function resetOrder() {
    void saveOrder({});
  }

  return (
    <>
      <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" style={buttonStyle} onClick={() => setCustomizing((value) => !value)}>
          {customizing ? "Done Rearranging" : "Rearrange Reports"}
        </button>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {customizing ? (
            <button type="button" style={buttonStyle} onClick={resetOrder}>
              Reset Report Order
            </button>
          ) : null}
          <span style={{ fontSize: 12, color: saveState === "error" ? "#ef4444" : "var(--muted)" }}>
            {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : saveState === "error" ? "Order save failed" : ""}
          </span>
        </div>
      </div>

      {orderedSections.map((section) =>
        section.items.length > 0 ? (
          <section key={section.key} style={{ marginTop: 14 }}>
            <h2 style={{ fontSize: 18, fontWeight: 900, margin: "0 0 8px" }}>{section.title}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
              {section.items.map((item, index) => (
                <div key={item.key} style={{ position: "relative" }}>
                  {customizing ? (
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        justifyContent: "flex-end",
                        marginBottom: 6,
                      }}
                    >
                      <button type="button" style={buttonStyle} onClick={() => moveItem(section, index, -1)} disabled={index === 0}>
                        Up
                      </button>
                      <button type="button" style={buttonStyle} onClick={() => moveItem(section, index, 1)} disabled={index === section.items.length - 1}>
                        Down
                      </button>
                    </div>
                  ) : null}
                  <Link href={item.href} style={cardStyle}>
                    <h2 style={titleStyle}>{item.title}</h2>
                    <p style={descStyle}>{item.description}</p>
                    <div style={{ fontWeight: 900, opacity: 0.9 }}>Open</div>
                  </Link>
                </div>
              ))}
            </div>
          </section>
        ) : null,
      )}
    </>
  );
}
