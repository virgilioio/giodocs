/**
 * Formula AUTOCOMPLETE and CLICK-TO-REFERENCE — pure. No React, no DOM.
 *
 * The panel, the argument chip and the reference halo are all grid-level
 * overlays in src/components/sheet-block.tsx; every DECISION they need is
 * made here so it is testable without a DOM.
 *
 * ⚠ THE FUNCTION LIST IS NOT HERE. It is FUNCTION_META in sheet-engine.ts,
 * beside the implementations, so the panel can never offer a function the
 * engine does not have. This file only filters it.
 *
 * ⚠ EVERYTHING READS THE WORD UNDER THE CARET, never the tail of the
 * draft — editing "=SUM(A1)+MIN(B1)" in the middle must still offer the
 * right names.
 */

import { FUNCTION_META, type FunctionMeta } from "./sheet-engine";
import { colLabel } from "./sheet-select";

export type Token = { text: string; start: number; end: number };

/** The identifier the caret sits in or against. */
export function wordUnderCaret(src: string, caret: number): Token {
  const at = Math.max(0, Math.min(src.length, caret));
  let s = at;
  while (s > 0 && /[A-Za-z]/.test(src[s - 1])) s--;
  let e = at;
  while (e < src.length && /[A-Za-z]/.test(src[e])) e++;
  return { text: src.slice(s, e), start: s, end: e };
}

/**
 * "Could a name (or a reference) start here?" — true after "=", after an
 * operator, after a comma, after "(" and after ":", and FALSE after a
 * complete reference or a digit. This is both the panel's reopen rule and
 * click-to-reference's permission to insert.
 */
export function offersHere(textBeforeCaret: string): boolean {
  return /[=+\-*/^(,:<>%]\s*$/.test(textBeforeCaret);
}

export type Suggestions = {
  items: FunctionMeta[];
  total: number;
  /** The token the insertion will replace. */
  word: Token;
};

export const FUNCTION_TOTAL = FUNCTION_META.length;

/** Case-insensitive prefix match against the engine's table. */
export function matchFunctions(prefix: string): FunctionMeta[] {
  if (!prefix) return FUNCTION_META;
  const up = prefix.toUpperCase();
  return FUNCTION_META.filter((f) => f.name.startsWith(up));
}

/**
 * What the panel should show for this draft and caret, or null for
 * "no panel". A formula only: a plain value never suggests anything.
 */
export function suggestFor(src: string, caret: number): Suggestions | null {
  if (!src.startsWith("=")) return null;
  const word = wordUnderCaret(src, caret);
  const before = src.slice(0, word.start);
  if (!word.text) {
    if (!offersHere(before)) return null;
    return { items: FUNCTION_META, total: FUNCTION_TOTAL, word };
  }
  if (!offersHere(before)) return null;
  const items = matchFunctions(word.text);
  if (!items.length) return null;
  return { items, total: FUNCTION_TOTAL, word };
}

/** The sticky footer reports state rather than repeating the list's length. */
export function footerText(shown: number, total: number): string {
  if (shown >= total) return `All ${total} functions · type to narrow · ↑↓ Tab`;
  return `${shown} of ${total} · ↑↓ to choose · Tab to insert`;
}

/** ↑↓ wrap, so a twenty-row list is reachable from either end. */
export function moveHighlight(idx: number, delta: number, len: number): number {
  if (len <= 0) return 0;
  return (((idx + delta) % len) + len) % len;
}

/**
 * Insert a function name over the word under the caret. A no-argument
 * function lands complete — "TODAY()" with the caret AFTER the paren,
 * because there is nothing to type inside it.
 */
export function insertFunction(
  src: string,
  caret: number,
  meta: FunctionMeta,
): { draft: string; caret: number } {
  const w = wordUnderCaret(src, caret);
  const noArgs = meta.args === "()";
  const ins = noArgs ? `${meta.name}()` : `${meta.name}(`;
  return {
    draft: src.slice(0, w.start) + ins + src.slice(w.end),
    caret: w.start + ins.length,
  };
}

/**
 * The innermost call the caret sits inside, or null. Once the caret is in
 * a call the question has changed from "which function" to "what goes
 * here", so the panel gives way to a chip naming the arguments.
 */
export function activeCall(src: string, caret: number): FunctionMeta | null {
  if (!src.startsWith("=")) return null;
  const upto = src.slice(0, Math.max(0, Math.min(src.length, caret)));
  const stack: (FunctionMeta | null)[] = [];
  let quote: string | null = null;
  for (let i = 0; i < upto.length; i++) {
    const ch = upto[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(") {
      const name = /([A-Za-z]+)$/.exec(upto.slice(0, i));
      const meta = name
        ? (FUNCTION_META.find((f) => f.name === name[1].toUpperCase()) ?? null)
        : null;
      stack.push(meta);
      continue;
    }
    if (ch === ")") stack.pop();
  }
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i]) return stack[i];
  return null;
}

/* ─────────────────── Click-to-reference ─────────────────── */

/** The span the last pick wrote, so the next one REPLACES it. */
export type PickSpan = { start: number; len: number };

/** An A1 reference or range for a rectangle of cells. */
export function refFor(r0: number, c0: number, r1: number, c1: number): string {
  const a = `${colLabel(Math.min(c0, c1))}${Math.min(r0, r1) + 1}`;
  if (r0 === r1 && c0 === c1) return a;
  return `${a}:${colLabel(Math.max(c0, c1))}${Math.max(r0, r1) + 1}`;
}

/**
 * May a cell click insert a reference here? Yes when the caret sits where
 * an operand belongs, and yes while a pick is live — that is what lets a
 * second click REPLACE the first without deleting anything.
 */
export function canPick(src: string, caret: number, span: PickSpan | null): boolean {
  if (!src.startsWith("=")) return false;
  if (span && span.start + span.len === caret) return true;
  return offersHere(src.slice(0, Math.max(0, Math.min(src.length, caret))));
}

/**
 * Write `ref` at the caret, or over the live pick. Returns the new span so
 * the following pick can replace this one.
 */
export function insertRef(
  src: string,
  caret: number,
  ref: string,
  span: PickSpan | null,
): { draft: string; caret: number; span: PickSpan } {
  const replacing = span && span.start + span.len === caret;
  const start = replacing ? span!.start : caret;
  const end = replacing ? span!.start + span!.len : caret;
  return {
    draft: src.slice(0, start) + ref + src.slice(end),
    caret: start + ref.length,
    span: { start, len: ref.length },
  };
}

/** Typing ANY character ends the pick, so the next click inserts fresh. */
export function pickAfterTyping(): PickSpan | null {
  return null;
}

/* ─────────────────── Panel placement ─────────────────── */

/** Flip ABOVE the cell in the bottom few rows so the panel is never clipped. */
export function panelPlacement(r: number, rows: number): "above" | "below" {
  return rows - r <= 4 && rows > 5 ? "above" : "below";
}

export const PANEL_W = 290;
export const PANEL_MAX_H = 226;
