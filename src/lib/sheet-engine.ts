/**
 * The `sheet` block's calculation engine. PURE — no React, no DOM.
 *
 * A hand-written recursive-descent evaluator: twenty functions do not
 * justify a parser dependency, and hand-rolling keeps the error values
 * (#CYCLE, #NAME, #DIV/0, #NUM) ours to name.
 *
 * Grammar (comparison sits on top so IF() has something to test):
 *   expr    → cmp
 *   cmp     → sum (('='|'<>'|'<='|'>='|'<'|'>') sum)?
 *   sum     → term (('+'|'-') term)*
 *   term    → factor (('*'|'/') factor)*
 *   factor  → '-'? primary
 *   primary → number | string | ref | ref ':' ref
 *           | NAME '(' args ')' | '(' expr ')'
 *
 * References are A1 style with $ pinning either part: B2, $B$2, B$2, $B2.
 * Ranges are B2:D5.
 *
 * NOTHING IS CACHED. Every read of a formula cell re-evaluates it, because
 * a stored result is how a sheet ends up displaying a number that no longer
 * follows from its inputs.
 */
import type { Cell, CellFormat } from "./sheet-model";

export type SheetError = "#CYCLE" | "#NAME" | "#DIV/0" | "#NUM";
export type CellValue = number | string | boolean;
export type Grid = (Cell | null)[][];

const ERRORS: SheetError[] = ["#CYCLE", "#NAME", "#DIV/0", "#NUM"];

export function isSheetError(v: unknown): v is SheetError {
  return typeof v === "string" && (ERRORS as string[]).includes(v);
}

class EvalError extends Error {
  code: SheetError;
  constructor(code: SheetError) {
    super(code);
    this.code = code;
  }
}

/* ────────── A1 references ────────── */

