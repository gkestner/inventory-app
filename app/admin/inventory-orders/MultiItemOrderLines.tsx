"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import ItemPicker from "./ItemPicker";

type ItemLite = {
  id: string;
  labelNumber?: number | null;
  sku: string;
  partNumber: string | null;
  name: string;
  category?: string | null;
  manufacturer?: string | null;
  orderFrom?: string | null;
};

type Props = {
  items: ItemLite[];
  defaultItemId?: string;
  defaultQty?: string;
  defaultSupplierPartNumber?: string;
  defaultUnitPrice?: string;
  controlBase: CSSProperties;
};

type Line = {
  key: string;
  itemId: string;
  qty: string;
  supplierPartNumber: string;
  unitPrice: string;
};

function newLine(): Line {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    itemId: "",
    qty: "1",
    supplierPartNumber: "",
    unitPrice: "",
  };
}

export default function MultiItemOrderLines({
  items,
  defaultItemId = "",
  defaultQty = "1",
  defaultSupplierPartNumber = "",
  defaultUnitPrice = "",
  controlBase,
}: Props) {
  const [lines, setLines] = useState<Line[]>([
    {
      key: "initial",
      itemId: defaultItemId,
      qty: defaultQty || "1",
      supplierPartNumber: defaultSupplierPartNumber,
      unitPrice: defaultUnitPrice,
    },
  ]);

  const labelStyle: CSSProperties = { display: "grid", gap: 6, fontSize: 12, opacity: 0.9, fontWeight: 900 };
  const border = "1px solid rgba(128,128,128,0.25)";
  const fg = "var(--foreground)";
  const surface = "var(--background)";
  const buttonStyle: CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border,
    background: surface,
    color: fg,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ display: "grid", gap: 10, width: "100%" }}>
      {lines.map((line, index) => (
        <div
          key={line.key}
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "minmax(260px, 3fr) minmax(80px, 0.6fr) minmax(160px, 1fr) minmax(150px, 1fr) auto",
            alignItems: "end",
          }}
        >
          <label style={labelStyle}>
            Item {index + 1}
            <ItemPicker
              name="itemId"
              items={items}
              defaultId={line.itemId}
              placeholder="Search item #, ID, SKU, part #, name..."
            />
          </label>

          <label style={labelStyle}>
            Qty
            <input name="qty" type="number" min={1} step={1} defaultValue={line.qty} required style={controlBase} />
          </label>

          <label style={labelStyle}>
            Supplier Part #
            <input name="supplierPartNumber" placeholder="Part #..." defaultValue={line.supplierPartNumber} style={controlBase} />
          </label>

          <label style={labelStyle}>
            Unit price
            <input name="unitPrice" placeholder="0.00" inputMode="decimal" defaultValue={line.unitPrice} required style={controlBase} />
          </label>

          <button
            type="button"
            onClick={() => setLines((current) => current.filter((x) => x.key !== line.key))}
            disabled={lines.length === 1}
            style={{ ...buttonStyle, opacity: lines.length === 1 ? 0.45 : 1, cursor: lines.length === 1 ? "default" : "pointer" }}
          >
            Remove
          </button>
        </div>
      ))}

      <div>
        <button type="button" onClick={() => setLines((current) => [...current, newLine()])} style={buttonStyle}>
          Add Another Item
        </button>
      </div>
    </div>
  );
}
