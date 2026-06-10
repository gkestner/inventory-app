"use client";

import { useState, type CSSProperties } from "react";

import {
  WORK_ORDER_EQUIPMENT_AREAS,
  type EquipmentAreaChecklistItemRow,
  type WorkOrderEquipmentArea,
  formatWorkOrderEquipmentAreaLabel,
} from "@/app/lib/work-order-equipment";

type Props = {
  title: string;
  templatesByArea: Record<WorkOrderEquipmentArea, EquipmentAreaChecklistItemRow[]>;
  selectedAreas?: Iterable<string>;
  selectedChecklistItemIds?: Iterable<string>;
  helperText?: string;
  gridWrapStyle?: CSSProperties;
  areaLabelStyle?: CSSProperties;
  checkboxStyle?: CSSProperties;
};

export default function WorkOrderEquipmentSelector({
  title,
  templatesByArea,
  selectedAreas,
  selectedChecklistItemIds,
  helperText,
  gridWrapStyle,
  areaLabelStyle,
  checkboxStyle,
}: Props) {
  const selectedAreaSet = new Set(Array.from(selectedAreas ?? []));
  const selectedChecklistSet = new Set(Array.from(selectedChecklistItemIds ?? []));
  const [openByArea, setOpenByArea] = useState<Record<WorkOrderEquipmentArea, boolean>>(() => {
    const initial = {} as Record<WorkOrderEquipmentArea, boolean>;
    for (const area of WORK_ORDER_EQUIPMENT_AREAS) {
      const templates = templatesByArea[area] ?? [];
      const checkedCount = templates.filter((item) => selectedChecklistSet.has(item.id)).length;
      initial[area] = selectedAreaSet.has(area) || checkedCount > 0;
    }
    return initial;
  });

  const wrapStyle: CSSProperties =
    gridWrapStyle ??
    ({
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
      gap: 12,
      marginTop: 10,
    } satisfies CSSProperties);

  const cardStyle: CSSProperties = {
    border: "1px solid rgba(128,128,128,0.25)",
    borderRadius: 12,
    padding: 10,
    background: "rgba(255,255,255,0.03)",
    display: "grid",
    gap: 8,
  };

  const labelStyle: CSSProperties =
    areaLabelStyle ??
    ({
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontSize: 14,
      fontWeight: 800,
      minHeight: 30,
    } satisfies CSSProperties);

  const detailsStyle: CSSProperties = {
    borderTop: "1px solid rgba(128,128,128,0.18)",
    paddingTop: 8,
  };

  const summaryStyle: CSSProperties = {
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 900,
    opacity: 0.88,
  };

  const checklistListStyle: CSSProperties = {
    display: "grid",
    gap: 8,
    marginTop: 8,
  };

  const checklistItemStyle: CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 13,
    lineHeight: 1.3,
  };

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 900, opacity: 0.95 }}>{title}</div>
      <div style={wrapStyle}>
        {WORK_ORDER_EQUIPMENT_AREAS.map((area) => {
          const templates = templatesByArea[area] ?? [];
          const checkedCount = templates.filter((item) => selectedChecklistSet.has(item.id)).length;
          const isSelected = selectedAreaSet.has(area);

          return (
            <div key={area} style={cardStyle}>
              <label style={labelStyle}>
                <input
                  type="checkbox"
                  name="areas"
                  value={area}
                  defaultChecked={isSelected}
                  style={checkboxStyle}
                  onChange={(event) => {
                    setOpenByArea((current) => ({
                      ...current,
                      [area]: event.currentTarget.checked,
                    }));
                  }}
                />
                <span>{formatWorkOrderEquipmentAreaLabel(area)}</span>
              </label>

              {templates.length > 0 ? (
                <details
                  style={detailsStyle}
                  open={openByArea[area]}
                  onToggle={(event) => {
                    setOpenByArea((current) => ({
                      ...current,
                      [area]: event.currentTarget.open,
                    }));
                  }}
                >
                  <summary style={summaryStyle}>{checkedCount > 0 ? `Checklist (${checkedCount})` : "Checklist"}</summary>
                  <div style={checklistListStyle}>
                    {templates.map((item) => (
                      <label key={item.id} style={checklistItemStyle}>
                        <input
                          type="checkbox"
                          name="checklistItemIds"
                          value={item.id}
                          defaultChecked={selectedChecklistSet.has(item.id)}
                          style={checkboxStyle}
                        />
                        <span>{item.label}</span>
                      </label>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>

      {helperText ? <div style={{ marginTop: 8, fontSize: 12, opacity: 0.78 }}>{helperText}</div> : null}
    </div>
  );
}