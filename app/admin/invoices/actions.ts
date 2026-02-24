// app/admin/invoices/actions.ts
"use server";

import { prisma } from "@/app/lib/prisma";
import { InvoiceVendor, PartsCheckoutStatus } from "@prisma/client";

/**
 * Safe expression evaluator:
 * - supports numbers, + - * /, parentheses
 * - supports variables (whitelisted per evaluator)
 * - supports helpers: min,max,round,floor,ceil,abs
 * - NO property access, NO strings, NO arbitrary identifiers
 */

type Op = "+" | "-" | "*" | "/";

type Tok =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: Op }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" };

function isDigit(ch: string) {
  return ch >= "0" && ch <= "9";
}
function isAlpha(ch: string) {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}
function isAlphaNum(ch: string) {
  return isAlpha(ch) || isDigit(ch);
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
        if (j >= s.length || !isDigit(s[j])) {
          throw new Error(`Invalid number near "." at position ${i + 1}.`);
        }
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
      out.push({ t: "id", v: raw });
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

function prec(op: Op) {
  return op === "*" || op === "/" ? 2 : 1;
}

type Rpn =
  | { t: "num"; v: number }
  | { t: "var"; v: string }
  | { t: "op"; v: Op }
  | { t: "fn"; v: string; argc: number };

const HELPERS = new Set(["min", "max", "round", "floor", "ceil", "abs"]);

function toRpn(tokens: Tok[], allowedVars: Set<string>): Rpn[] {
  const out: Rpn[] = [];
  const stack: Array<
    | { k: "op"; v: Op }
    | { k: "lp" }
    | { k: "fn"; name: string; argc: number; seenArg: boolean }
  > = [];

  const peekTok = (idx: number) => (idx >= 0 && idx < tokens.length ? tokens[idx] : null);

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.t === "num") {
      out.push({ t: "num", v: tok.v });
      const top = stack[stack.length - 1];
      if (top?.k === "fn") top.seenArg = true;
      continue;
    }

    if (tok.t === "id") {
      const next = peekTok(i + 1);
      const name = tok.v;

      if (next?.t === "lp") {
        const lname = name.toLowerCase();
        if (!HELPERS.has(lname)) {
          throw new Error(`Unknown function "${name}". Allowed: ${Array.from(HELPERS).join(", ")}`);
        }
        stack.push({ k: "fn", name: lname, argc: 0, seenArg: false });
        continue;
      }

      const vname = name;
      if (!allowedVars.has(vname)) {
        throw new Error(`Unknown identifier "${vname}".`);
      }
      out.push({ t: "var", v: vname });
      const top = stack[stack.length - 1];
      if (top?.k === "fn") top.seenArg = true;
      continue;
    }

    if (tok.t === "lp") {
      stack.push({ k: "lp" });
      continue;
    }

    if (tok.t === "comma") {
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.k === "lp") break;
        if (top.k === "op") {
          out.push({ t: "op", v: top.v });
          stack.pop();
          continue;
        }
        break;
      }
      for (let j = stack.length - 1; j >= 0; j--) {
        const x = stack[j];
        if (x.k === "fn") {
          x.argc += 1;
          x.seenArg = false;
          break;
        }
      }
      continue;
    }

    if (tok.t === "op") {
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.k === "op" && prec(top.v) >= prec(tok.v)) {
          out.push({ t: "op", v: top.v });
          stack.pop();
          continue;
        }
        break;
      }
      stack.push({ k: "op", v: tok.v });
      continue;
    }

    if (tok.t === "rp") {
      let matched = false;
      while (stack.length) {
        const top = stack.pop()!;
        if (top.k === "lp") {
          matched = true;
          break;
        }
        if (top.k === "op") out.push({ t: "op", v: top.v });
      }
      if (!matched) throw new Error("Mismatched parentheses.");

      const fnTop = stack[stack.length - 1];
      if (fnTop?.k === "fn") {
        const argc = fnTop.argc + (fnTop.seenArg ? 1 : 0);
        if (argc <= 0) throw new Error(`Function "${fnTop.name}" requires arguments.`);
        out.push({ t: "fn", v: fnTop.name, argc });
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent?.k === "fn") parent.seenArg = true;
      }

      continue;
    }
  }

  while (stack.length) {
    const top = stack.pop()!;
    if (top.k === "lp") throw new Error("Mismatched parentheses.");
    if (top.k === "op") out.push({ t: "op", v: top.v });
    else throw new Error("Invalid formula.");
  }

  return out;
}

