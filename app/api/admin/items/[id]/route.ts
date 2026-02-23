// app/api/admin/items/[id]/route.ts
import type { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";
import { Prisma, Role } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

export const dynamic = "force-dynamic";

const V_SUCCESS = "SUCCESS_PLUS" as const;
const V_AMERICAN = "AMERICAN_PLUS" as const;
type ItemVendor = typeof V_SUCCESS | typeof V_AMERICAN;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function getUserRole(session: Session | null): Role | null {
  const u = session?.user as unknown;
  if (!u || typeof u !== "object") return null;
  const role = (u as { role?: unknown }).role;
  return typeof role === "string" && (role === Role.ADMIN || role === Role.EMPLOYEE || role === Role.MANAGER)
    ? (role as Role)
    : null;
}

function parseMoneyToDecimal(input: unknown): Decimal | null {
  if (input === null || input === undefined) return null;

  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return new Decimal(String(input));
  }

  const s = String(input).trim();
  if (!s) return null;

  const cleaned = s.replace(/\$/g, "").replace(/,/g, "").trim();
  if (!cleaned) return null;

  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;

  return new Decimal(cleaned);
}

function parseBoolStrict(input: unknown): boolean | null {
  if (typeof input === "boolean") return input;
  if (input === null || input === undefined) return null;

  const s = String(input).trim().toLowerCase();
  if (["true", "t", "yes", "y", "1", "on"].includes(s)) return true;
  if (["false", "f", "no", "n", "0", "off"].includes(s)) return false;
  return null;
}

function parseVendorStrict(input: unknown): ItemVendor | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().toUpperCase();
  if (s === V_SUCCESS) return V_SUCCESS;
  if (s === V_AMERICAN) return V_AMERICAN;
  return null;
}

function parseNullableTrimmedString(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  return s ? s : null;
}

function safeUrl(raw: string | null): string | null {
  const v = (raw || "").trim();
  if (!v) return null;

  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/].*)?$/i.test(v)) return `https://${v}`;
  return null;
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof (error as any).message === "string") {
    return String((error as any).message);
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function isMissingCostPlusFormulaFieldError(error: unknown): boolean {
  const msg = getErrorMessage(error);
  const lower = msg.toLowerCase();
  return (
    msg.includes("Unknown argument `costPlusFormula`") ||
    msg.includes("Unknown field `costPlusFormula`") ||
    (lower.includes("costplusformula") && (lower.includes("does not exist") || lower.includes("unknown column")))
  );
}

/**
 * Safe server-side evaluator for formulas like:
 *   "cost * 1.10"
 *   "(cost * 1.08) + 2"
 * Allowed:
 *  - numbers
 *  - operators: + - * /
 *  - parentheses
 *  - identifier: cost
 * No eval / no Function().
 */
type Tok =
  | { t: "num"; v: number }
  | { t: "var" }
  | { t: "op"; v: "+" | "-" | "*" | "/" }
  | { t: "lp" }
  | { t: "rp" };

function isDigit(ch: string) {
  return ch >= "0" && ch <= "9";
}

function tokenizeFormula(input: string): Tok[] {
  const s = String(input ?? "").trim();
  if (!s) throw new Error("Cost-plus formula is empty.");

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

    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
      const raw = s.slice(i, j).toLowerCase();
      if (raw !== "cost") {
        throw new Error(`Unknown identifier "${raw}". Only "cost" is allowed.`);
      }
      out.push({ t: "var" });
      i = j;
      continue;
    }

    throw new Error(`Invalid character "${c}" in cost-plus formula.`);
  }

  return out;
}

