/* Table-driven parity test for `resolveKey`.
 *
 * ONE fixture, run through both scopes. Every row must produce IDENTICAL
 * output at 'page' and 'column' scopes UNLESS explicitly tagged with an
 * `intended` reason — those three tags map to the three resolver-level
 * legitimate differences documented in block-key-handler.ts.
 *
 * The whole point of the extraction is that this test cannot silently
 * regress: adding new keyboard behaviour without touching this file will
 * only pass if the two scopes match.
 */

import { describe, it, expect } from "vitest";
import {
  resolveKey,
  type KeyEventFacts,
  type Op,
} from "./block-key-handler";
import type { Blk } from "./block-ops";

function b(type: string, text = "", id = `${type}-${text.length}`): Blk {
  return { id, type: type as Blk["type"], text };
}

function ef(part: Partial<KeyEventFacts> & { key: string; value?: string }): KeyEventFacts {
  const value = part.value ?? "";
  return {
    key: part.key,
    meta: part.meta ?? false,
    shift: part.shift ?? false,
    selStart: part.selStart ?? 0,
    selEnd: part.selEnd ?? part.selStart ?? 0,
    valueLength: part.valueLength ?? value.length,
    value,
  };
}

type IntentionalDiff =
  | "backspace-at-index-0"
  | "enter-empty-last-text"
  | "arrow-up-first-block-at-zero";

type Case = {
  name: string;
  list: Blk[];
  index: number;
  ef: KeyEventFacts;
  intended: IntentionalDiff | null;
  /** Reason string, printed on failure. Non-null iff intended is non-null. */
  reason: string | null;
};

