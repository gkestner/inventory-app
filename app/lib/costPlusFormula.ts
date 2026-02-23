// app/lib/costPlusFormula.ts

type Token =
  | { t: "num"; v: number }
  | { t: "var"; v: "cost" }
  | { t: "op"; v: "+" | "-" | "*" | "/" }
  | { t: "lp" }
  | { t: "rp" };

function isDigit(ch: string) {
  return ch >= "0" && ch <= "9";
}

function tokenize(input: string): Token[] {
  const s = String(input ?? "").trim();
  if (!s) throw new Error("Formula is empty.");

  const tokens: Token[] = [];
  let i = 0;

  while (i < s.length) {
    const c = s[i];

    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }

    if (c === "(") {
      tokens.push({ t: "lp" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ t: "rp" });
      i++;
      continue;
    }

    if (c === "+" || c === "-" || c === "*" || c === "/") {
      tokens.push({ t: "op", v: c });
      i++;
      continue;
    }

    // number: 123, 123.45, .45
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
      tokens.push({ t: "num", v: n });
      i = j;
      continue;
    }

    // variable: cost
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
      const raw = s.slice(i, j).toLowerCase();

      if (raw !== "cost") {
        throw new Error(`Unknown identifier "${raw}". Only "cost" is allowed.`);
      }

      tokens.push({ t: "var", v: "cost" });
      i = j;
      continue;
    }

    throw new Error(`Invalid character "${c}" in formula.`);
  }

  return tokens;
}

// Insert explicit unary handling by converting leading "-" into "0 - ..."
function normalizeUnary(tokens: Token[]): Token[] {
  const out: Token[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.t === "op" && tok.v === "-") {
      const prev = out[out.length - 1];

      const isUnary =
        !prev || prev.t === "op" || prev.t === "lp";

      if (isUnary) {
        // transform "-X" into "0 - X"
        out.push({ t: "num", v: 0 });
        out.push({ t: "op", v: "-" });
        continue;
      }
    }

    out.push(tok);
  }

  return out;
}

function precedence(op: "+" | "-" | "*" | "/") {
  return op === "*" || op === "/" ? 2 : 1;
}

function toRpn(tokens: Token[]): Token[] {
  const out: Token[] = [];
  const stack: Token[] = [];

  for (const tok of tokens) {
    if (tok.t === "num" || tok.t === "var") {
      out.push(tok);
      continue;
    }

    if (tok.t === "op") {
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.t === "op" && precedence(top.v) >= precedence(tok.v)) {
          out.push(stack.pop()!);
          continue;
        }
        break;
      }
      stack.push(tok);
      continue;
    }

    if (tok.t === "lp") {
      stack.push(tok);
      continue;
    }

    if (tok.t === "rp") {
      let foundLp = false;
      while (stack.length > 0) {
        const top = stack.pop()!;
        if (top.t === "lp") {
          foundLp = true;
          break;
        }
        out.push(top);
      }
      if (!foundLp) throw new Error("Mismatched parentheses.");
      continue;
    }
  }

  while (stack.length > 0) {
    const top = stack.pop()!;
    if (top.t === "lp" || top.t === "rp") throw new Error("Mismatched parentheses.");
    out.push(top);
  }

  return out;
}

function evalRpn(rpn: Token[], vars: { cost: number }): number {
  const st: number[] = [];

  for (const tok of rpn) {
    if (tok.t === "num") {
      st.push(tok.v);
      continue;
    }
    if (tok.t === "var") {
      st.push(vars.cost);
      continue;
    }
    if (tok.t === "op") {
      const b = st.pop();
      const a = st.pop();
      if (a === undefined || b === undefined) throw new Error("Invalid expression.");

      let r: number;
      switch (tok.v) {
        case "+":
          r = a + b;
          break;
        case "-":
          r = a - b;
          break;
        case "*":
          r = a * b;
          break;
        case "/":
          if (b === 0) throw new Error("Division by zero.");
          r = a / b;
          break;
        default:
          throw new Error("Invalid operator.");
      }

      if (!Number.isFinite(r)) throw new Error("Formula result is not finite.");
      st.push(r);
      continue;
    }

    throw new Error("Invalid token in RPN.");
  }

  if (st.length !== 1) throw new Error("Invalid expression.");
  return st[0];
}

/**
 * Evaluate a cost-plus formula like:
 * - "cost * 1.10"
 * - "(cost * 1.08) + 2"
 * Only allowed identifier: "cost"
 */
export function evaluateCostPlusFormula(formula: string, cost: number): number {
  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error("Cost must be a valid non-negative number.");
  }

  const tokens = normalizeUnary(tokenize(formula));
  const rpn = toRpn(tokens);
  const result = evalRpn(rpn, { cost });

  // Keep sane precision; DB can store as Decimal/number-string
  return Number(result.toFixed(4));
}