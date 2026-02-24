// app/admin/invoices/actions.ts
"use server";

import { prisma } from "@/app/lib/prisma";
import { InvoiceStatus, InvoiceVendor, PartsCheckoutStatus } from "@prisma/client";

type CreateInvoicesArgs = {
  vendor: InvoiceVendor;
  periodStart: Date;
  periodEnd: Date;
  invoiceDate: Date;
};

type CreateInvoicesResult = {
  vendor: InvoiceVendor;
  periodStart: Date;
  periodEnd: Date;
  invoiceDate: Date;
  results: Array<{
    storeId: string;
    storeName: string;
    invoiceId?: string;
    createdLines?: number;
    reason?: string;
  }>;
};

/**
 * ===========================
 * Safe formula evaluator (server)
 * ===========================
 * - Whitelisted variables only
 * - Whitelisted helpers only
 * - Supports: numbers, + - * /, parentheses, commas, function calls
 * - No property access, no strings, no comparisons, no assignments
 */
type Tok =
  | { t: "num"; v: number }
  | { t: "ident"; v: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" };

function isDigit(ch: string) {
  return ch >= "0" && ch <= "9";
}

function isAlpha(ch: string) {
  return /[a-zA-Z_]/.test(ch);
}

function isAlphaNum(ch: string) {
  return /[a-zA-Z0-9_]/.test(ch);
}

function tokenize(input: string): Tok[] {
  const s = String(input ?? "").trim();
  if (!s) throw new Error("Formula is empty.");

  const out: Tok[] = [];
  let i = 0;

  while (i < s.length) {
    const c = s[i];

    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }

    if (c === "(") {
      out.push({ t: "lp" });
      i++;
      continue;
    }
    if (c === ")") {
      out.push({ t: "rp" });
      i++;
      continue;
    }
    if (c === ",") {
      out.push({ t: "comma" });
      i++;
      continue;
    }

    if (c === "+" || c === "-" || c === "*" || c === "/") {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }

    if (isDigit(c) || c === ".") {
      let j = i;
      let seenDot = false;

      if (s[j] === ".") {
        seenDot = true;
        j++;
        if (j >= s.length || !isDigit(s[j])) throw new Error(`Invalid number near "." at position ${i + 1}.`);
      }

      while (j < s.length) {
        const ch = s[j];
        if (isDigit(ch)) {
          j++;
          continue;
        }
        if (ch === ".") {
          if (seenDot) break;
          seenDot = true;
          j++;
          continue;
        }
        break;
      }

      const raw = s.slice(i, j);
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`Invalid number: ${raw}`);
      out.push({ t: "num", v: n });
      i = j;
      continue;
    }

    if (isAlpha(c)) {
      let j = i;
      while (j < s.length && isAlphaNum(s[j])) j++;
      const raw = s.slice(i, j);
      out.push({ t: "ident", v: raw });
      i = j;
      continue;
    }

    throw new Error(`Invalid character "${c}".`);
  }

  return out;
}

function normalizeUnary(tokens: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (const tok of tokens) {
    if (tok.t === "op" && tok.v === "-") {
      const prev = out[out.length - 1];
      const isUnary = !prev || prev.t === "op" || prev.t === "lp" || prev.t === "comma";
      if (isUnary) {
        out.push({ t: "num", v: 0 });
        out.push({ t: "op", v: "-" });
        continue;
      }
    }
    out.push(tok);
  }
  return out;
}

function prec(op: "+" | "-" | "*" | "/") {
  return op === "*" || op === "/" ? 2 : 1;
}

