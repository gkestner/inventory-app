"use server";

import { InvoiceVendor, Permission } from "@prisma/client";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { evaluateTaxFormula, loadVendorPricingAndTaxConfig } from "../actions";

export type ManualInvoiceActionState = {
  error: string | null;
};

type TaxMode = "automatic" | "manual" | "none";

type ParsedLine = {
  submittedAt: Date;
  sku: string;
  partNumber: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
  taxable: boolean;
  lineSubtotalCents: number;
  lineTaxCents: number;
  lineTotalCents: number;
};

async function requireInvoiceEditAccess() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS])) return null;

  return session;
}

function valueAt(values: FormDataEntryValue[], index: number): string {
  return String(values[index] ?? "").trim();
}

function parseDateOnly(value: FormDataEntryValue | null, label: string): Date {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`${label} is required.`);

  // Noon avoids a calendar-date shift when the invoice is viewed in another US time zone.
  const parsed = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid.`);
  return parsed;
}

function parsePositiveInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a whole number.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100000) {
    throw new Error(`${label} must be between 1 and 100,000.`);
  }
  return parsed;
}

function parseMoneyToCents(value: string, label: string, required = true): number {
  const normalized = value.replace(/[$,\s]/g, "");
  if (!normalized) {
    if (!required) return 0;
    throw new Error(`${label} is required.`);
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${label} must be a non-negative dollar amount with no more than two decimals.`);
  }

  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 9999999999) throw new Error(`${label} is too large.`);
  return cents;
}

function parsePercent(value: string, label: string): number {
  const normalized = value.replace(/[%\s]/g, "");
  if (!normalized) throw new Error(`${label} is required.`);
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) {
    throw new Error(`${label} must be a percentage such as 9.25.`);
  }

  const percent = Number(normalized);
  if (!Number.isFinite(percent) || percent < 0 || percent > 999.99) {
    throw new Error(`${label} must be between 0 and 999.99.`);
  }
  return percent;
}

function centsToDollars(cents: number): number {
  return cents / 100;
}

function normalizeVendor(value: FormDataEntryValue | null): InvoiceVendor {
  return String(value ?? "").trim().toUpperCase() === InvoiceVendor.AMERICAN_PLUS
    ? InvoiceVendor.AMERICAN_PLUS
    : InvoiceVendor.SUCCESS_PLUS;
}

function normalizeTaxMode(value: string): TaxMode {
  if (value === "automatic" || value === "manual" || value === "none") return value;
  throw new Error("Each line needs a valid tax selection.");
}

function cleanOptional(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function friendlyError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "The manual invoice could not be created. Please try again.";
}

