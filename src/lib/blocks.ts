/**
 * Shared, pure block utilities used by both the editable body and the
 * export/read-only paths.
 *
 * Two related concerns live here:
 *
 *   1. numberedOrdinals — the ordinal for a "numbered" block. This is a
 *      property of the block's position in its run of consecutive
 *      SAME-INDENT numbered siblings — never a property of the element
 *      itself. Deeper blocks (indent > this one) are skipped without
 *      breaking the run; a block at the same or shallower indent that is
 *      NOT numbered breaks the run.
 *
 *   2. ordinalLabel — the visible label for that numeric ordinal at a
 *      given indent level. Level cycles every 3: 0 → "1.", 1 → "a.",
 *      2 → "i.", 3 → "1." again, and so on.
 *
 *   3. clampIndent — enforces the ONE structural rule: a block's indent
 *      may be at most (previous block's indent + 1). Ceiling 6, floor 0.
 */

import type { Block } from "./types";

const readIndent = (b: unknown): number => {
  if (!b || typeof b !== "object") return 0;
  const raw = (b as { indent?: unknown }).indent;
  return typeof raw === "number" && raw > 0 ? raw : 0;
};

/**
 * For each "numbered" block: the count of preceding CONSECUTIVE numbered
 * blocks at the SAME indent (deeper blocks skipped; a shallower block or a
 * same-indent non-numbered block breaks the run).
 */
export function numberedOrdinals(blocks: readonly Block[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b || b.type !== "numbered") continue;
    const indent = readIndent(b);
    let count = 1;
    for (let j = i - 1; j >= 0; j--) {
      const p = blocks[j];
      if (!p) break;
      const pIndent = readIndent(p);
      if (pIndent > indent) continue; // deeper subtree — skip
      if (pIndent < indent) break; // ascended past this level — stop
      // Same indent
      if (p.type === "numbered") {
        count += 1;
      } else {
        break;
      }
    }
    if (typeof b.id === "string" && b.id) out.set(b.id, count);
  }
  return out;
}

/**
 * Enforce the parent+1 rule. Given the indent of the previous block in
 * the flat list, clamp a requested indent to [0, min(6, prev + 1)].
 */
export function clampIndent(prevIndent: number, requested: number): number {
  const prev = Math.max(0, Math.floor(prevIndent || 0));
  const req = Math.max(0, Math.floor(requested || 0));
  const ceiling = Math.min(6, prev + 1);
  return Math.min(req, ceiling);
}

/* Alphabetic label: 1→a, 2→b, ..., 26→z, 27→aa, 28→ab, ... */
function alphaLabel(n: number): string {
  let x = Math.max(1, Math.floor(n));
  let s = "";
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(97 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/* Roman numeral label, lowercase. Only well-defined for n ≥ 1; we cap the
 * table at 3999 (standard limit) — realistic list ordinals never approach it. */
function romanLabel(n: number): string {
  const x = Math.max(1, Math.min(3999, Math.floor(n)));
  const pairs: Array<[number, string]> = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"],
    [100, "c"], [90, "xc"], [50, "l"], [40, "xl"],
    [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let rem = x;
  let out = "";
  for (const [v, s] of pairs) {
    while (rem >= v) {
      out += s;
      rem -= v;
    }
  }
  return out;
}

/**
 * Label to render for a numbered ordinal at a given indent level. Cycles
 * every 3 levels: numeric → alpha → roman → numeric → ...
 */
export function ordinalLabel(n: number, indent: number): string {
  const cycle = ((indent % 3) + 3) % 3;
  if (cycle === 0) return `${Math.max(1, Math.floor(n))}.`;
  if (cycle === 1) return `${alphaLabel(n)}.`;
  return `${romanLabel(n)}.`;
}