// Convert unary "-X" into "0 - X"
function normalizeUnary(tokens: Tok[]): Tok[] {
  const out: Tok[] = [];

  for (const tok of tokens) {
    if (tok.t === "op" && tok.v === "-") {
      const prev = out[out.length - 1];
      const isUnary = !prev || prev.t === "op" || prev.t === "lp";
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

function toRpn(tokens: Tok[]): Tok[] {
  const out: Tok[] = [];
  const stack: Tok[] = [];

  for (const tok of tokens) {
    if (tok.t === "num" || tok.t === "var") {
      out.push(tok);
      continue;
    }

    if (tok.t === "op") {
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.t === "op" && prec(top.v) >= prec(tok.v)) out.push(stack.pop()!);
        else break;
      }
      stack.push(tok);
      continue;
    }

    if (tok.t === "lp") {
      stack.push(tok);
      continue;
    }

    if (tok.t === "rp") {
      let matched = false;
      while (stack.length) {
        const top = stack.pop()!;
        if (top.t === "lp") {
          matched = true;
          break;
        }
        out.push(top);
      }
      if (!matched) throw new Error("Mismatched parentheses in cost-plus formula.");
      continue;
    }
  }

  while (stack.length) {
    const top = stack.pop()!;
    if (top.t === "lp" || top.t === "rp") throw new Error("Mismatched parentheses in cost-plus formula.");
    out.push(top);
  }

  return out;
}

function evalRpn(rpn: Tok[], cost: number): number {
  const st: number[] = [];

  for (const tok of rpn) {
    if (tok.t === "num") {
      st.push(tok.v);
      continue;
    }
    if (tok.t === "var") {
      st.push(cost);
      continue;
    }
    if (tok.t === "op") {
      const b = st.pop();
      const a = st.pop();
      if (a === undefined || b === undefined) throw new Error("Invalid cost-plus formula.");

      let r = 0;
      if (tok.v === "+") r = a + b;
      else if (tok.v === "-") r = a - b;
      else if (tok.v === "*") r = a * b;
      else {
        if (b === 0) throw new Error("Division by zero in cost-plus formula.");
        r = a / b;
      }

      if (!Number.isFinite(r)) throw new Error("Cost-plus formula result is not finite.");
      st.push(r);
      continue;
    }

    throw new Error("Invalid token in cost-plus evaluation.");
  }

  if (st.length !== 1) throw new Error("Invalid cost-plus formula.");
  return st[0];
}

function evaluateCostPlusFormula(formula: string, cost: number): number {
  if (!Number.isFinite(cost) || cost < 0) throw new Error("Cost must be a valid non-negative number.");
  const tokens = normalizeUnary(tokenizeFormula(formula));
  const rpn = toRpn(tokens);
  const result = evalRpn(rpn, cost);
  return Number(result.toFixed(4));
}

function toNumberMaybeDecimal(d: unknown): number | null {
  if (d === null || d === undefined) return null;
  if (typeof d === "number") return Number.isFinite(d) ? d : null;
  try {
    const s = String((d as any).toString?.() ?? d).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (getUserRole(session) !== Role.ADMIN) return json({ error: "Forbidden" }, 403);

  const params = await ctx.params;
  const id = asNonEmptyString(params?.id);
  if (!id) return json({ error: "Missing id." }, 400);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!isRecord(raw)) return json({ error: "Invalid JSON body." }, 400);
  const body = raw;

  const data: Prisma.ItemUpdateInput = {};

  if (body.sku !== undefined) {
    const v = String(body.sku).trim();
    if (!v) return json({ error: "SKU is required." }, 400);
    data.sku = v;
  }

  if (body.partNumber !== undefined) {
    data.partNumber = body.partNumber ? String(body.partNumber).trim() : null;
  }

  if (body.vendor !== undefined) {
    const v = parseVendorStrict(body.vendor);
    if (v === null) return json({ error: "Invalid vendor." }, 400);
    // Prisma will accept enum-as-string if your schema vendor is an enum with same labels.
    (data as any).vendor = v;
  }

  if (body.name !== undefined) {
    const v = String(body.name).trim();
    if (!v) return json({ error: "Name is required." }, 400);
    data.name = v;
  }

  if (body.description !== undefined) {
    data.description = body.description ? String(body.description).trim() : null;
  }

  if (body.category !== undefined) {
    data.category = body.category ? String(body.category).trim() : null;
  }

  if (body.manufacturer !== undefined) {
    data.manufacturer = parseNullableTrimmedString(body.manufacturer);
  }

  if (body.orderFrom !== undefined) {
    data.orderFrom = parseNullableTrimmedString(body.orderFrom);
  }

  if (body.webUrl !== undefined) {
    const rawWeb = parseNullableTrimmedString(body.webUrl);
    if (rawWeb) {
      const normalized = safeUrl(rawWeb);
      if (!normalized) return json({ error: "Invalid URL (use https://… or a domain like example.com)." }, 400);
      data.webUrl = normalized;
    } else {
      data.webUrl = null;
    }
  }

  const requestedCostPlusFormula =
    body.costPlusFormula !== undefined
      ? (typeof body.costPlusFormula === "string"
          ? body.costPlusFormula.trim()
          : String(body.costPlusFormula ?? "").trim())
      : undefined;

  if (body.cost !== undefined) {
    if (body.cost === null) data.cost = null;
    else {
      const d = parseMoneyToDecimal(body.cost);
      if (d === null) return json({ error: "Invalid cost." }, 400);
      data.cost = d;
    }
  }

  if (body.price !== undefined) {
    if (body.price === null) data.price = null;
    else {
      const d = parseMoneyToDecimal(body.price);
      if (d === null) return json({ error: "Invalid price." }, 400);
      data.price = d;
    }
  }

  if (body.taxable !== undefined) {
    const b = parseBoolStrict(body.taxable);
    if (b === null) return json({ error: "Invalid taxable." }, 400);
    data.taxable = b;
  }

  if (body.active !== undefined) {
    const b = parseBoolStrict(body.active);
    if (b === null) return json({ error: "Invalid active." }, 400);
    data.active = b;
  }

  const wantCostPlus = requestedCostPlusFormula !== undefined && requestedCostPlusFormula.length > 0;

  if (Object.keys(data).length === 0 && requestedCostPlusFormula === undefined) {
    return json({ error: "No fields to update." }, 400);
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.item.findUnique({
        where: { id },
        select: {
          id: true,
          sku: true,
          partNumber: true,
          vendor: true,
          name: true,
          description: true,
          category: true,
          cost: true,
          price: true,
          taxable: true,
          active: true,

          manufacturer: true,
          orderFrom: true,
          webUrl: true,

          onHandQty: true,
          orderedQty: true,
          usedQty: true,
          minQty: true,

          createdAt: true,
          updatedAt: true,
        } as any,
      });

      if (!current) return null;

      const effectiveVendor = ((data as any).vendor ?? (current as any).vendor) as string;

      const dataAny: any = { ...data };

      if (requestedCostPlusFormula !== undefined) {
        dataAny.costPlusFormula = requestedCostPlusFormula.length ? requestedCostPlusFormula : null;
      }

      if (wantCostPlus && (effectiveVendor === V_SUCCESS || effectiveVendor === V_AMERICAN)) {
        const effectiveCostDecimal = (data as any).cost !== undefined ? (data as any).cost : (current as any).cost;
        const costNum = toNumberMaybeDecimal(effectiveCostDecimal);

        if (costNum === null) {
          throw new Error("Cost-plus formula provided but cost is empty/invalid.");
        }

        const computed = evaluateCostPlusFormula(requestedCostPlusFormula!, costNum);
        dataAny.price = new Decimal(String(computed));
      }

      const agg = await tx.itemVersion.aggregate({
        where: { itemId: id },
        _max: { version: true },
      });
      const nextVersion = (agg._max.version ?? 0) + 1;

      await tx.itemVersion.create({
        data: {
          itemId: id,
          version: nextVersion,

          sku: current.sku,
          partNumber: current.partNumber,
          vendor: (current as any).vendor,
          name: current.name,
          description: current.description,
          category: current.category,
          cost: current.cost,
          price: current.price,
          taxable: current.taxable,
          active: current.active,

          manufacturer: current.manufacturer,
          orderFrom: current.orderFrom,
          webUrl: current.webUrl,

          onHandQty: current.onHandQty,
          orderedQty: current.orderedQty,
          usedQty: current.usedQty,
          minQty: current.minQty,
        },
      });

      try {
        const u = await (tx.item as any).update({
          where: { id },
          data: dataAny,
          select: {
            id: true,
            sku: true,
            partNumber: true,
            vendor: true,
            name: true,
            description: true,
            category: true,
            cost: true,
            price: true,
            taxable: true,
            active: true,

            manufacturer: true,
            orderFrom: true,
            webUrl: true,

            createdAt: true,
            updatedAt: true,

            costPlusFormula: true,
          },
        });

        return u;
      } catch (e) {
        if (!isMissingCostPlusFormulaFieldError(e)) throw e;

        const retryData: any = { ...dataAny };
        delete retryData.costPlusFormula;

        const u = await (tx.item as any).update({
          where: { id },
          data: retryData,
          select: {
            id: true,
            sku: true,
            partNumber: true,
            vendor: true,
            name: true,
            description: true,
            category: true,
            cost: true,
            price: true,
            taxable: true,
            active: true,

            manufacturer: true,
            orderFrom: true,
            webUrl: true,

            createdAt: true,
            updatedAt: true,
          },
        });

        return u;
      }
    });

    if (!updated) return json({ error: "Item not found." }, 404);

    return json(
      {
        id: updated.id,
        sku: updated.sku,
        partNumber: updated.partNumber,
        vendor: (updated as any).vendor ?? null,
        name: updated.name,
        description: updated.description,
        category: updated.category,
        cost: updated.cost == null ? null : updated.cost.toString(),
        price: updated.price == null ? null : updated.price.toString(),
        taxable: updated.taxable,
        active: updated.active,

        manufacturer: updated.manufacturer,
        orderFrom: updated.orderFrom,
        webUrl: updated.webUrl,

        costPlusFormula: (updated as any).costPlusFormula ?? null,

        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
      200
    );
  } catch (e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return json({ error: "SKU already exists." }, 409);
    }

    if (e instanceof Error && e.message) {
      const msg = e.message.trim();
      if (msg.toLowerCase().includes("cost-plus") || msg.toLowerCase().includes("formula")) {
        return json({ error: msg }, 400);
      }
    }

    return json({ error: "Update failed." }, 500);
  }
}