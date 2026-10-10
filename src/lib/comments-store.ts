/* Whether the comments panel is open, for which page, and what it should
 * do on opening: start a thread on a block (and the words selected in
 * it), or show one thread. The topbar button, the formatting toolbar, the
 * block markers and inbox links all open it through here. */

import { useSyncExternalStore } from "react";

export type CommentsPanelState = {
  pageId: string;
  /** Start a new thread on this block, quoting these words. */
  draft?: { blockId: string | null; quote: string | null } | null;
  /** Scroll to and highlight this thread. */
  focusThread?: string | null;
  /** Bumped on every open, so asking again re-applies draft / focus. */
  seq: number;
};

let state: CommentsPanelState | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openComments(pageId: string, opts: Omit<CommentsPanelState, "pageId" | "seq"> = {}): void {
  state = { pageId, ...opts, seq: ++seq };
  emit();
}

export function closeComments(): void {
  if (!state) return;
  state = null;
  emit();
}

export function toggleComments(pageId: string): void {
  if (state?.pageId === pageId) closeComments();
  else openComments(pageId);
}

export function getCommentsPanel(): CommentsPanelState | null {
  return state;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useCommentsPanel(): CommentsPanelState | null {
  return useSyncExternalStore(subscribe, getCommentsPanel, () => null);
}
