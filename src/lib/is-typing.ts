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

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as ClosestLike;
  if (typeof el.closest !== "function") return false;
  // Walk up so a click on a nested span inside a contenteditable still counts.
  if (el.closest("textarea, input, select")) return true;
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