export async function createManualInvoiceAction(
  _previousState: ManualInvoiceActionState,
  formData: FormData,
): Promise<ManualInvoiceActionState> {
  const session = await requireInvoiceEditAccess();
  if (!session) return { error: "You do not have permission to create invoices." };

  try {
    const storeId = String(formData.get("storeId") ?? "").trim();
    if (!storeId) throw new Error("Choose a billing location.");

    const vendor = normalizeVendor(formData.get("vendor"));
    const invoiceDate = parseDateOnly(formData.get("invoiceDate"), "Invoice date");
    const periodStart = parseDateOnly(formData.get("periodStart"), "Period start");
    const periodEnd = parseDateOnly(formData.get("periodEnd"), "Period end");
    if (periodStart > periodEnd) throw new Error("Period start must be on or before period end.");

    const location = await prisma.location.findUnique({
      where: { id: storeId },
      select: { id: true, name: true, locationNumber: true },
    });
    if (!location) throw new Error("The selected billing location no longer exists.");

    const descriptions = formData.getAll("lineDescription");
    const quantities = formData.getAll("lineQuantity");
    const unitPrices = formData.getAll("lineUnitPrice");
    const taxModes = formData.getAll("lineTaxMode");
    const manualTaxRates = formData.getAll("lineManualTaxRate");
    const skus = formData.getAll("lineSku");
    const partNumbers = formData.getAll("linePartNumber");

    if (descriptions.length === 0) throw new Error("Add at least one invoice line.");
    if (descriptions.length > 50) throw new Error("A manual invoice can contain up to 50 lines.");
    if (
      quantities.length !== descriptions.length ||
      unitPrices.length !== descriptions.length ||
      taxModes.length !== descriptions.length ||
      manualTaxRates.length !== descriptions.length ||
      skus.length !== descriptions.length ||
      partNumbers.length !== descriptions.length
    ) {
      throw new Error("One or more invoice lines are incomplete. Please review the form and try again.");
    }

    const taxConfig = await loadVendorPricingAndTaxConfig(vendor);
    const parsedLines: ParsedLine[] = [];

    for (let index = 0; index < descriptions.length; index += 1) {
      const lineNumber = index + 1;
      const name = valueAt(descriptions, index).replace(/\s+/g, " ");
      if (!name) throw new Error(`Line ${lineNumber}: description is required.`);
      if (name.length > 240) throw new Error(`Line ${lineNumber}: description must be 240 characters or fewer.`);

      const quantity = parsePositiveInteger(valueAt(quantities, index), `Line ${lineNumber} quantity`);
      const unitPriceCents = parseMoneyToCents(valueAt(unitPrices, index), `Line ${lineNumber} unit price`);
      const lineSubtotalCents = quantity * unitPriceCents;
      if (!Number.isSafeInteger(lineSubtotalCents) || lineSubtotalCents > 999999999999) {
        throw new Error(`Line ${lineNumber}: subtotal is too large.`);
      }

      const taxMode = normalizeTaxMode(valueAt(taxModes, index));
      let lineTaxCents = 0;

      if (taxMode === "manual") {
        const manualTaxRate = parsePercent(valueAt(manualTaxRates, index), `Line ${lineNumber} manual tax rate`);
        lineTaxCents = Math.round(lineSubtotalCents * (manualTaxRate / 100));
      } else if (taxMode === "automatic") {
        const evaluated = await evaluateTaxFormula(taxConfig.taxFormula, {
          lineSubtotal: centsToDollars(lineSubtotalCents),
          taxRatePct: taxConfig.taxRatePct,
          quantity,
          unitPrice: centsToDollars(unitPriceCents),
        });
        if (!Number.isFinite(evaluated) || evaluated < 0) {
          throw new Error(`Line ${lineNumber}: the configured automatic tax formula returned an invalid amount.`);
        }
        lineTaxCents = Math.round(evaluated * 100);
      }

      const lineTotalCents = lineSubtotalCents + lineTaxCents;
      if (!Number.isSafeInteger(lineTotalCents) || lineTotalCents > 999999999999) {
        throw new Error(`Line ${lineNumber}: total is too large.`);
      }

      const sku = valueAt(skus, index).slice(0, 120) || "MANUAL";
      const partNumber = valueAt(partNumbers, index).slice(0, 120) || null;

      parsedLines.push({
        submittedAt: invoiceDate,
        sku,
        partNumber,
        name,
        quantity,
        unitPriceCents,
        taxable: taxMode !== "none",
        lineSubtotalCents,
        lineTaxCents,
        lineTotalCents,
      });
    }

    const subtotalCents = parsedLines.reduce((sum, line) => sum + line.lineSubtotalCents, 0);
    const taxTotalCents = parsedLines.reduce((sum, line) => sum + line.lineTaxCents, 0);
    const totalCents = subtotalCents + taxTotalCents;
    const storeNumber = String(location.locationNumber ?? "").trim() || "N/A";
    const billedToOverride = cleanOptional(formData.get("billedTo"), 240);
    const vendorNumber = cleanOptional(formData.get("vendorNumber"), 120) || "N/A";
    const createdByUserId = String((session.user as { id?: string | null } | undefined)?.id ?? "").trim() || null;

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          vendor,
          vendorNumber,
          billedTo: billedToOverride || `${storeNumber} ${location.name}`,
          storeId: location.id,
          storeName: location.name,
          storeNumber,
          periodStart,
          periodEnd,
          invoiceDate,
          subtotal: centsToDollars(subtotalCents),
          taxTotal: centsToDollars(taxTotalCents),
          total: centsToDollars(totalCents),
          createdByUserId,
        },
        select: { id: true },
      });

      await tx.invoiceLine.createMany({
        data: parsedLines.map((line) => ({
          invoiceId: created.id,
          checkoutId: null,
          submittedAt: line.submittedAt,
          sku: line.sku,
          partNumber: line.partNumber,
          name: line.name,
          quantity: line.quantity,
          unitPrice: centsToDollars(line.unitPriceCents),
          taxable: line.taxable,
          lineSubtotal: centsToDollars(line.lineSubtotalCents),
          lineTax: centsToDollars(line.lineTaxCents),
          lineTotal: centsToDollars(line.lineTotalCents),
        })),
      });

      return created;
    });

    revalidatePath("/admin/invoices");
    revalidatePath(`/admin/invoices/${invoice.id}/print`);
    redirect(
      `/admin/invoices?queued=${encodeURIComponent(invoice.id)}&vendor=${encodeURIComponent(vendor)}`,
    );
  } catch (error) {
    // Next's redirect is implemented as a framework-thrown error and must be rethrown.
    if (
      error &&
      typeof error === "object" &&
      typeof (error as { digest?: unknown }).digest === "string" &&
      String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    return { error: friendlyError(error) };
  }
}
