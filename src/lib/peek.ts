import { createContext, useContext, useSyncExternalStore } from "react";
import { PHONE_QUERY } from "./use-media";

/* A page opened in a dialog over the current one (2026-10-11, Notion's
 * centre peek): new pages and database rows open here; ⤡ opens the page
 * itself. On a phone pages always open in full. One at a time.
 *
 * `fresh` marks a page made for this dialog: closing it while it's still
 * blank throws it away (no "Untitled" pages left behind). */

export type Peek = { id: string; fresh: boolean };

let current: Peek | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function openPeek(id: string, opts: { fresh?: boolean } = {}): void {
  current = { id, fresh: !!opts.fresh };
  emit();
}

export function closePeek(): void {
  if (!current) return;
  current = null;
  emit();
}

export function isPeekOpen(): boolean {
  return current !== null;
}

export function usePeek(): Peek | null {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => current,
    () => null,
  );
}

/** Opens a page: in the dialog, or in full on a phone (and when `full`). */
export function openPageSomewhere(
  navigate: (o: { to: "/p/$pageId"; params: { pageId: string } }) => unknown,
  id: string,
  opts: { full?: boolean; fresh?: boolean } = {},
): void {
  const phone = typeof window !== "undefined" && !!window.matchMedia?.(PHONE_QUERY).matches;
  if (phone || opts.full) {
    closePeek();
    void navigate({ to: "/p/$pageId", params: { pageId: id } });
    return;
  }
  openPeek(id, { fresh: opts.fresh });
}

/** True inside the dialog's editor. The page underneath ignores window-wide
 *  keys (undo, select all, copy…) while a dialog is open. */
export const PeekScopeCtx = createContext(false);

/** For window-wide key handlers: do keys belong to this editor? (`inPeek`:
 *  the editor is the dialog's.) */
export function keysAreMine(inPeek: boolean): boolean {
  return inPeek || current === null;
}

/** The editor's own scope, for reading inside handlers. */
export function useInPeek(): boolean {
  return useContext(PeekScopeCtx);
}
