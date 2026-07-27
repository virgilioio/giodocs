/* Pure keyboard resolver for block-editor textareas.
 *
 * ONE resolver, called from BOTH the top-level `EditableBody` and each
 * `ColumnStack`. Given a scope (`'page'` or `'column'`), the list this
 * textarea belongs to, the block's index within that list, and simple
 * event facts, it returns an `Op` describing what the caller should do.
 * The caller performs the mutation (using block-ops) and handles focus
 * and undo — this module never touches the DOM.
 *
 * The four legitimate scope-dependent differences (all reproduced in the
 * table-driven parity test) are:
 *   1. Backspace at index 0
 *       page   → merge with previous top-level block
 *       column → no-op (never cross the column boundary)
 *   2. Enter on an empty text block that is the LAST in its list
 *       page   → split (normal insert-below)
 *       column → escape-column (promote focus to top-level neighbour)
 *   3. ArrowLeft at offset 0 / ArrowUp at offset 0 on the FIRST block
 *       page   → exit-to-title
 *       column → arrow-jump dir=-1 (caller then falls out via bridge)
 *   4. (Not observable in resolveKey — belongs to render-tree state):
 *      the slash menu offers /col2…/col6 at page scope, never at column
 *      scope, and refuses to apply type 'columns' at column scope.
 *
 * Everything else is identical by construction — the whole point.
 */

import type { Blk } from "./block-ops";
import { shouldSelectAllBlocks } from "./is-typing";
import { enterAction } from "./enter-behaviour";

export type Scope = "page" | "column";

export type KeyEventFacts = {
  key: string;
  /** true for either metaKey (mac) or ctrlKey (win/linux). */
  meta: boolean;
  shift: boolean;
  selStart: number;
  selEnd: number;
  valueLength: number;
  /** Textarea value at the moment of the keydown. */
  value: string;
};

export type Op =
  /** No action — the caller must not preventDefault, so the browser handles
   *  the key natively (typing, native ⌘C/⌘X/⌘V, native shift-arrow, etc.). */
  | { kind: "none" }
  /** Escape — blur the textarea. */
  | { kind: "blur" }
  /** Split at caret (list-type inheritance handled by block-ops.splitBlock). */
  | { kind: "split"; caret: number }
  /** Empty list-like block → convert to plain text. */
  | { kind: "convert-to-text" }
  /** Backspace at start with a non-empty text block → merge into previous. */
  | { kind: "merge-prev" }
  /** Backspace at start on an empty non-list text block → remove it. */
  | { kind: "remove-empty" }
  /** Column-only: escape the column via the enterAction decision. */
  | { kind: "escape-column"; removeEmpty: boolean }
  /** Stage-2 ⌘A: blur and select every block. Caller decides scope
   *  (page: local blocks; column: top-level blocks via bridge). */
  | { kind: "select-all-blocks" }
  /** ⌘D: duplicate the focused block within its current list. */
  | { kind: "duplicate" }
  /** Horizontal or first/last-line boundary jump. The caller looks up the
   *  next editable within the list; if there is no target in that
   *  direction, at column scope it falls out via the bridge, at page
   *  scope it either focuses the title (dir === -1) or does nothing. */
  | { kind: "arrow-jump"; dir: 1 | -1; caret: "start" | "end" }
  /** Ambiguous vertical arrow: caret is not at start/end of the value, so
   *  the browser might wrap or move within the block. The caller runs a
   *  rAF probe: if the caret settled at position 0 (dir=-1) or end
   *  (dir=1), promote to the neighbouring block. Never preventDefault. */
  | { kind: "arrow-vertical-probe"; dir: 1 | -1 }
  /** Page-scope only: ArrowUp / ArrowLeft on the first block, caret 0. */
  | { kind: "exit-to-title" }
  /** Tab on an indentable list-type block. Caller applies indentBlock(+1). */
  | { kind: "indent" }
  /** Shift-Tab, OR Backspace at caret 0 of an already-indented block. */
  | { kind: "outdent" };

