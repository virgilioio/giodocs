import { useSyncExternalStore } from "react";
import type { SaverStatus } from "./blocks-saver";

/**
 * Per-page save status, written by the page body's saver and read by the
 * top bar ("Saving…", "Not saved") and the unload guard. A page that left
 * the screen with unsaved work keeps its entry until its saver catches up.
 */
const statuses = new Map<string, SaverStatus>();
const listeners = new Set<() => void>();

export function setSaveStatus(pageId: string, status: SaverStatus): void {
  if (status === "idle") statuses.delete(pageId);
  else statuses.set(pageId, status);
  listeners.forEach((l) => l());
}

export function getSaveStatus(pageId: string): SaverStatus {
  return statuses.get(pageId) ?? "idle";
}

/** True when any page has work the server hasn't confirmed. */
export function anyUnsaved(): boolean {
  for (const s of statuses.values()) if (s !== "idle") return true;
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