function evalRpn(rpn: Rpn[], vars: Record<string, number>): number {
  const st: number[] = [];

  const popN = () => {
    const v = st.pop();
    if (v === undefined) throw new Error("Invalid formula.");
    return v;
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
      const b = popN();
      const a = popN();
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
      const argc = tok.argc;

      const args: number[] = [];
      for (let i = 0; i < argc; i++) args.push(popN());
      args.reverse();

      const name = tok.v;
      let r = 0;

      if (name === "min") r = Math.min(...args);
      else if (name === "max") r = Math.max(...args);
      else if (name === "abs") {
        if (args.length !== 1) throw new Error("abs(x) expects 1 argument.");
        r = Math.abs(args[0]);
      } else if (name === "round") {
        if (args.length === 1) r = Math.round(args[0]);
        else if (args.length === 2) {
          const [x, d] = args;
          const p = Math.pow(10, d);
          r = Math.round(x * p) / p;
        } else throw new Error("round(x) or round(x, decimals).");
      } else if (name === "floor") {
        if (args.length !== 1) throw new Error("floor(x) expects 1 argument.");
        r = Math.floor(args[0]);
      } else if (name === "ceil") {
        if (args.length !== 1) throw new Error("ceil(x) expects 1 argument.");
        r = Math.ceil(args[0]);
      } else {
        throw new Error(`Unknown function "${name}".`);
      }

      if (!Number.isFinite(r)) throw new Error("Formula result is not finite.");
      st.push(r);
      continue;
    }
    throw new Error("Invalid token.");
  }

  if (st.length !== 1) throw new Error("Invalid formula.");
  return st[0];
}

function evaluateExpression(formula: string, allowedVars: Set<string>, vars: Record<string, number>) {
  const tokens = normalizeUnary(tokenize(formula));
  const rpn = toRpn(tokens, allowedVars);
  const result = evalRpn(rpn, vars);
  return Number(result.toFixed(6));
}

// -----------------------------
// Public helpers used by invoice creation
// -----------------------------

export function evaluatePartsPriceFormula(formula: string, input: { cost: number; partsUpchargePct: number }): number {
  const { cost, partsUpchargePct } = input;
  if (!Number.isFinite(cost) || cost < 0) throw new Error("Cost must be a valid non-negative number.");
  if (!Number.isFinite(partsUpchargePct) || partsUpchargePct < 0)
    throw new Error("partsUpchargePct must be non-negative.");

  return evaluateExpression(formula, new Set(["cost", "partsUpchargePct"]), { cost, partsUpchargePct });
}

export function evaluateTaxFormula(
  formula: string,
  input: { lineSubtotal: number; taxRatePct: number; quantity: number; unitPrice: number }
): number {
  const { lineSubtotal, taxRatePct, quantity, unitPrice } = input;

  for (const [k, v] of Object.entries({ lineSubtotal, taxRatePct, quantity, unitPrice })) {
    if (!Number.isFinite(v)) throw new Error(`${k} must be a valid number.`);
  }

  return evaluateExpression(
    formula,
    new Set(["lineSubtotal", "taxRatePct", "quantity", "unitPrice"]),
    { lineSubtotal, taxRatePct, quantity, unitPrice }
  );
}

// -----------------------------
// Vendor config loader (safe for older schema)
// -----------------------------

const DEFAULTS = {
  taxRatePct: 0,
  taxFormula: "lineSubtotal * (taxRatePct / 100)",
  partsUpchargePct: 0,
  partsPriceFormula: "cost * (1 + (partsUpchargePct / 100))",
};

