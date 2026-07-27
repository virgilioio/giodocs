/**
 * Document-level undo/redo for the page editor.
 *
 * Why we own it: block textareas are controlled — every keystroke rewrites
 * the whole blocks array and React swaps the DOM value, wiping the
 * browser's per-input undo stack. So we stack our own snapshots.
 *
 * SCOPE: pure data. The React wiring lives in
 * `src/components/page-editor-body.tsx`. Keeping the logic pure lets us
 * unit-test it without a DOM.
 *
 * MODEL: a snapshot is the WHOLE blocks array plus the caret at push time
 * (block id + offset). One stack per open page, in memory only — the
 * `public.page_versions` trigger is the disaster-recovery net beneath.
 *
 * COALESCE: typing does NOT push per keystroke. `shouldCoalesce()` returns
 * true while the same block has been typed into within COALESCE_MS; the
 * caller skips the push in that case. A block switch or a gap of
 * COALESCE_MS ends the burst — the next keystroke pushes.
 *
 * REMOTE-PATCH POLICY (documented here, enforced by the caller): if a
 * remote patch replaces the local blocks while the user has a non-empty
 * undo stack, DO NOT try to rebase. Clear `future` and leave `past` alone.
 * Correct multi-user undo needs OT/CRDT; that's out of scope.
 */

export type UndoCaret = { blockId: string; offset: number } | null;

export type UndoEntry<B> = {
  blocks: B[];
  caret: UndoCaret;
};

export type UndoState<B> = {
  past: UndoEntry<B>[];
  future: UndoEntry<B>[];
};

export const UNDO_CAP = 100;
export const COALESCE_MS = 600;

export function createUndoState<B>(): UndoState<B> {
  return { past: [], future: [] };
}

/** Push an entry onto `past`, cap-drop the OLDEST first, and always
 *  clear `future` (the "any new action clears future" rule). */
export function push<B>(state: UndoState<B>, entry: UndoEntry<B>): UndoState<B> {
  const past = state.past.concat(entry);
  while (past.length > UNDO_CAP) past.shift();
  return { past, future: [] };
}

/** Pop the newest `past` entry as the "restore target", and push the
 *  caller's `current` snapshot onto `future` so redo can return to it.
 *  Returns null when `past` is empty (undo is a no-op). */
export function undo<B>(
  state: UndoState<B>,
  current: UndoEntry<B>,
): { state: UndoState<B>; entry: UndoEntry<B> } | null {
  if (state.past.length === 0) return null;
  const past = state.past.slice(0, -1);
  const entry = state.past[state.past.length - 1];
  const future = [current, ...state.future];
  while (future.length > UNDO_CAP) future.pop();
  return { state: { past, future }, entry };
}

/** Symmetric to undo. */
export function redo<B>(
  state: UndoState<B>,
  current: UndoEntry<B>,
): { state: UndoState<B>; entry: UndoEntry<B> } | null {
  if (state.future.length === 0) return null;
  const [entry, ...future] = state.future;
  const past = state.past.concat(current);
  while (past.length > UNDO_CAP) past.shift();
  return { state: { past, future }, entry };
}

/** True when the next push should be COALESCED into the previous one
 *  — i.e. same block AND within COALESCE_MS. First keystroke of a burst
 *  (lastPushTime null) always returns false so the burst-start pushes. */
export function shouldCoalesce(
  lastPushTime: number | null,
  now: number,
  lastBlockId: string | null,
  currentBlockId: string,
): boolean {
  if (lastPushTime == null) return false;
  if (lastBlockId == null) return false;
  if (lastBlockId !== currentBlockId) return false;
  return now - lastPushTime < COALESCE_MS;
}
