"use client";

import { useEffect, useState } from "react";

type Props = {
  formId: string;
};

type Totals = {
  qty: number;
  unitPrice: number;
  shippingCost: number;
  taxCost: number;
  subtotal: number;
  total: number;
};

function parseNumber(value: string | null | undefined): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function readTotals(form: HTMLFormElement): Totals {
  const qtyField = form.elements.namedItem("qty") as HTMLInputElement | null;
  const unitField = form.elements.namedItem("unitPrice") as HTMLInputElement | null;
  const shippingField = form.elements.namedItem("shippingCost") as HTMLInputElement | null;
  const taxField = form.elements.namedItem("taxCost") as HTMLInputElement | null;

  const qty = Math.max(0, Math.trunc(parseNumber(qtyField?.value)));
  const unitPrice = parseNumber(unitField?.value);
  const shippingCost = parseNumber(shippingField?.value);
  const taxCost = parseNumber(taxField?.value);
  const subtotal = qty * unitPrice;
  const total = subtotal + shippingCost + taxCost;

  return { qty, unitPrice, shippingCost, taxCost, subtotal, total };
}

export default function OrderTotalPreview({ formId }: Props) {
  const [totals, setTotals] = useState<Totals>({
    qty: 0,
    unitPrice: 0,
    shippingCost: 0,
    taxCost: 0,
    subtotal: 0,
    total: 0,
  });

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;

    const sync = () => setTotals(readTotals(form));

    sync();
    form.addEventListener("input", sync);
    form.addEventListener("change", sync);

    return () => {
      form.removeEventListener("input", sync);
      form.removeEventListener("change", sync);
    };
  }, [formId]);

  return (
    <div
      style={{
        border: "1px solid rgba(128,128,128,0.25)",
        borderRadius: 12,
        padding: 12,
        background: "rgba(0,0,0,0.03)",
        display: "grid",
        gap: 6,
        minWidth: 240,
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900, letterSpacing: "0.02em" }}>ORDER TOTAL CHECK</div>
      <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.4 }}>
        ({totals.qty} × {formatMoney(totals.unitPrice)}) + {formatMoney(totals.shippingCost)} shipping + {formatMoney(totals.taxCost)} tax
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, fontSize: 13 }}>
        <span style={{ opacity: 0.78 }}>Subtotal</span>
        <span style={{ fontWeight: 800 }}>{formatMoney(totals.subtotal)}</span>
        <span style={{ opacity: 0.78 }}>Shipping</span>
        <span style={{ fontWeight: 800 }}>{formatMoney(totals.shippingCost)}</span>
        <span style={{ opacity: 0.78 }}>Tax</span>
        <span style={{ fontWeight: 800 }}>{formatMoney(totals.taxCost)}</span>
        <span style={{ fontWeight: 900 }}>Total</span>
        <span style={{ fontWeight: 900 }}>{formatMoney(totals.total)}</span>
      </div>
    </div>
  );
}