/** 0 → "A", 25 → "Z". */
export function colName(index: number): string {
  let i = Math.max(0, Math.trunc(index));
  let out = "";
  do {
    out = String.fromCharCode(65 + (i % 26)) + out;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return out;
}

/** "A" → 0, "z" → 25, "AA" → 26. */
export function colIndex(name: string): number {
  let n = 0;
  const up = name.toUpperCase();
  for (let i = 0; i < up.length; i++) n = n * 26 + (up.charCodeAt(i) - 64);
  return n - 1;
}

export type Ref = { r: number; c: number; pinR: boolean; pinC: boolean };

const REF_RE = /^(\$?)([A-Za-z]{1,2})(\$?)(\d{1,3})$/;

/** Parse "B2" / "$B$2" / "B$2" / "$B2" into a zero-based Ref, or null. */
export function parseRef(text: string): Ref | null {
  const m = REF_RE.exec(text.trim());
  if (!m) return null;
  const c = colIndex(m[2]);
  const r = parseInt(m[4], 10) - 1;
  if (r < 0 || c < 0) return null;
  return { r, c, pinC: m[1] === "$", pinR: m[3] === "$" };
}

/* ────────── Tokenizer ────────── */

type Tok =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "ref"; v: string }
  | { k: "name"; v: string }
  | { k: "op"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== quote) {
        s += src[j];
        j++;
      }
      out.push({ k: "str", v: s });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push({ k: "num", v: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (ch === "$" || /[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$.]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if (parseRef(word)) out.push({ k: "ref", v: word });
      else out.push({ k: "name", v: word.toUpperCase() });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      out.push({ k: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/():,=<>%^".includes(ch)) {
      out.push({ k: "op", v: ch });
      i++;
      continue;
    }
    // Anything else is unrecognisable input, not a silent no-op.
    throw new EvalError("#NAME");
  }
  return out;
}

/* ────────── Values ────────── */

type RangeVal = { kind: "range"; r1: number; c1: number; r2: number; c2: number };
type Val = CellValue | RangeVal;

function isRange(v: Val): v is RangeVal {
  return typeof v === "object" && v !== null && (v as RangeVal).kind === "range";
}

function toNumber(v: Val): number {
  if (isRange(v)) throw new EvalError("#NUM");
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const t = v.trim();
  if (t === "") return 0;
  if (isSheetError(t)) throw new EvalError(t);
  const n = Number(t.replace(/,/g, ""));
  if (!Number.isFinite(n)) throw new EvalError("#NUM");
  return n;
}

function toText(v: Val): string {
  if (isRange(v)) throw new EvalError("#NUM");
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

function truthy(v: Val): boolean {
  if (isRange(v)) throw new EvalError("#NUM");
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const t = v.trim().toUpperCase();
  if (t === "" || t === "FALSE" || t === "0") return false;
  return true;
}

/* ────────── Cell reading ────────── */

function rawOf(grid: Grid, r: number, c: number): string | number | undefined {
  return grid[r]?.[c]?.v;
}

/** Evaluate the cell at (r, c) to a value, or an error string. */
export function evaluateCell(grid: Grid, r: number, c: number): CellValue | SheetError {
  try {
    return readCell(grid, r, c, new Set());
  } catch (e) {
    if (e instanceof EvalError) return e.code;
    throw e;
  }
}

/** Evaluate a raw entry (formula or literal) as if typed into (r, c). */
export function evaluateFormula(
  src: string,
  grid: Grid,
  r = 0,
  c = 0,
): CellValue | SheetError {
  try {
    const visited = new Set<string>([`${r}:${c}`]);
    return evalRaw(src, grid, visited);
  } catch (e) {
    if (e instanceof EvalError) return e.code;
    throw e;
  }
}

function evalRaw(src: string, grid: Grid, visited: Set<string>): CellValue {
  const text = src.trim();
  if (!text.startsWith("=")) return literal(text);
  const toks = tokenize(text.slice(1));
  const p = new Parser(toks, grid, visited);
  const v = p.parseExpr();
  p.expectEnd();
  if (isRange(v)) throw new EvalError("#NUM");
  return v;
}

function literal(text: string): CellValue {
  if (text === "") return "";
  const n = Number(text.replace(/,/g, ""));
  if (text !== "" && Number.isFinite(n) && /^[-+]?[\d,]*\.?\d+(e[-+]?\d+)?$/i.test(text))
    return n;
  return text;
}

function readCell(grid: Grid, r: number, c: number, visited: Set<string>): CellValue {
  const key = `${r}:${c}`;
  if (visited.has(key)) throw new EvalError("#CYCLE");
  const raw = rawOf(grid, r, c);
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "number") return raw;
  const text = raw.trim();
  if (!text.startsWith("=")) return literal(text);
  const next = new Set(visited);
  next.add(key);
  return evalRaw(text, grid, next);
}

/* ────────── Parser / evaluator ────────── */

class Parser {
  private i = 0;
  constructor(
    private toks: Tok[],
    private grid: Grid,
    private visited: Set<string>,
  ) {}

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }
  private eatOp(v: string): boolean {
    const t = this.peek();
    if (t && t.k === "op" && t.v === v) {
      this.i++;
      return true;
    }
    return false;
  }
  expectEnd(): void {
    if (this.i !== this.toks.length) throw new EvalError("#NAME");
  }

  parseExpr(): Val {
    return this.parseCmp();
  }

  private parseCmp(): Val {
    let left = this.parseSum();
    const t = this.peek();
    if (t && t.k === "op" && ["=", "<>", "<=", ">=", "<", ">"].includes(t.v)) {
      this.i++;
      const right = this.parseSum();
      const a = isRange(left) ? 0 : left;
      const b = isRange(right) ? 0 : right;
      const numeric = typeof a !== "string" || typeof b !== "string";
      const x = numeric ? toNumber(a) : String(a);
      const y = numeric ? toNumber(b) : String(b);
      switch (t.v) {
        case "=":
          return x === y;
        case "<>":
          return x !== y;
        case "<":
          return x < y;
        case ">":
          return x > y;
        case "<=":
          return x <= y;
        default:
          return x >= y;
      }
    }
    return left;
  }

  private parseSum(): Val {
    let left = this.parseTerm();
    for (;;) {
      if (this.eatOp("+")) left = toNumber(left) + toNumber(this.parseTerm());
      else if (this.eatOp("-")) left = toNumber(left) - toNumber(this.parseTerm());
      else return left;
    }
  }

  private parseTerm(): Val {
    let left = this.parseFactor();
    for (;;) {
      if (this.eatOp("*")) left = toNumber(left) * toNumber(this.parseFactor());
      else if (this.eatOp("/")) {
        const d = toNumber(this.parseFactor());
        if (d === 0) throw new EvalError("#DIV/0");
        left = toNumber(left) / d;
      } else return left;
    }
  }

  private parseFactor(): Val {
    if (this.eatOp("-")) return -toNumber(this.parseFactor());
    if (this.eatOp("+")) return toNumber(this.parseFactor());
    return this.parsePrimary();
  }

  private parsePrimary(): Val {
    const t = this.peek();
    if (!t) throw new EvalError("#NAME");
    if (t.k === "num") {
      this.i++;
      return t.v;
    }
    if (t.k === "str") {
      this.i++;
      return t.v;
    }
    if (t.k === "ref") {
      this.i++;
      const a = parseRef(t.v)!;
      if (this.eatOp(":")) {
        const nt = this.peek();
        if (!nt || nt.k !== "ref") throw new EvalError("#NAME");
        this.i++;
        const b = parseRef(nt.v)!;
        return {
          kind: "range",
          r1: Math.min(a.r, b.r),
          c1: Math.min(a.c, b.c),
          r2: Math.max(a.r, b.r),
          c2: Math.max(a.c, b.c),
        };
      }
      return readCell(this.grid, a.r, a.c, this.visited);
    }
    if (t.k === "op" && t.v === "(") {
      this.i++;
      const v = this.parseExpr();
      if (!this.eatOp(")")) throw new EvalError("#NAME");
      return v;
    }
    if (t.k === "name") {
      this.i++;
      if (!this.eatOp("(")) throw new EvalError("#NAME");
      const args: Val[] = [];
      if (!this.eatOp(")")) {
        for (;;) {
          args.push(this.parseExpr());
          if (this.eatOp(",")) continue;
          if (this.eatOp(")")) break;
          throw new EvalError("#NAME");
        }
      }
      return callFunction(t.v, args, this.grid, this.visited);
    }
    throw new EvalError("#NAME");
  }
}

/* ────────── The twenty functions ────────── */

function expand(v: Val, grid: Grid, visited: Set<string>): CellValue[] {
  if (!isRange(v)) return [v];
  const out: CellValue[] = [];
  for (let r = v.r1; r <= v.r2; r++)
    for (let c = v.c1; c <= v.c2; c++) out.push(readCell(grid, r, c, visited));
  return out;
}

/** Numbers only — blanks and text are ignored, so AVG over a partly-filled
 *  column divides by the cells that actually hold figures. */
function numbers(args: Val[], grid: Grid, visited: Set<string>): number[] {
  const out: number[] = [];
  for (const a of args)
    for (const v of expand(a, grid, visited)) {
      if (v === "" || v === null || v === undefined) continue;
      if (isSheetError(v)) throw new EvalError(v);
      if (typeof v === "number") out.push(v);
      else if (typeof v === "boolean") out.push(v ? 1 : 0);
      else {
        const n = Number(String(v).replace(/,/g, ""));
        if (Number.isFinite(n) && String(v).trim() !== "") out.push(n);
      }
    }
  return out;
}

function places(v: Val | undefined): number {
  if (v === undefined) return 0;
  return Math.trunc(toNumber(v));
}

function factor(p: number): number {
  return Math.pow(10, p);
}

/**
 * signature + description + implementation, in ONE table.
 *
 * The autocomplete panel and the argument chip RENDER FROM THIS TABLE
 * (see FUNCTION_META below). A second list typed into a component would
 * drift from this one and offer a function the engine does not have.
 */
const FUNCTIONS: Record<
  string,
  {
    sig: string;
    desc: string;
    run: (args: Val[], grid: Grid, visited: Set<string>) => CellValue;
  }
> = {
  SUM: {
    sig: "SUM(range)",
    desc: "Adds every number in the range",
    run: (a, g, v) => numbers(a, g, v).reduce((s, n) => s + n, 0),
  },
  AVG: {
    sig: "AVG(range)",
    desc: "Mean of the numbers in the range",
    run: (a, g, v) => {
      const ns = numbers(a, g, v);
      if (!ns.length) throw new EvalError("#DIV/0");
      return ns.reduce((s, n) => s + n, 0) / ns.length;
    },
  },
  MIN: {
    sig: "MIN(range)",
    desc: "Smallest number in the range",
    run: (a, g, v) => {
      const ns = numbers(a, g, v);
      if (!ns.length) return 0;
      return Math.min(...ns);
    },
  },
  MAX: {
    sig: "MAX(range)",
    desc: "Largest number in the range",
    run: (a, g, v) => {
      const ns = numbers(a, g, v);
      if (!ns.length) return 0;
      return Math.max(...ns);
    },
  },
  COUNT: {
    sig: "COUNT(range)",
    desc: "How many cells hold a number",
    run: (a, g, v) => numbers(a, g, v).length,
  },
  MEDIAN: {
    sig: "MEDIAN(range)",
    desc: "Middle value of the numbers",
    run: (a, g, v) => {
      const ns = numbers(a, g, v).sort((x, y) => x - y);
      if (!ns.length) throw new EvalError("#NUM");
      const mid = ns.length >> 1;
      return ns.length % 2 ? ns[mid] : (ns[mid - 1] + ns[mid]) / 2;
    },
  },
  PRODUCT: {
    sig: "PRODUCT(range)",
    desc: "Multiplies every number in the range",
    run: (a, g, v) => {
      const ns = numbers(a, g, v);
      if (!ns.length) return 0;
      return ns.reduce((p, n) => p * n, 1);
    },
  },
  ADD: { sig: "ADD(a,b)", desc: "a plus b", run: (a) => toNumber(a[0]) + toNumber(a[1]) },
  MINUS: {
    sig: "MINUS(a,b)",
    desc: "a minus b",
    run: (a) => toNumber(a[0]) - toNumber(a[1]),
  },
  MULTIPLY: {
    sig: "MULTIPLY(a,b)",
    desc: "a times b",
    run: (a) => toNumber(a[0]) * toNumber(a[1]),
  },
  DIVIDE: {
    sig: "DIVIDE(a,b)",
    desc: "a divided by b",
    run: (a) => {
      const d = toNumber(a[1]);
      if (d === 0) throw new EvalError("#DIV/0");
      return toNumber(a[0]) / d;
    },
  },
  POWER: {
    sig: "POWER(base,exp)",
    desc: "base raised to exp",
    run: (a) => {
      const n = Math.pow(toNumber(a[0]), toNumber(a[1]));
      if (!Number.isFinite(n)) throw new EvalError("#NUM");
      return n;
    },
  },
  SQRT: {
    sig: "SQRT(n)",
    desc: "Square root of n",
    run: (a) => {
      const n = toNumber(a[0]);
      if (n < 0) throw new EvalError("#NUM");
      return Math.sqrt(n);
    },
  },
  ROUND: {
    sig: "ROUND(n,places)",
    desc: "Rounds n to that many decimals",
    run: (a) => {
      const p = factor(places(a[1]));
      return Math.round(toNumber(a[0]) * p) / p;
    },
  },
  ROUNDUP: {
    sig: "ROUNDUP(n,places)",
    desc: "Rounds n away from zero",
    run: (a) => {
      const p = factor(places(a[1]));
      const n = toNumber(a[0]) * p;
      return (n < 0 ? -Math.ceil(-n) : Math.ceil(n)) / p;
    },
  },
  ROUNDDOWN: {
    sig: "ROUNDDOWN(n,places)",
    desc: "Rounds n towards zero",
    run: (a) => {
      const p = factor(places(a[1]));
      const n = toNumber(a[0]) * p;
      return (n < 0 ? -Math.floor(-n) : Math.floor(n)) / p;
    },
  },
  ABS: { sig: "ABS(n)", desc: "n without its sign", run: (a) => Math.abs(toNumber(a[0])) },
  IF: {
    sig: "IF(test,then,else)",
    desc: "then when the test holds, else when it does not",
    run: (a) => {
      const branch = truthy(a[0]) ? a[1] : a[2];
      if (branch === undefined) return "";
      if (isRange(branch)) throw new EvalError("#NUM");
      return branch;
    },
  },
  CONCAT: {
    sig: "CONCAT(text…)",
    desc: "Joins the values into one string",
    run: (a, g, v) =>
      a
        .flatMap((x) => expand(x, g, v))
        .map((x) => (x === "" ? "" : toText(x)))
        .join(""),
  },
  TODAY: { sig: "TODAY()", desc: "Today's date", run: () => todayISO() },
};

/** Function signatures, for a future formula hint UI. */
export const FUNCTION_SIGNATURES: string[] = Object.values(FUNCTIONS).map((f) => f.sig);

export type FunctionMeta = {
  /** "SUM" */
  name: string;
  /** "(range)" — including the parens, so "()" marks a no-argument call. */
  args: string;
  /** "SUM(range)" — what the argument chip shows. */
  sig: string;
  desc: string;
};

/**
 * THE one list the autocomplete panel renders from. Derived from
 * FUNCTIONS above, so a function cannot be offered unless the engine
 * implements it and its arguments cannot drift from its signature.
 */
export const FUNCTION_META: FunctionMeta[] = Object.entries(FUNCTIONS).map(([name, f]) => ({
  name,
  args: f.sig.slice(name.length),
  sig: f.sig,
  desc: f.desc,
}));

export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function callFunction(
  name: string,
  args: Val[],
  grid: Grid,
  visited: Set<string>,
): CellValue {
  const fn = FUNCTIONS[name];
  if (!fn) throw new EvalError("#NAME");
  return fn.run(args, grid, visited);
}

/* ────────── shiftFormula ────────── */

/**
 * Rewrite every UNPINNED half of every reference in `src` by (dr, dc),
 * leaving $-pinned halves alone. ONE function, shared by fill-down and
 * paste — a second copy would drift.
 */
export function shiftFormula(src: string, dr: number, dc: number): string {
  if (!src.startsWith("=")) return src;
  // Split on string literals so "B2" inside text is never rewritten.
  const parts = src.split(/("(?:[^"]*)"|'(?:[^']*)')/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // a quoted literal
      return part.replace(
        /(\$?)([A-Za-z]{1,2})(\$?)(\d{1,3})/g,
        (whole, pc: string, col: string, pr: string, row: string, offset: number) => {
          const before = part[offset - 1] ?? "";
          const after = part[offset + whole.length] ?? "";
          // A name followed by '(' is a function, not a reference.
          if (/[A-Za-z0-9_$]/.test(before) || after === "(") return whole;
          const ci = colIndex(col);
          const ri = parseInt(row, 10) - 1;
          if (ci < 0 || ri < 0) return whole;
          const nc = pc === "$" ? ci : ci + dc;
          const nr = pr === "$" ? ri : ri + dr;
          if (nc < 0 || nr < 0) return whole;
          return `${pc}${colName(nc)}${pr}${nr + 1}`;
        },
      );
    })
    .join("");
}

