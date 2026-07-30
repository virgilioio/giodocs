/* Undo/redo store — module-level, keyed by page id.
 *
 * WHY THIS EXISTS: the stack used to live in a `useRef` inside
 * `EditableBody`. Refs die with the component, and the editor IS
 * remounted — `<PageEditor key={selection.id}>` re-keys whenever the URL
 * param resolves to a different canonical id (the cosmetic slug form
 * resolves only once the pages list arrives), a transient null selection
 * during a router transition unmounts the subtree, and dev StrictMode
 * mounts twice. Every one of those silently emptied the stack, which
 * presents to a user as "⌘Z only works a few times".
 *
 * Same shape as view-drafts-store.ts: a plain module Map, no React.
 */

import {
  createUndoState,
  type UndoState,
} from "./undo-stack";

type Slot<B> = {
  state: UndoState<B>;
  /** Coalescing markers travel with the stack so a remount mid-burst
   *  doesn't split one typed sentence into two entries. */
  lastTypingAt: number | null;
  lastTypingKey: string | null;
};

const slots = new Map<string, Slot<unknown>>();

function slotFor<B>(pageId: string): Slot<B> {
  let s = slots.get(pageId) as Slot<B> | undefined;
  if (!s) {
    s = { state: createUndoState<B>(), lastTypingAt: null, lastTypingKey: null };
    slots.set(pageId, s as Slot<unknown>);
  }
  return s;
}

export function getUndoState<B>(pageId: string): UndoState<B> {
  return slotFor<B>(pageId).state;
}

export function setUndoState<B>(pageId: string, state: UndoState<B>): void {
  slotFor<B>(pageId).state = state;
}

export function getTypingMarker(pageId: string): {
  at: number | null;
  key: string | null;
} {
  const s = slotFor<unknown>(pageId);
  return { at: s.lastTypingAt, key: s.lastTypingKey };
}

export function setTypingMarker(
  pageId: string,
  at: number | null,
  key: string | null,
): void {
  const s = slotFor<unknown>(pageId);
  s.lastTypingAt = at;
  s.lastTypingKey = key;
}

/** Drop a page's history (page deleted, or an explicit reset). */
export function clearUndoStore(pageId: string): void {
  slots.delete(pageId);
}
