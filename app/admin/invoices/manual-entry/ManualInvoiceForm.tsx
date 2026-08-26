"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { createManualInvoiceAction, type ManualInvoiceActionState } from "./actions";

type LocationOption = {
  id: string;
  name: string;
  locationNumber: string | null;
};

type VendorTaxRate = {
  vendor: "SUCCESS_PLUS" | "AMERICAN_PLUS";
  taxRatePct: number;
};

type Line = {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxMode: "automatic" | "manual" | "none";
  manualTax: string;
  sku: string;
  partNumber: string;
};

const initialActionState: ManualInvoiceActionState = { error: null };

function newLine(key: string): Line {
  return {
    key,
    description: "",
    quantity: "1",
    unitPrice: "",
    taxMode: "automatic",
    manualTax: "",
    sku: "",
    partNumber: "",
  };
}

function parseAmount(value: string): number {
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="manual-invoice-primary" type="submit" disabled={pending}>
      {pending ? "Creating invoice…" : "Submit manual invoice"}
    </button>
  );
}

export default function ManualInvoiceForm({
  locations,
  vendorTaxRates,
  today,
}: {
  locations: LocationOption[];
  vendorTaxRates: VendorTaxRate[];
  today: string;
}) {
  const [actionState, formAction] = useActionState(createManualInvoiceAction, initialActionState);
  const [vendor, setVendor] = useState<VendorTaxRate["vendor"]>("SUCCESS_PLUS");
  const [lines, setLines] = useState<Line[]>([newLine("line-1")]);
  const [nextLineNumber, setNextLineNumber] = useState(2);

  const taxRate = vendorTaxRates.find((item) => item.vendor === vendor)?.taxRatePct ?? 0;
  const totals = useMemo(() => {
    return lines.reduce(
      (sum, line) => {
        const quantity = Math.max(0, Number.parseInt(line.quantity, 10) || 0);
        const subtotal = quantity * parseAmount(line.unitPrice);
        const tax =
          line.taxMode === "manual"
            ? parseAmount(line.manualTax)
            : line.taxMode === "automatic"
              ? subtotal * (taxRate / 100)
              : 0;
        return { subtotal: sum.subtotal + subtotal, tax: sum.tax + tax, total: sum.total + subtotal + tax };
      },
      { subtotal: 0, tax: 0, total: 0 },
    );
  }, [lines, taxRate]);

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine() {
    const key = `line-${nextLineNumber}`;
    setNextLineNumber((current) => current + 1);
    setLines((current) => [...current, newLine(key)]);
  }

  function removeLine(key: string) {
    setLines((current) => current.filter((line) => line.key !== key));
  }

  return (
    <form action={formAction} className="manual-invoice-form">
      <section className="manual-invoice-card">
        <div className="manual-invoice-section-heading">
          <div>
            <h2>Invoice details</h2>
            <p>Choose who is being billed and enter the invoice dates.</p>
          </div>
        </div>

        <div className="manual-invoice-header-grid">
          <label>
            Billing location
            <select name="storeId" required defaultValue="">
              <option value="" disabled>
                Select a location…
              </option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.locationNumber ? `${location.locationNumber} — ` : ""}
                  {location.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Invoice company
            <select name="vendor" value={vendor} onChange={(event) => setVendor(event.target.value as VendorTaxRate["vendor"])}>
              <option value="SUCCESS_PLUS">Success Plus</option>
              <option value="AMERICAN_PLUS">American Plus</option>
            </select>
          </label>

          <label>
            Invoice number <span>(optional)</span>
            <input name="vendorNumber" maxLength={120} placeholder="N/A" />
          </label>

          <label>
            Billed to <span>(optional override)</span>
            <input name="billedTo" maxLength={240} placeholder="Uses selected location if blank" />
          </label>

          <label>
            Invoice date
            <input name="invoiceDate" type="date" required defaultValue={today} />
          </label>

          <label>
            Period start
            <input name="periodStart" type="date" required defaultValue={today} />
          </label>

          <label>
            Period end
            <input name="periodEnd" type="date" required defaultValue={today} />
          </label>
        </div>
      </section>

      <section className="manual-invoice-card">
        <div className="manual-invoice-section-heading">
          <div>
            <h2>Line items</h2>
            <p>These descriptions do not need to exist in inventory. Automatic tax uses the current {vendor === "SUCCESS_PLUS" ? "Success Plus" : "American Plus"} tax setting ({taxRate}%).</p>
          </div>
          <button type="button" className="manual-invoice-secondary" onClick={addLine} disabled={lines.length >= 50}>
            + Add line
          </button>
        </div>

        <div className="manual-invoice-lines">
          {lines.map((line, index) => {
            const quantity = Math.max(0, Number.parseInt(line.quantity, 10) || 0);
            const subtotal = quantity * parseAmount(line.unitPrice);
            const tax =
              line.taxMode === "manual"
                ? parseAmount(line.manualTax)
                : line.taxMode === "automatic"
                  ? subtotal * (taxRate / 100)
                  : 0;

            return (
              <div className="manual-invoice-line" key={line.key}>
                <div className="manual-invoice-line-title">
                  <strong>Line {index + 1}</strong>
                  <span>{money(subtotal + tax)}</span>
                </div>

                <div className="manual-invoice-line-grid">
                  <label className="manual-invoice-description">
                    Description
                    <input
                      name="lineDescription"
                      value={line.description}
                      onChange={(event) => updateLine(line.key, { description: event.target.value })}
                      maxLength={240}
                      placeholder="Service, fee, non-inventory item…"
                      required
                    />
                  </label>

                  <label>
                    Quantity
                    <input
                      name="lineQuantity"
                      type="number"
                      min={1}
                      max={100000}
                      step={1}
                      value={line.quantity}
                      onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                      required
                    />
                  </label>

                  <label>
                    Unit price
                    <input
                      name="lineUnitPrice"
                      inputMode="decimal"
                      value={line.unitPrice}
                      onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                      placeholder="0.00"
                      required
                    />
                  </label>

                  <label>
                    Tax
                    <select
                      name="lineTaxMode"
                      value={line.taxMode}
                      onChange={(event) => updateLine(line.key, { taxMode: event.target.value as Line["taxMode"] })}
                    >
                      <option value="automatic">Add tax ({taxRate}%)</option>
                      <option value="manual">Enter tax manually</option>
                      <option value="none">No tax</option>
                    </select>
                  </label>

                  <label>
                    Manual tax
                    <input
                      name="lineManualTax"
                      inputMode="decimal"
                      value={line.manualTax}
                      onChange={(event) => updateLine(line.key, { manualTax: event.target.value })}
                      placeholder="0.00"
                      disabled={line.taxMode !== "manual"}
                      aria-label={`Manual tax for line ${index + 1}`}
                    />
                    {line.taxMode !== "manual" ? <input type="hidden" name="lineManualTax" value="" /> : null}
                  </label>

                  <label>
                    SKU <span>(optional)</span>
                    <input
                      name="lineSku"
                      value={line.sku}
                      onChange={(event) => updateLine(line.key, { sku: event.target.value })}
                      maxLength={120}
                      placeholder="MANUAL"
                    />
                  </label>

                  <label>
                    Part # <span>(optional)</span>
                    <input
                      name="linePartNumber"
                      value={line.partNumber}
                      onChange={(event) => updateLine(line.key, { partNumber: event.target.value })}
                      maxLength={120}
                    />
                  </label>

                  <div className="manual-invoice-line-actions">
                    <button
                      type="button"
                      className="manual-invoice-remove"
                      onClick={() => removeLine(line.key)}
                      disabled={lines.length === 1}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button type="button" className="manual-invoice-secondary manual-invoice-add-bottom" onClick={addLine} disabled={lines.length >= 50}>
          + Add another line
        </button>
      </section>

      <section className="manual-invoice-card manual-invoice-submit-card">
        <div className="manual-invoice-totals" aria-live="polite">
          <div><span>Subtotal</span><strong>{money(totals.subtotal)}</strong></div>
          <div><span>Tax</span><strong>{money(totals.tax)}</strong></div>
          <div className="manual-invoice-grand-total"><span>Total</span><strong>{money(totals.total)}</strong></div>
          <small>Automatic-tax previews use the displayed rate. The configured tax formula is applied when you submit.</small>
        </div>

        <div className="manual-invoice-submit-actions">
          {actionState.error ? <div className="manual-invoice-error" role="alert">{actionState.error}</div> : null}
          <SubmitButton />
        </div>
      </section>
    </form>
  );
}
