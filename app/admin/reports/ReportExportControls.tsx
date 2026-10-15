"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const REPORTS = new Set([
  "checkout-orders", "location-charges", "parts-checkout-by-location", "items-not-checked-out", "needs-ordering",
  "min-qty-differences", "item-cost-history", "scanner-count-untouched",
  "parts-consumption-costs", "work-order-costs", "maintenance-requests",
  "sla-breaches", "technician-workload", "preventative-maintenance",
  "pm-compliance", "temperature-incidents", "fleet-tco",
  "permission-coverage", "notification-effectiveness",
]);

export default function ReportExportControls() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const slug = pathname.split("/").filter(Boolean)[2];
  if (!REPORTS.has(slug)) return null;

  function href(format: "excel" | "csv" | "pdf") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("report", slug);
    params.set("format", format);
    params.delete("page");
    return `/api/admin/reports/excel?${params.toString()}`;
  }

  const buttonStyle = {
    border: "1px solid var(--border)", borderRadius: 9, padding: "9px 13px",
    background: "var(--surface)", color: "var(--foreground)", fontWeight: 800,
    textDecoration: "none", cursor: "pointer", fontSize: 14,
  } as const;

  return (
    <div className="report-export-controls" style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", margin: "0 0 12px" }}>
      <button type="button" onClick={() => window.print()} style={buttonStyle} title="Print the current report page">
        Print
      </button>
      <details style={{ position: "relative" }}>
        <summary style={{ ...buttonStyle, listStyle: "none", display: "inline-block" }}>Export ▾</summary>
        <div style={{ position: "absolute", top: "calc(100% + 5px)", left: 0, zIndex: 20, display: "grid", minWidth: 130, padding: 6, gap: 3, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", boxShadow: "var(--shadow)" }}>
          <Link href={href("pdf")} style={buttonStyle}>PDF</Link>
          <Link href={href("excel")} style={buttonStyle}>Excel</Link>
          <Link href={href("csv")} style={buttonStyle}>CSV</Link>
        </div>
      </details>
    </div>
  );
}
