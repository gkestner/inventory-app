"use client";

interface LocationSelectorProps {
  selectedLocation: string;
  availableLocations: string[];
  prettyCode: (code: string) => string;
}

export default function LocationSelector({ selectedLocation, availableLocations, prettyCode }: LocationSelectorProps) {
  const handleLocationChange = (value: string) => {
    const newUrl = `/maintenance/room-diagrams/quick-count?loc=${encodeURIComponent(value)}&shelf=01&bin=01`;
    window.location.href = newUrl;
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