type RpnTok =
  | { t: "num"; v: number }
  | { t: "var"; v: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" }
  | { t: "fn"; v: string; argc: number };

function toRpn(tokens: Tok[], allowedVars: Set<string>, allowedFns: Set<string>): RpnTok[] {
  const out: RpnTok[] = [];
  const opStack: Array<Tok | { t: "fn"; name: string; argc: number }> = [];
  const argcStack: number[] = [];
  let lastWasValue = false;

  const pushIdent = (name: string) => {
    const lower = name.toLowerCase();
    // function call if next token is '(' handled in loop by peeking
    if (allowedVars.has(lower)) {
      out.push({ t: "var", v: lower });
      lastWasValue = true;
      return;
    }
    if (allowedFns.has(lower)) {
      // will be converted to fn when we see '('
      opStack.push({ t: "fn", name: lower, argc: 0 });
      lastWasValue = false;
      return;
    }
    throw new Error(`Unknown identifier "${name}".`);
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.t === "num") {
      out.push({ t: "num", v: tok.v });
      lastWasValue = true;
      continue;
    }

    if (tok.t === "ident") {
      // If it's a function name, we push as fn marker now; '(' will follow.
      pushIdent(tok.v);
      continue;
    }

    if (tok.t === "lp") {
      // If the previous thing on opStack is a fn marker, this '(' starts its arg list.
      const top = opStack[opStack.length - 1];
      if (top && (top as any).t === "fn") {
        // Start counting args; argc is 1 if next token produces a value, but we count commas +1.
        argcStack.push(0);
      }
      opStack.push(tok);
      lastWasValue = false;
      continue;
    }

    if (tok.t === "comma") {
      // Pop operators until '('
      while (opStack.length) {
        const top = opStack[opStack.length - 1];
        if ((top as Tok).t === "lp") break;
        const popped = opStack.pop()!;
        if ((popped as Tok).t === "op") out.push({ t: "op", v: (popped as Tok).v as any });
        else if ((popped as any).t === "fn") {
          // shouldn't happen here
        }
      }
      if (!opStack.length) throw new Error("Misplaced comma.");

      // increment current function argc counter
      if (argcStack.length === 0) throw new Error("Comma outside function call.");
      argcStack[argcStack.length - 1] += 1;
      lastWasValue = false;
      continue;
    }

    if (tok.t === "op") {
      while (opStack.length) {
        const top = opStack[opStack.length - 1] as any;
        if (top.t === "op" && prec(top.v) >= prec(tok.v)) {
          out.push({ t: "op", v: top.v });
          opStack.pop();
          continue;
        }
        break;
      }
      opStack.push(tok);
      lastWasValue = false;
      continue;
    }

    if (tok.t === "rp") {
      let matched = false;
      while (opStack.length) {
        const top = opStack.pop() as any;

        if (top.t === "lp") {
          matched = true;
          break;
        }

        if (top.t === "op") out.push({ t: "op", v: top.v });
        else if (top.t === "fn") {
          // shouldn't happen
        }
      }
      if (!matched) throw new Error("Mismatched parentheses.");

      // If the thing before this ')' is a function marker, emit it.
      const maybeFn = opStack[opStack.length - 1] as any;
      if (maybeFn && maybeFn.t === "fn") {
        opStack.pop();
        const commas = argcStack.pop() ?? 0;

        // If we had any value inside parens, argc = commas+1, else 0 (empty call)
        // We'll treat empty call as invalid.
        const argc = lastWasValue ? commas + 1 : 0;
        if (argc <= 0) throw new Error(`Function "${maybeFn.name}" requires arguments.`);
        out.push({ t: "fn", v: maybeFn.name, argc });
      }

      lastWasValue = true;
      continue;
    }
  }

  while (opStack.length) {
    const top = opStack.pop() as any;
    if (top.t === "lp" || top.t === "rp") throw new Error("Mismatched parentheses.");
    if (top.t === "op") out.push({ t: "op", v: top.v });
    else if (top.t === "fn") throw new Error("Function call missing parentheses.");
  }

  return out;
}

