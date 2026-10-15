import { Suspense } from "react";

import ReportExportControls from "./ReportExportControls";

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`@media print {
        @page { size: landscape; margin: 12mm; }
        .report-export-controls, .admin-layout-sidebar, .admin-layout-topbar { display: none !important; }
        .admin-layout-grid { display: block !important; padding: 0 !important; }
        .admin-layout-main, .admin-layout-content { width: 100% !important; max-width: none !important; padding: 0 !important; }
        table { min-width: 0 !important; }
        main, section { overflow: visible !important; }
      }`}</style>
      <Suspense fallback={null}><ReportExportControls /></Suspense>
      {children}
    </>
  );
}
