// app/admin/invoices/actions.ts
"use server";

import { prisma } from "@/app/lib/prisma";
import { InvoiceStatus, InvoiceVendor, PartsCheckoutStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

type CreateInvoicesForWindowArgs = {
  vendor: InvoiceVendor;
  periodStart: Date;
  periodEnd: Date;
  invoiceDate: Date;

  // Optional: if you later want to stamp who generated invoices
  createdByUserId?: string | null;
};

type CreateInvoicesForWindowResult = {
  results: Array<{
    storeId: string;
    storeName: string;
    storeNumber: string;
    invoiceId: string;
    ticketCount: number;
    total: string; // decimal string
  }>;
};

function toDecimal(v: unknown): Decimal {
  if (v === null || v === undefined) return new Decimal(0);
  try {
    // Prisma may return Decimal instances, strings, or numbers depending on usage/serialization.
    if (v instanceof Decimal) return v;
    if (typeof v === "string" || typeof v === "number") return new Decimal(v);
    // last resort (covers e.g. objects that Decimal can parse)
    return new Decimal(String(v));
  } catch {
    return new Decimal(0);
  }
}

function pctToMultiplier(pct: Decimal): Decimal {
  // pct stored as whole percent (10.00 = 10%)
  return new Decimal(1).add(pct.div(new Decimal(100)));
}

function roundMoney(d: Decimal): Decimal {
  // force to 2dp (as Decimal)
  return new Decimal(d.toFixed(2));
}

/**
 * createInvoicesForWindow
 * - Manual trigger.
 * - One invoice per store for all OPEN, not-yet-invoiced tickets in the submitted window.
 * - Vendor-based: ONLY tickets where PartsCheckoutTicket.vendorSnapshot === args.vendor.
 * - Vendor rules:
 *   - partsUpchargePct applies to the ticket unit price snapshot (fallback costSnapshot if priceSnapshot missing)
 *   - taxRatePct applies to taxable lines only
 * - Atomic per store: invoice + lines + ticket links/status all in one transaction per store.
 */
export async function createInvoicesForWindow(args: CreateInvoicesForWindowArgs): Promise<CreateInvoicesForWindowResult> {
  const { vendor, periodStart, periodEnd, invoiceDate, createdByUserId = null } = args;

  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    throw new Error("Invalid periodStart/periodEnd");
  }
  if (Number.isNaN(invoiceDate.getTime())) {
    throw new Error("Invalid invoiceDate");
  }

  // Load vendor config (defaults to 0% if missing)
  const cfg = await prisma.invoiceVendorConfig.findUnique({
    where: { vendor },
    select: { partsUpchargePct: true, taxRatePct: true },
  });

  // Avoid `any` by converting unknown-ish Prisma field values via toDecimal().
  const partsUpchargePct = cfg?.partsUpchargePct ? toDecimal(cfg.partsUpchargePct) : new Decimal(0);
  const taxRatePct = cfg?.taxRatePct ? toDecimal(cfg.taxRatePct) : new Decimal(0);

  const upchargeMult = pctToMultiplier(partsUpchargePct);
  const taxMult = taxRatePct.div(new Decimal(100));

  // Find all candidate tickets in the window that are not yet invoiced, filtered by vendorSnapshot.
  // We use BOTH guards: invoiceId null + invoicedAt null, for safety.
  const tickets = await prisma.partsCheckoutTicket.findMany({
    where: {
      status: PartsCheckoutStatus.OPEN,
      voidedAt: null,
      invoiceId: null,
      invoicedAt: null,
      createdAt: { gte: periodStart, lte: periodEnd },

      // ✅ critical for vendor-based invoicing
      vendorSnapshot: vendor,
    },
    orderBy: [{ storeName: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      createdAt: true,

      storeId: true,
      storeName: true,
      store: { select: { locationNumber: true, name: true } },

      quantity: true,

      skuSnapshot: true,
      partNumberSnapshot: true,
      nameSnapshot: true,

      vendorSnapshot: true,
      costSnapshot: true,
      priceSnapshot: true,
      taxableSnapshot: true,
    },
  });

  if (tickets.length === 0) return { results: [] };

  // Group by storeId
  const byStore = new Map<string, typeof tickets>();
  for (const t of tickets) {
    const arr = byStore.get(t.storeId) ?? [];
    arr.push(t);
    byStore.set(t.storeId, arr);
  }

  const results: CreateInvoicesForWindowResult["results"] = [];

  for (const [storeId, storeTickets] of byStore.entries()) {
    // Use store snapshot from first ticket (all same store)
    const storeName = storeTickets[0]?.storeName ?? "Unknown Store";
    const storeNumber = storeTickets[0]?.store?.locationNumber ?? null;

    if (!storeNumber || String(storeNumber).trim() === "") {
      // Hard-stop: vendorNumber/billedTo require a location number.
      throw new Error(`Missing locationNumber for store "${storeName}". Set Location.locationNumber before invoicing.`);
    }

    const vendorSuffix = vendor === InvoiceVendor.SUCCESS_PLUS ? "SP" : "APLS";
    const vendorNumber = `${storeNumber}${vendorSuffix}`;
    const billedTo = `Pizza Plus of (${storeNumber} ${storeName})`;

    const ticketIds = storeTickets.map((t) => t.id);

    const res = await prisma.$transaction(async (tx) => {
      // Re-check inside TX to prevent double invoicing if concurrent runs happen
      const freshTickets = await tx.partsCheckoutTicket.findMany({
        where: {
          id: { in: ticketIds },
          status: PartsCheckoutStatus.OPEN,
          voidedAt: null,
          invoiceId: null,
          invoicedAt: null,

          // ✅ enforce vendor scoping inside TX too
          vendorSnapshot: vendor,
        },
        select: {
          id: true,
          createdAt: true,
          quantity: true,
          skuSnapshot: true,
          partNumberSnapshot: true,
          nameSnapshot: true,
          vendorSnapshot: true,
          costSnapshot: true,
          priceSnapshot: true,
          taxableSnapshot: true,
        },
      });

      if (freshTickets.length === 0) return null;

      // Create invoice first (totals set after lines)
      const inv = await tx.invoice.create({
        data: {
          vendor,
          vendorNumber,
          billedTo,

          storeId,
          storeName,
          storeNumber: String(storeNumber),

          periodStart,
          periodEnd,
          invoiceDate,

          status: InvoiceStatus.DRAFT,

          subtotal: new Decimal(0),
          taxTotal: new Decimal(0),
          total: new Decimal(0),

          createdByUserId: createdByUserId || null,
        },
        select: { id: true },
      });

      // Compute totals
      let subtotal = new Decimal(0);
      let taxTotal = new Decimal(0);

      // Create lines (1 per ticket)
      for (const t of freshTickets) {
        const qty = t.quantity ?? 0;

        // Base price: prefer priceSnapshot; fall back to costSnapshot; else 0
        const baseUnit = t.priceSnapshot ? toDecimal(t.priceSnapshot) : toDecimal(t.costSnapshot);

        // Apply vendor upcharge
        const unitPrice = roundMoney(baseUnit.mul(upchargeMult));

        const lineSubtotal = roundMoney(unitPrice.mul(new Decimal(qty)));

        const taxable = Boolean(t.taxableSnapshot);
        const lineTax = taxable ? roundMoney(lineSubtotal.mul(taxMult)) : new Decimal(0);

        const lineTotal = lineSubtotal.add(lineTax);

        subtotal = subtotal.add(lineSubtotal);
        taxTotal = taxTotal.add(lineTax);

        await tx.invoiceLine.create({
          data: {
            invoiceId: inv.id,
            checkoutId: t.id,

            submittedAt: t.createdAt,

            sku: t.skuSnapshot,
            partNumber: t.partNumberSnapshot,
            name: t.nameSnapshot,

            quantity: qty,
            unitPrice,
            taxable,

            lineSubtotal,
            lineTax,
            lineTotal,
          },
        });
      }

      const total = subtotal.add(taxTotal);

      // Update invoice totals
      await tx.invoice.update({
        where: { id: inv.id },
        data: {
          subtotal: roundMoney(subtotal),
          taxTotal: roundMoney(taxTotal),
          total: roundMoney(total),
        },
      });

      // Link + mark tickets invoiced
      await tx.partsCheckoutTicket.updateMany({
        where: { id: { in: freshTickets.map((t) => t.id) } },
        data: {
          invoiceId: inv.id,
          status: PartsCheckoutStatus.INVOICED,
          invoicedAt: invoiceDate,
        },
      });

      return {
        invoiceId: inv.id,
        ticketCount: freshTickets.length,
        total: roundMoney(total).toFixed(2),
      };
    });

    if (res) {
      results.push({
        storeId,
        storeName,
        storeNumber: String(storeNumber),
        invoiceId: res.invoiceId,
        ticketCount: res.ticketCount,
        total: res.total,
      });
    }
  }

  return { results };
}