function evalRpn(rpn: RpnTok[], vars: Record<string, number>): number {
  const st: number[] = [];

  const fns: Record<string, (...args: number[]) => number> = {
    min: (...a) => Math.min(...a),
    max: (...a) => Math.max(...a),
    round: (x) => Math.round(x),
    floor: (x) => Math.floor(x),
    ceil: (x) => Math.ceil(x),
    abs: (x) => Math.abs(x),
  };

  for (const tok of rpn) {
    if (tok.t === "num") {
      st.push(tok.v);
      continue;
    }

    if (tok.t === "var") {
      const v = vars[tok.v];
      if (!Number.isFinite(v)) throw new Error(`Variable "${tok.v}" is not a valid number.`);
      st.push(v);
      continue;
    }

    if (tok.t === "op") {
      const b = st.pop();
      const a = st.pop();
      if (a === undefined || b === undefined) throw new Error("Invalid formula.");

      let r = 0;
      if (tok.v === "+") r = a + b;
      else if (tok.v === "-") r = a - b;
      else if (tok.v === "*") r = a * b;
      else {
        if (b === 0) throw new Error("Division by zero.");
        r = a / b;
      }

      if (!Number.isFinite(r)) throw new Error("Formula result is not finite.");
      st.push(r);
      continue;
    }

    if (tok.t === "fn") {
      const fn = fns[tok.v];
      if (!fn) throw new Error(`Function "${tok.v}" is not allowed.`);
      const argc = tok.argc;
      if (argc <= 0) throw new Error("Invalid function call.");

      const args: number[] = [];
      for (let i = 0; i < argc; i++) {
        const v = st.pop();
        if (v === undefined) throw new Error("Invalid function arguments.");
        args.push(v);
      }
      args.reverse();

      const r = fn(...args);
      if (!Number.isFinite(r)) throw new Error("Formula result is not finite.");
      st.push(r);
      continue;
    }

    throw new Error("Invalid token.");
  }

  if (st.length !== 1) throw new Error("Invalid formula.");
  return st[0];
}

function evaluateFormula(
  formula: string,
  vars: Record<string, number>,
  allowedVars: string[],
  allowedFns: string[]
): number {
  const av = new Set(allowedVars.map((s) => s.toLowerCase()));
  const af = new Set(allowedFns.map((s) => s.toLowerCase()));
  const tokens = normalizeUnary(tokenize(formula));
  const rpn = toRpn(tokens, av, af);
  const out = evalRpn(rpn, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k.toLowerCase(), v])));
  return out;
}

