/**
 * Shared, session-only view-drafts store. A view draft is a per-session
 * override on top of a base view (a team view, an area preset, or — for
 * completeness — a personal view someone else owns).
 *
 * Why a module store rather than local `useState`: layout, sort, group and
 * filter can be changed from three places (segmented switcher, toolbar ⋯,
 * sidebar row menu) and two components need to observe them (`MainView`
 * for what to render, sidebar rows for their menu check marks). One store
 * keeps them in agreement.
 *
 * Personal views owned by the current user do NOT use this store — their
 * edits persist directly to the DB row via `useUpdateView`. Everything
 * else (team, area, and someone-else's personal) writes here.
 *
 * The store is session-only by design (mirrors what the local state did
 * previously); we do NOT persist to localStorage, so opening a fresh tab
 * returns you to the base view.
 */

import { useSyncExternalStore } from "react";
import type { Filter, SortSpec } from "./run-view";
import type { ViewDraft, ViewLayout } from "./view-drafts";

type DraftMap = Record<string, ViewDraft>;

let state: DraftMap = {};
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Merge a patch into the draft for `id`. Fields identical to `base` are
 *  optionally pruned via `pruneAgainst`; passing `undefined` keeps them. */
export function patchDraft(
  id: string,
  patch: ViewDraft,
  pruneAgainst?: {
    filter?: Filter[];
    sort?: SortSpec;
    layout?: ViewLayout;
    group_by?: string | null;
  },
): void {
  const merged: ViewDraft = { ...(state[id] ?? {}), ...patch };
  if (pruneAgainst) {
    if (
      "filter" in merged &&
      JSON.stringify(merged.filter) === JSON.stringify(pruneAgainst.filter ?? [])
    )
      delete merged.filter;
    if (
      "sort" in merged &&
      JSON.stringify(merged.sort) === JSON.stringify(pruneAgainst.sort)
    )
      delete merged.sort;
    if ("layout" in merged && merged.layout === pruneAgainst.layout)
      delete merged.layout;
    if (
      "group_by" in merged &&
      (merged.group_by ?? null) === (pruneAgainst.group_by ?? null)
    )
      delete merged.group_by;
  }
  const next: DraftMap = { ...state };
  if (Object.keys(merged).length === 0) delete next[id];
  else next[id] = merged;
  state = next;
  emit();
}

export function clearDraft(id: string): void {
  if (!(id in state)) return;
  const { [id]: _drop, ...rest } = state;
  state = rest;
  emit();
}

export function getDrafts(): DraftMap {
  return state;
}

export function getDraft(id: string): ViewDraft | undefined {
  return state[id];
}

export function useDrafts(): DraftMap {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/** Test hook — resets module state. Never call from product code. */
export function __resetDraftsForTest(): void {
  state = {};
  emit();
}