export async function loadVendorPricingAndTaxConfig(vendor: InvoiceVendor): Promise<{
  vendor: InvoiceVendor;
  taxRatePct: number;
  taxFormula: string;
  partsUpchargePct: number;
  partsPriceFormula: string;
}> {
  try {
    const row = await (prisma as any).invoiceVendorConfig.findUnique({
      where: { vendor },
      select: {
        vendor: true,
        taxRatePct: true,
        taxFormula: true,
        partsUpchargePct: true,
        partsPriceFormula: true,
      },
    });

    if (!row) return { vendor, ...DEFAULTS };

    return {
      vendor,
      taxRatePct: Number(row.taxRatePct ?? DEFAULTS.taxRatePct),
      taxFormula: String(row.taxFormula || DEFAULTS.taxFormula),
      partsUpchargePct: Number(row.partsUpchargePct ?? DEFAULTS.partsUpchargePct),
      partsPriceFormula: String(row.partsPriceFormula || DEFAULTS.partsPriceFormula),
    };
  } catch {
    try {
      const row = await (prisma as any).invoiceVendorConfig.findUnique({
        where: { vendor },
        select: {
          vendor: true,
          taxRatePct: true,
          partsUpchargePct: true,
        },
      });

      if (!row) return { vendor, ...DEFAULTS };

      return {
        vendor,
        taxRatePct: Number(row.taxRatePct ?? DEFAULTS.taxRatePct),
        taxFormula: DEFAULTS.taxFormula,
        partsUpchargePct: Number(row.partsUpchargePct ?? DEFAULTS.partsUpchargePct),
        partsPriceFormula: DEFAULTS.partsPriceFormula,
      };
    } catch {
      return { vendor, ...DEFAULTS };
    }
  }
}

// -----------------------------
// Invoice generation
// -----------------------------

