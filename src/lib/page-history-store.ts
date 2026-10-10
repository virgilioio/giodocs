import type { RestoredPage } from "@/hooks/use-page-history";

/* Which page's history is open, and the open pages that can take a restore.
 * The ⋯ menu opens it (openPageHistory); the page hosts the dialog
 * (PageHistoryHost in src/components/page-history.tsx). */

export type PageHistoryHostApi = {
  /** Finish pending saves. Returns why restoring isn't safe yet, or null. */
  prepare: () => Promise<string | null>;
  /** Load restored content into the open editor. */
  adopt: (row: RestoredPage) => void;
};

let openFor: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function subscribePageHistory(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getOpenPageHistory(): string | null {
  return openFor;
}

export function openPageHistory(pageId: string): void {
  openFor = pageId;
  emit();
}

export function closePageHistory(): void {
  openFor = null;
  emit();
}

/** Page id → the open page's restore steps. */
export const pageHistoryHosts = new Map<string, PageHistoryHostApi>();
