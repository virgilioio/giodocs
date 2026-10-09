import { useSyncExternalStore } from "react";
import type { SaverStatus } from "./blocks-saver";

/**
 * Per-page save status, written by the page body's saver and read by the
 * top bar ("Saving…", "Not saved") and the unload guard. A page that left
 * the screen with unsaved work keeps its entry until its saver catches up.
 */
// pageId → (saver instance → status). A page reopened while its previous
// editor's saver is still retrying has two savers; the worst status wins.
const statuses = new Map<string, Map<string, SaverStatus>>();
const listeners = new Set<() => void>();
const RANK: Record<SaverStatus, number> = { idle: 0, pending: 1, saving: 2, retrying: 3, stopped: 4 };

export function setSaveStatus(pageId: string, status: SaverStatus, owner = "default"): void {
  let m = statuses.get(pageId);
  if (status === "idle") {
    m?.delete(owner);
    if (m && m.size === 0) statuses.delete(pageId);
  } else {
    if (!m) statuses.set(pageId, (m = new Map()));
    m.set(owner, status);
  }
  listeners.forEach((l) => l());
}

export function getSaveStatus(pageId: string): SaverStatus {
  let worst: SaverStatus = "idle";
  for (const st of statuses.get(pageId)?.values() ?? []) if (RANK[st] > RANK[worst]) worst = st;
  return worst;
}

/** True when any page has work the server hasn't confirmed. */
export function anyUnsaved(): boolean {
  for (const m of statuses.values()) for (const st of m.values()) if (st !== "idle") return true;
  return false;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSaveStatus(pageId: string): SaverStatus {
  return useSyncExternalStore(
    subscribe,
    () => getSaveStatus(pageId),
    () => "idle",
  );
}