/* ────────── Display formatting ────────── */

function group(n: number, decimals: number): string {
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = n < 0 ? "-" : "";
  return sign + withSep + (frac ? `.${frac}` : "");
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Render a computed value for display. NEVER writes back — the stored raw
 * value is untouched, so d=0 rounds the display only.
 *
 * Defaults: num 0, cur 2, pct 1 — except a sub-1% value gets 2, because a
 * fee rate or an equity grant shown at one decimal reads as 0.0%, i.e. as
 * zero.
 */
export function format(
  value: CellValue | SheetError | null | undefined,
  f: CellFormat = "text",
  d?: number,
): string {
  if (value === null || value === undefined || value === "") return "";
  if (isSheetError(value)) return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";

  if (f === "text") return String(value);

  if (f === "date") {
    const s = String(value).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) {
      const day = parseInt(m[3], 10);
      return `${day} ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
    }
    return s;
  }

  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n)) return String(value);

  if (f === "num") return group(n, clampDec(d ?? 0));
  if (f === "cur") {
    // Sign leads the symbol: "-$9,876.50" reads as a debit, "$-9,876.50" reads as a typo.
    const body = group(Math.abs(n), clampDec(d ?? 2));
    return `${n < 0 ? "-" : ""}$${body}`;
  }
  // pct
  const scaled = n * 100;
  const dec = d !== undefined ? clampDec(d) : Math.abs(scaled) < 1 && scaled !== 0 ? 2 : 1;
  return `${group(scaled, dec)}%`;
}

function clampDec(d: number): number {
  return Math.max(0, Math.min(4, Math.trunc(d)));
}
