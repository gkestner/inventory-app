// app/admin/live-orders/loading.tsx
import type { CSSProperties } from "react";

export default function LoadingLiveOrders() {
  const wrap: CSSProperties = {
    padding: 16,
    maxWidth: 1400,
    margin: "0 auto",
  };

  const colsWrap: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 12,
    alignItems: "start",
    marginTop: 12,
  };

  const col: CSSProperties = {
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 12,
    background: "#fff",
    minHeight: 320,
  };

  const header: CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 10,
  };

  const badge: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 12,
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    color: "#6b7280",
    minWidth: 34,
  };

  const skeletonCard = (tone: "amber" | "blue" | "green") => {
    const borderLeft =
      tone === "amber" ? "6px solid #f59e0b" : tone === "blue" ? "6px solid #3b82f6" : "6px solid #10b981";
    const bg =
      tone === "amber" ? "#fffbeb" : tone === "blue" ? "#eff6ff" : "#ecfdf5";

    const card: CSSProperties = {
      borderRadius: 10,
      border: "1px solid #e5e7eb",
      borderLeft,
      padding: 10,
      background: bg,
      marginBottom: 10,
    };

    const line: CSSProperties = {
      height: 10,
      borderRadius: 6,
      background: "rgba(17,24,39,0.08)",
      marginTop: 8,
    };

    return (
      <div style={card}>
        <div style={{ ...line, height: 12, width: "75%", marginTop: 0 }} />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <div style={{ ...line, width: 70 }} />
          <div style={{ ...line, width: 120 }} />
          <div style={{ ...line, width: 140 }} />
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ ...line, width: 90 }} />
          <div style={{ ...line, width: 90 }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <div style={{ ...line, width: 110, height: 28 }} />
          <div style={{ ...line, width: 110, height: 28 }} />
        </div>
      </div>
    );
  };

  return (
    <main style={wrap}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Live Orders Board</h1>
        <div style={{ fontSize: 12, color: "#6b7280" }}>Loading…</div>
      </div>

      <div style={colsWrap}>
        <section style={col}>
          <div style={header}>
            <div style={{ fontWeight: 800 }}>ORDERED</div>
            <span style={badge}>—</span>
          </div>
          {skeletonCard("amber")}
          {skeletonCard("amber")}
          {skeletonCard("amber")}
        </section>

        <section style={col}>
          <div style={header}>
            <div style={{ fontWeight: 800 }}>ARRIVED / PROCESSING</div>
            <span style={badge}>—</span>
          </div>
          {skeletonCard("blue")}
          {skeletonCard("blue")}
        </section>

        <section style={col}>
          <div style={header}>
            <div style={{ fontWeight: 800 }}>COMPLETED</div>
            <span style={badge}>—</span>
          </div>
          {skeletonCard("green")}
          {skeletonCard("green")}
        </section>
      </div>
    </main>
  );
}