const cases: Case[] = [
  // ── parity: split at caret in a middle non-empty text ──
  {
    name: "Enter mid-caret on non-empty text (middle) → split",
    list: [b("text", "hello"), b("text", "world")],
    index: 0,
    ef: ef({ key: "Enter", value: "hello", selStart: 3 }),
    intended: null,
    reason: null,
  },
  // ── parity: Enter on empty bullet converts to text ──
  {
    name: "Enter on empty bullet (last) → convert-to-text",
    list: [b("text", "a"), b("bullet", "")],
    index: 1,
    ef: ef({ key: "Enter", value: "" }),
    intended: null,
    reason: null,
  },
  // ── parity: Enter on empty numbered/todo converts to text ──
  {
    name: "Enter on empty numbered (last) → convert-to-text",
    list: [b("text", "a"), b("numbered", "")],
    index: 1,
    ef: ef({ key: "Enter", value: "" }),
    intended: null,
    reason: null,
  },
  {
    name: "Enter on empty todo (last) → convert-to-text",
    list: [b("text", "a"), b("todo", "")],
    index: 1,
    ef: ef({ key: "Enter", value: "" }),
    intended: null,
    reason: null,
  },
  // ── intended #2: Enter on empty text, last of list ──
  {
    name: "Enter on empty text, LAST (multi) — page splits, column escapes",
    list: [b("text", "a"), b("text", "")],
    index: 1,
    ef: ef({ key: "Enter", value: "" }),
    intended: "enter-empty-last-text",
    reason: "column escapes to top-level neighbour; page splits normally",
  },
  {
    name: "Enter on empty text, LAST and ONLY — same asymmetry",
    list: [b("text", "")],
    index: 0,
    ef: ef({ key: "Enter", value: "" }),
    intended: "enter-empty-last-text",
    reason: "column escapes without removeEmpty; page splits",
  },
  // ── parity: Enter on empty text NOT last → split at both scopes ──
  {
    name: "Enter on empty text, NOT last → split (both scopes)",
    list: [b("text", ""), b("text", "next")],
    index: 0,
    ef: ef({ key: "Enter", value: "" }),
    intended: null,
    reason: null,
  },

  // ── intended #1: Backspace at index 0 ──
  {
    name: "Backspace at start of index 0 on non-empty text",
    list: [b("text", "hello")],
    index: 0,
    ef: ef({ key: "Backspace", value: "hello", selStart: 0 }),
    intended: "backspace-at-index-0",
    reason: "page merges with prev top-level (or ignores at 0); column ignores",
  },
  // Note: at page scope index=0 with non-empty text → merge-prev returns
  // null-op via mergeIntoPrev (idx<=0), but the resolver still asks for it;
  // whereas column returns 'none'. Different ops, intended.

  // ── parity: Backspace at start on non-text (bullet) → convert-to-text ──
  {
    name: "Backspace at start on empty bullet → convert-to-text (both scopes)",
    list: [b("text", "prev"), b("bullet", "")],
    index: 1,
    ef: ef({ key: "Backspace", value: "", selStart: 0 }),
    intended: null,
    reason: null,
  },
  // ── parity: Backspace at start on non-empty text (index>0) merges ──
  {
    name: "Backspace at start on non-empty text (index 1) → merge-prev (both)",
    list: [b("text", "a"), b("text", "b")],
    index: 1,
    ef: ef({ key: "Backspace", value: "b", selStart: 0 }),
    intended: null,
    reason: null,
  },
  // ── parity: Backspace at start on empty text (index>0) → remove-empty ──
  {
    name: "Backspace at start on empty text (index 1) → remove-empty (both)",
    list: [b("text", "a"), b("text", "")],
    index: 1,
    ef: ef({ key: "Backspace", value: "", selStart: 0 }),
    intended: null,
    reason: null,
  },

  // ── parity: Escape → blur ──
  {
    name: "Escape → blur (both)",
    list: [b("text", "x")],
    index: 0,
    ef: ef({ key: "Escape", value: "x" }),
    intended: null,
    reason: null,
  },
  // ── parity: ⌘A stage 1 → none ──
  {
    name: "⌘A with partial text → none (both)",
    list: [b("text", "abc")],
    index: 0,
    ef: ef({ key: "a", meta: true, value: "abc", selStart: 0, selEnd: 1 }),
    intended: null,
    reason: null,
  },
  // ── parity: ⌘A stage 2 → select-all-blocks ──
  {
    name: "⌘A stage 2 (text fully selected) → select-all-blocks (both)",
    list: [b("text", "abc")],
    index: 0,
    ef: ef({ key: "a", meta: true, value: "abc", selStart: 0, selEnd: 3 }),
    intended: null,
    reason: null,
  },
  // ── parity: ⌘D → duplicate ──
  {
    name: "⌘D → duplicate (both)",
    list: [b("text", "x")],
    index: 0,
    ef: ef({ key: "d", meta: true, value: "x" }),
    intended: null,
    reason: null,
  },

  // ── intended #3: ArrowUp/ArrowLeft at 0 on the FIRST block ──
  {
    name: "ArrowUp at 0 on first block — page exits to title, column jumps",
    list: [b("text", "abc")],
    index: 0,
    ef: ef({ key: "ArrowUp", value: "abc", selStart: 0 }),
    intended: "arrow-up-first-block-at-zero",
    reason: "page focuses the title; column falls out to sibling via bridge",
  },
  {
    name: "ArrowLeft at 0 on first block — page exits to title, column jumps",
    list: [b("text", "abc")],
    index: 0,
    ef: ef({ key: "ArrowLeft", value: "abc", selStart: 0 }),
    intended: "arrow-up-first-block-at-zero",
    reason: "same reason as ArrowUp at first block",
  },

  // ── parity: ArrowUp at 0 on a MIDDLE block ──
  {
    name: "ArrowUp at 0 on index 1 → arrow-jump -1 (both)",
    list: [b("text", "a"), b("text", "b")],
    index: 1,
    ef: ef({ key: "ArrowUp", value: "b", selStart: 0 }),
    intended: null,
    reason: null,
  },
  // ── parity: ArrowDown at end → arrow-jump +1 ──
  {
    name: "ArrowDown at end → arrow-jump +1 (both)",
    list: [b("text", "a"), b("text", "b")],
    index: 0,
    ef: ef({ key: "ArrowDown", value: "a", selStart: 1 }),
    intended: null,
    reason: null,
  },
  // ── parity: ArrowDown mid-value → probe ──
  {
    name: "ArrowDown mid-value → probe (both)",
    list: [b("text", "abc")],
    index: 0,
    ef: ef({ key: "ArrowDown", value: "abc", selStart: 1 }),
    intended: null,
    reason: null,
  },
  // ── parity: ArrowRight at end → arrow-jump +1 ──
  {
    name: "ArrowRight at end → arrow-jump +1 (both)",
    list: [b("text", "ab"), b("text", "cd")],
    index: 0,
    ef: ef({ key: "ArrowRight", value: "ab", selStart: 2 }),
    intended: null,
    reason: null,
  },
  // ── parity: unrelated key → none ──
  {
    name: "typing 'x' → none (both)",
    list: [b("text", "a")],
    index: 0,
    ef: ef({ key: "x", value: "a", selStart: 1 }),
    intended: null,
    reason: null,
  },
];

describe("resolveKey — table-driven parity", () => {
  for (const c of cases) {
    const opP: Op = resolveKey("page", c.list, c.index, c.ef);
    const opC: Op = resolveKey("column", c.list, c.index, c.ef);
    if (c.intended === null) {
      it(`parity: ${c.name}`, () => {
        expect(opC).toEqual(opP);
      });
    } else {
      it(`intended-different (${c.intended}): ${c.name}`, () => {
        expect(opC).not.toEqual(opP);
      });
    }
  }
});
