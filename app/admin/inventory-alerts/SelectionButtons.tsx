"use client";

const SELECTOR = 'input[type="checkbox"][name="alertIds"][form="bulkResolveAlertsForm"]';

function setChecked(next: boolean) {
  const nodes = document.querySelectorAll<HTMLInputElement>(SELECTOR);
  nodes.forEach((n) => {
    if (!n.disabled) n.checked = next;
  });
}

export default function SelectionButtons() {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={() => setChecked(true)}
        style={{ padding: "6px 10px", fontWeight: 700, borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer" }}
      >
        Select All
      </button>
      <button
        type="button"
        onClick={() => setChecked(false)}
        style={{ padding: "6px 10px", fontWeight: 700, borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", opacity: 0.9 }}
      >
        Clear
      </button>
    </div>
  );
}
