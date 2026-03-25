"use client";

import { useRouter } from "next/navigation";

interface LocationSelectorProps {
  selectedLocation: string;
  availableLocations: string[];
  query: string;
}

function prettyCode(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}

export default function LocationSelector({ selectedLocation, availableLocations, query }: LocationSelectorProps) {
  const router = useRouter();

  const handleLocationChange = (value: string) => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    p.set("loc", value);
    p.set("shelf", "01");
    p.set("bin", "01");
    router.push(`/maintenance/room-diagrams/quick-count?${p.toString()}`);
  };

  return (
    <select
      value={selectedLocation}
      onChange={(e) => handleLocationChange(e.currentTarget.value)}
      style={{
        padding: "6px 10px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        color: "var(--foreground)",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
        minWidth: 140,
      }}
    >
      {availableLocations.map((locCode) => (
        <option key={locCode} value={locCode}>
          {locCode === "vault" ? "Vault" : `Location #${prettyCode(locCode)}`}
        </option>
      ))}
    </select>
  );
}
