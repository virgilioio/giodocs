/**
 * Shared focus guard for global keyboard shortcuts.
 *
 * Every window/document keydown handler must call `isTypingTarget(e.target)`
 * and bail early when it returns true — the deliberate exceptions are ⌘K
 * (command palette), ⌘, (settings), and Escape, which must still fire while
 * the caret is inside a text field. Everything else yields to the field so
 * native shortcuts (copy, paste, select-all, arrow-nav, undo) behave normally.
 *
 * Never call `preventDefault()` before this guard — that is the pattern that
 * used to break ⌘C/⌘X/⌘V inside page-body textareas.
 */

type ClosestLike = {
  closest?: (sel: string) => Element | null;
  isContentEditable?: boolean;
};

/**
 * A focused sheet grid COUNTS AS TYPING even though no input has focus.
 *
 * ⚠ This is the guard that stops data loss. When a sheet cell is selected
 * but not being edited, focus sits on the grid container — so without this
 * branch every page-level handler would fire: Backspace would delete the
 * SHEET BLOCK instead of clearing the selected cells, arrows would move
 * between blocks, ⌘D would duplicate the block. The sheet marks its grid
 * with `data-sheet-grid` and claims those keys itself (it also
 * stopPropagations each one it handles, so this is belt AND braces).
 */
export const SHEET_GRID_ATTR = "data-sheet-grid";

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as ClosestLike;
  if (typeof el.closest !== "function") return false;
  // Walk up so a click on a nested span inside a contenteditable still counts.
  if (el.closest("textarea, input, select")) return true;
  if (el.closest(`[${SHEET_GRID_ATTR}]`)) return true;
  const editable = el.closest("[contenteditable]") as HTMLElement | null;
  if (editable && editable.isContentEditable) return true;
  return false;
}


/**
 * ⌘A stage decision for a page-body textarea.
 *
 * First ⌘A → false → let the browser select the block's text natively.
 * Second ⌘A (block text already fully selected) → true → the caller
 * preventDefaults, blurs, and selects all blocks on the page.
 *
 * Empty block edge case: with an empty value (length === 0) the selection
 * (0,0) already covers the whole value, so the very first press returns
 * true and promotes to block-level selection — this is the required
 * behaviour when the body has exactly one empty block.
 */
export function shouldSelectAllBlocks(
  selectionStart: number,
  selectionEnd: number,
  valueLength: number,
): boolean {
  return selectionStart === 0 && selectionEnd === valueLength;
}

/**
 * Copy/cut scope for the block-selection ⌘C / ⌘X handlers.
 *
 * When a block selection is active (size > 0) the shortcut ALWAYS operates
 * on the selection — even if focus is still inside a contenteditable block,
 * which was the phase-2b regression this rule fixes. When no selection is
 * active the native focus-target rules apply and the handler yields to the
 * browser (so copying selected text inside a block works normally).
 *
 * Symmetric with the marquee/shift-click paths, which blur the focused
 * editable and clear the DOM selection at the moment they set a block
 * selection — so "block selection active" and "caret in a block" are
 * mutually exclusive by design.
 */
export function shouldCopyBlocks(
  selectionSize: number,
  target: EventTarget | null,
): boolean {
  if (selectionSize > 0) return true;
  return !isTypingTarget(target);
}