function round2(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function toNumberLoose(v: any): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function createInvoicesForWindow(args: {
  vendor: InvoiceVendor;
  periodStart: Date;
  periodEnd: Date;
  invoiceDate: Date;
}): Promise<{ results: Array<{ storeId: string; invoiceId?: string; created?: boolean; reason?: string }> }> {
  const vendor = args.vendor === "AMERICAN_PLUS" ? InvoiceVendor.AMERICAN_PLUS : InvoiceVendor.SUCCESS_PLUS;
  const periodStart = new Date(args.periodStart);
  const periodEnd = new Date(args.periodEnd);
  const invoiceDate = new Date(args.invoiceDate);

  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    throw new Error("Invalid periodStart/periodEnd");
  }
  if (Number.isNaN(invoiceDate.getTime())) {
    throw new Error("Invalid invoiceDate");
  }

  const cfg = await loadVendorPricingAndTaxConfig(vendor);

  // Pull OPEN tickets in window, matching vendor snapshot, not already invoiced/voided
  const tickets = await prisma.partsCheckoutTicket.findMany({
    where: {
      status: PartsCheckoutStatus.OPEN,
      invoicedAt: null,
      voidedAt: null,
      createdAt: { gte: periodStart, lte: periodEnd },
      vendorSnapshot: vendor,
    },
    select: {
      id: true,
      storeId: true,
      storeName: true,
      quantity: true,
      taxableSnapshot: true,
      costSnapshot: true,
      skuSnapshot: true,
      partNumberSnapshot: true,
      nameSnapshot: true,
      createdAt: true,
    },
    orderBy: [{ storeName: "asc" }, { createdAt: "asc" }],
    take: 20000,
  });

  if (tickets.length === 0) {
    return { results: [] };
  }

  // Group by storeId
  const byStore = new Map<string, typeof tickets>();
  for (const t of tickets) {
    const arr = byStore.get(t.storeId) ?? [];
    arr.push(t);
    byStore.set(t.storeId, arr);
  }

  const storeIds = Array.from(byStore.keys());

  const locations = await prisma.location.findMany({
    where: { id: { in: storeIds } },
    select: { id: true, name: true, locationNumber: true },
  });

  const locById = new Map(locations.map((l) => [l.id, l]));

  const results: Array<{ storeId: string; invoiceId?: string; created?: boolean; reason?: string }> = [];

  // Process each store in its own transaction (keeps failures isolated)
  for (const storeId of storeIds) {
    const storeTickets = byStore.get(storeId) ?? [];
    const loc = locById.get(storeId);

    if (!loc) {
      results.push({ storeId, created: false, reason: "Store not found" });
      continue;
    }

    const storeNumber = String(loc.locationNumber ?? "").trim();
    if (!storeNumber) {
      results.push({
        storeId,
        created: false,
        reason: `Missing store number for location "${loc.name}"`,
      });
      continue;
    }

    if (storeTickets.length === 0) {
      results.push({ storeId, created: false, reason: "No tickets" });
      continue;
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        // Re-read the same tickets inside the transaction to avoid racing with another generation run.
        const ids = storeTickets.map((t) => t.id);

        const fresh = await tx.partsCheckoutTicket.findMany({
          where: {
            id: { in: ids },
            status: PartsCheckoutStatus.OPEN,
            invoicedAt: null,
            voidedAt: null,
            vendorSnapshot: vendor,
          },
          select: {
            id: true,
            storeId: true,
            storeName: true,
            quantity: true,
            taxableSnapshot: true,
            costSnapshot: true,
            skuSnapshot: true,
            partNumberSnapshot: true,
            nameSnapshot: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: "asc" }],
        });

        if (fresh.length === 0) {
          return { invoiceId: undefined as string | undefined, created: false, reason: "No eligible tickets" };
        }

        // Build lines + totals
        const lineBuild = fresh.map((t) => {
          const cost = Math.max(0, toNumberLoose(t.costSnapshot));
          const qty = Math.max(0, Number(t.quantity || 0));

          const unitPriceRaw = evaluatePartsPriceFormula(cfg.partsPriceFormula, {
            cost,
            partsUpchargePct: cfg.partsUpchargePct,
          });

          const unitPrice = round2(unitPriceRaw);
          const lineSubtotal = round2(unitPrice * qty);

          const taxable = !!t.taxableSnapshot;
          const lineTax = taxable
            ? round2(
                evaluateTaxFormula(cfg.taxFormula, {
                  lineSubtotal,
                  taxRatePct: cfg.taxRatePct,
                  quantity: qty,
                  unitPrice,
                })
              )
            : 0;

          const lineTotal = round2(lineSubtotal + lineTax);

          return {
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
          };
        });

        const subtotal = round2(lineBuild.reduce((acc, l) => acc + l.lineSubtotal, 0));
        const taxTotal = round2(lineBuild.reduce((acc, l) => acc + l.lineTax, 0));
        const total = round2(subtotal + taxTotal);

        // Create invoice
        const invoice = await tx.invoice.create({
          data: {
            vendor,
            vendorNumber: "N/A",
            billedTo: `${storeNumber} ${loc.name}`,
            storeId,
            storeName: loc.name,
            storeNumber,
            periodStart,
            periodEnd,
            invoiceDate,
            subtotal,
            taxTotal,
            total,
            // createdByUserId is optional; handled elsewhere if you want to pass it in
          },
          select: { id: true },
        });

        // Create invoice lines
        await tx.invoiceLine.createMany({
          data: lineBuild.map((l) => ({
            invoiceId: invoice.id,
            checkoutId: l.checkoutId,
            submittedAt: l.submittedAt,
            sku: l.sku,
            partNumber: l.partNumber,
            name: l.name,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxable: l.taxable,
            lineSubtotal: l.lineSubtotal,
            lineTax: l.lineTax,
            lineTotal: l.lineTotal,
          })),
        });

        // Mark tickets invoiced + link invoice
        const now = new Date();
        await tx.partsCheckoutTicket.updateMany({
          where: { id: { in: lineBuild.map((l) => l.checkoutId) } },
          data: {
            status: PartsCheckoutStatus.INVOICED,
            invoiceId: invoice.id,
            invoicedAt: now,
          },
        });

        return { invoiceId: invoice.id, created: true, reason: undefined as string | undefined };
      });

      results.push({ storeId, invoiceId: created.invoiceId, created: created.created, reason: created.reason });
    } catch (e: any) {
      results.push({
        storeId,
        created: false,
        reason: e?.message ? String(e.message) : "Failed to create invoice",
      });
    }
  }

  return { results };
}