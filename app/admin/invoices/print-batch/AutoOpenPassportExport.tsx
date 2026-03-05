"use client";

import { useEffect } from "react";

type Props = {
  enabled: boolean;
  exportUrl: string;
};

export default function AutoOpenPassportExport({ enabled, exportUrl }: Props) {
  useEffect(() => {
    if (!enabled) return;
    if (!exportUrl) return;
    // Open once per page load when generation sends autoExport=1.
    window.open(exportUrl, "_blank", "noopener,noreferrer");
  }, [enabled, exportUrl]);

  return null;
}