function roundMoney(n: number): number {
  // stable, invoice-safe rounding
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function loadVendorConfigForPricingAndTax(vendor: InvoiceVendor) {
  // Defaults if config table/fields aren't ready.
  const DEFAULTS = {
    partsUpchargePct: 0,
    partsPriceFormula: "cost * (1 + (partsUpchargePct / 100))",
    taxRatePct: 0,
    taxFormula: "lineSubtotal * (taxRatePct / 100)",
  };

  const pAny = prisma as any;
  const vendorConfigReady =
    typeof pAny.invoiceVendorConfig?.findUnique === "function" || typeof pAny.invoiceVendorConfig?.findFirst === "function";

  if (!vendorConfigReady) return DEFAULTS;

  try {
    const row =
      (await pAny.invoiceVendorConfig.findUnique?.({
        where: { vendor },
        select: {
          partsUpchargePct: true,
          partsPriceFormula: true,
          taxRatePct: true,
          taxFormula: true,
        },
      })) ??
      (await pAny.invoiceVendorConfig.findFirst?.({
        where: { vendor },
        select: {
          partsUpchargePct: true,
          partsPriceFormula: true,
          taxRatePct: true,
          taxFormula: true,
        },
      }));

    if (!row) return DEFAULTS;

    return {
      partsUpchargePct: Number(row.partsUpchargePct ?? 0),
      partsPriceFormula: String(row.partsPriceFormula ?? DEFAULTS.partsPriceFormula),
      taxRatePct: Number(row.taxRatePct ?? 0),
      taxFormula: String(row.taxFormula ?? DEFAULTS.taxFormula),
    };
  } catch {
    return DEFAULTS;
  }
}

export async function createInvoicesForWindow(args: CreateInvoicesArgs): Promise<CreateInvoicesResult> {
  const vendor = args.vendor;
  const periodStart = new Date(args.periodStart);
  const periodEnd = new Date(args.periodEnd);
  const invoiceDate = new Date(args.invoiceDate);

  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || Number.isNaN(invoiceDate.getTime())) {
    throw new Error("Invalid dates.");
  }
  if (periodEnd < periodStart) throw new Error("periodEnd must be >= periodStart.");

  // ✅ Load vendor-level pricing + tax configuration (1 formula per vendor)
  const cfg = await loadVendorConfigForPricingAndTax(vendor);

  const partsUpchargePct = Number.isFinite(cfg.partsUpchargePct) ? cfg.partsUpchargePct : 0;
  const partsPriceFormula = (cfg.partsPriceFormula || "").trim() || "cost * (1 + (partsUpchargePct / 100))";
  const taxRatePct = Number.isFinite(cfg.taxRatePct) ? cfg.taxRatePct : 0;
  const taxFormula = (cfg.taxFormula || "").trim() || "lineSubtotal * (taxRatePct / 100)";

  // Pull all eligible OPEN tickets for this vendor within window.
  // NOTE: tickets snapshot vendorSnapshot is the source of truth for vendor selection.
  const tickets = await prisma.partsCheckoutTicket.findMany({
    where: {
      status: PartsCheckoutStatus.OPEN,
      invoicedAt: null,
      voidedAt: null,
      createdAt: { gte: periodStart, lte: periodEnd },
      vendorSnapshot: vendor,
      invoiceId: null,
    },
    select: {
      id: true,
      storeId: true,
      storeName: true,
      quantity: true,
      createdAt: true,

      // snapshot pricing inputs
      costSnapshot: true,
      skuSnapshot: true,
      partNumberSnapshot: true,
      nameSnapshot: true,
      taxableSnapshot: true,
    },
    orderBy: [{ storeName: "asc" }, { createdAt: "asc" }],
  });

  const byStore = new Map<string, { storeId: string; storeName: string; tickets: typeof tickets }>();
  for (const t of tickets) {
    const key = t.storeId;
    const existing = byStore.get(key);
    if (existing) existing.tickets.push(t as any);
    else byStore.set(key, { storeId: t.storeId, storeName: t.storeName, tickets: [t as any] as any });
  }

  const results: CreateInvoicesResult["results"] = [];

  // If no stores, return quickly (caller can show empty).
  if (byStore.size === 0) {
    return { vendor, periodStart, periodEnd, invoiceDate, results };
  }

  // Preload store numbers and billedTo/vendorNumber data from Location (if available).
  const storeIds = Array.from(byStore.keys());
  const locations = await prisma.location.findMany({
    where: { id: { in: storeIds } },
    select: { id: true, name: true, locationNumber: true },
  });
  const locById = new Map(locations.map((l) => [l.id, l]));

  for (const store of byStore.values()) {
    try {
      const loc = locById.get(store.storeId);
      const storeNumber = (loc?.locationNumber || "").trim() || "0";

      // Build lines with vendor-level price formula (uses costSnapshot)
      const linesToCreate: Array<{
        checkoutId: string;
        submittedAt: Date;
        sku: string;
        partNumber: string | null;
        name: string;
        quantity: number;
        unitPrice: number;
        taxable: boolean;
        lineSubtotal: number;
        lineTax: number;
        lineTotal: number;
      }> = [];

      let subtotal = 0;
      let taxTotal = 0;
      let total = 0;

      for (const t of store.tickets) {
        const qty = Number(t.quantity || 0);
        if (!Number.isFinite(qty) || qty <= 0) continue;

        const cost = t.costSnapshot === null || t.costSnapshot === undefined ? 0 : Number(t.costSnapshot);
        if (!Number.isFinite(cost) || cost < 0) {
          // bad data; skip but record later if needed
          continue;
        }

        // ✅ Vendor-level pricing formula: cost -> unitPrice
        const unitPriceRaw = evaluateFormula(
          partsPriceFormula,
          { cost, partsUpchargePct },
          ["cost", "partsUpchargePct"],
          ["min", "max", "round", "floor", "ceil", "abs"]
        );
        const unitPrice = roundMoney(unitPriceRaw);

        const lineSubtotal = roundMoney(unitPrice * qty);
        const taxable = !!t.taxableSnapshot;

        // ✅ Vendor-level tax formula applies to the lineSubtotal (and can use qty/unitPrice)
        const lineTaxRaw = taxable
          ? evaluateFormula(
              taxFormula,
              { lineSubtotal, taxRatePct, quantity: qty, unitPrice },
              ["lineSubtotal", "taxRatePct", "quantity", "unitPrice"],
              ["min", "max", "round", "floor", "ceil", "abs"]
            )
          : 0;

        const lineTax = roundMoney(lineTaxRaw);
        const lineTotal = roundMoney(lineSubtotal + lineTax);

        subtotal = roundMoney(subtotal + lineSubtotal);
        taxTotal = roundMoney(taxTotal + lineTax);
        total = roundMoney(total + lineTotal);

        linesToCreate.push({
          checkoutId: t.id,
          submittedAt: t.createdAt,
          sku: t.skuSnapshot,
          partNumber: t.partNumberSnapshot ?? null,
          name: t.nameSnapshot,
          quantity: qty,
          unitPrice,
          taxable,
          lineSubtotal,
          lineTax,
          lineTotal,
        });
      }

      if (linesToCreate.length === 0) {
        results.push({
          storeId: store.storeId,
          storeName: store.storeName,
          reason: "No valid lines (quantity/cost issues).",
        });
        continue;
      }

      // ✅ Create invoice + lines + mark tickets invoiced atomically per store
      const created = await prisma.$transaction(async (tx) => {
        const inv = await tx.invoice.create({
          data: {
            vendor,
            vendorNumber: "", // keep safe; your print UI already tolerates null-ish/empty
            billedTo: "",
            storeId: store.storeId,
            storeName: store.storeName,
            storeNumber,
            periodStart,
            periodEnd,
            invoiceDate,
            status: InvoiceStatus.ISSUED,
            subtotal: subtotal as any,
            taxTotal: taxTotal as any,
            total: total as any,
          } as any,
          select: { id: true },
        });

        // Create lines
        for (const l of linesToCreate) {
          await tx.invoiceLine.create({
            data: {
              invoiceId: inv.id,
              checkoutId: l.checkoutId,
              submittedAt: l.submittedAt,
              sku: l.sku,
              partNumber: l.partNumber,
              name: l.name,
              quantity: l.quantity,
              unitPrice: l.unitPrice as any,
              taxable: l.taxable,
              lineSubtotal: l.lineSubtotal as any,
              lineTax: l.lineTax as any,
              lineTotal: l.lineTotal as any,
            } as any,
            select: { id: true },
          });
        }

        // Mark tickets as invoiced + attach invoiceId/invoicedAt/status
        await tx.partsCheckoutTicket.updateMany({
          where: { id: { in: linesToCreate.map((x) => x.checkoutId) } },
          data: {
            status: PartsCheckoutStatus.INVOICED,
            invoiceId: inv.id,
            invoicedAt: new Date(),
          },
        });

        return { invoiceId: inv.id, createdLines: linesToCreate.length };
      });

      results.push({
        storeId: store.storeId,
        storeName: store.storeName,
        invoiceId: created.invoiceId,
        createdLines: created.createdLines,
      });
    } catch (e: unknown) {
      results.push({
        storeId: store.storeId,
        storeName: store.storeName,
        reason: e instanceof Error ? e.message : "Failed to create invoice for store.",
      });
    }
  }

  return { vendor, periodStart, periodEnd, invoiceDate, results };
}