const LIST_TYPES = new Set(["bullet", "numbered", "todo"]);
const INDENTABLE = new Set(["bullet", "numbered", "todo", "text"]);

export function resolveKey(
  scope: Scope,
  list: Blk[],
  index: number,
  ef: KeyEventFacts,
): Op {
  const { key, meta, shift, selStart, selEnd, valueLength, value } = ef;
  const collapsed = selStart === selEnd;
  const b: Blk | undefined = list[index];

  // Escape
  if (key === "Escape") return { kind: "blur" };

  // ⌘A two-stage. First press with unselected/partial text: let the
  // browser select the block's text natively. Second press (text fully
  // selected, or empty block): escalate to a block-selection.
  if (meta && key.toLowerCase() === "a") {
    if (shouldSelectAllBlocks(selStart, selEnd, valueLength)) {
      return { kind: "select-all-blocks" };
    }
    return { kind: "none" };
  }

  // ⌘D duplicate — never yield to native (browser bookmarks the tab).
  if (meta && key.toLowerCase() === "d") {
    return { kind: "duplicate" };
  }

  // Tab / Shift-Tab — indent/outdent, only on list-like types. Always
  // preventDefault on those types so the textarea doesn't lose focus.
  if (key === "Tab") {
    if (!b || !INDENTABLE.has(b.type)) return { kind: "none" };
    return shift ? { kind: "outdent" } : { kind: "indent" };
  }

  // Enter (no shift)
  if (key === "Enter" && !shift) {
    if (!b) return { kind: "split", caret: selStart };
    const isEmpty = (b.text ?? "") === "";
    // Empty list-like block: same at both scopes — convert to text.
    if (isEmpty && LIST_TYPES.has(b.type)) return { kind: "convert-to-text" };
    if (scope === "column") {
      // Delegate to the shared enterAction decision (column-escape rules).
      const a = enterAction(list, index, selStart, value);
      if (a.kind === "split") return { kind: "split", caret: selStart };
      if (a.kind === "convert-to-text") return { kind: "convert-to-text" };
      return { kind: "escape-column", removeEmpty: a.removeEmpty };
    }
    return { kind: "split", caret: selStart };
  }

  // Backspace at caret 0
  if (key === "Backspace" && collapsed && selStart === 0) {
    if (!b) return { kind: "none" };
    // Indented list-like block: Backspace at position 0 outdents by one
    // level BEFORE any merge/convert logic. Only when indent has reached
    // 0 do the existing conversions run.
    const curIndent = (b as { indent?: number }).indent ?? 0;
    if (curIndent > 0 && INDENTABLE.has(b.type)) return { kind: "outdent" };
    if (b.type !== "text") return { kind: "convert-to-text" };
    if ((b.text ?? "") === "") {
      if (scope === "column" && index === 0) return { kind: "none" };
      return { kind: "remove-empty" };
    }
    if (scope === "column" && index === 0) return { kind: "none" };
    return { kind: "merge-prev" };
  }

  // Arrow navigation. Only with a collapsed caret; a real selection is
  // left alone so shift-arrow and drag-select keep working.
  if (collapsed) {
    if (key === "ArrowLeft" && selStart === 0) {
      if (scope === "page" && index === 0) return { kind: "exit-to-title" };
      return { kind: "arrow-jump", dir: -1, caret: "end" };
    }
    if (key === "ArrowRight" && selStart === valueLength) {
      return { kind: "arrow-jump", dir: 1, caret: "start" };
    }
    if (key === "ArrowUp") {
      if (selStart === 0) {
        if (scope === "page" && index === 0) return { kind: "exit-to-title" };
        return { kind: "arrow-jump", dir: -1, caret: "end" };
      }
      return { kind: "arrow-vertical-probe", dir: -1 };
    }
    if (key === "ArrowDown") {
      if (selStart === valueLength) {
        return { kind: "arrow-jump", dir: 1, caret: "start" };
      }
      return { kind: "arrow-vertical-probe", dir: 1 };
    }
  }

  return { kind: "none" };
}
