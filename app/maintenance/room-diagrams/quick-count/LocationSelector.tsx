"use client";

import { useRouter } from "next/navigation";

interface LocationSelectorProps {
  selectedLocation: string;
  availableLocations: string[];
}

function prettyCode(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}

export default function LocationSelector({ selectedLocation, availableLocations }: LocationSelectorProps) {
  const router = useRouter();

  const handleLocationChange = (value: string) => {
    router.push(`/maintenance/room-diagrams/quick-count?loc=${encodeURIComponent(value)}&shelf=01&bin=01`);
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
