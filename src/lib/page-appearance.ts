/**
 * Per-page, per-device appearance overrides. Never touches the database and
 * never rides on global Preferences.
 *
 * Backed by a module-level useSyncExternalStore (like view-drafts-store.ts)
 * so every mount that reads pageId `X` — the topbar menu that toggles the
 * values AND the page body that must render with them — observes the SAME
 * state. Values are persisted to localStorage for durability across reloads.
 */

import { useSyncExternalStore } from "react";

export type PageFont = "default" | "serif" | "mono";

export type PageAppearance = {
  font: PageFont;
  small: boolean;
  wide: boolean;
  locked: boolean;
};

const DEFAULT: PageAppearance = {
  font: "default",
  small: false,
  wide: false,
  locked: false,
};

function keyFor(pageId: string): string {
  return `gio:pageui:${pageId}`;
}

function readFromStorage(pageId: string): PageAppearance {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(keyFor(pageId));
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<PageAppearance>;
    return { ...DEFAULT, ...parsed };
  } catch {
    return DEFAULT;
  }
}

// Module-scoped store. Each pageId gets ONE object identity that every
// consumer subscribes to, so an update in the topbar menu is observable
// by the page body in the same render pass.
const cache = new Map<string, PageAppearance>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function getFor(pageId: string): PageAppearance {
  let v = cache.get(pageId);
  if (!v) {
    v = readFromStorage(pageId);
    cache.set(pageId, v);
  }
  return v;
}

function setFor<K extends keyof PageAppearance>(
  pageId: string,
  key: K,
  value: PageAppearance[K],
): void {
  const cur = getFor(pageId);
  if (cur[key] === value) return;
  const next: PageAppearance = { ...cur, [key]: value };
  cache.set(pageId, next);
  try {
    window.localStorage.setItem(keyFor(pageId), JSON.stringify(next));
  } catch {
    /* ignore quota / disabled storage */
  }
  emit();
}

// Cross-tab sync: another tab writing localStorage invalidates our cache
// entry for that page.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (!e.key || !e.key.startsWith("gio:pageui:")) return;
    const pageId = e.key.slice("gio:pageui:".length);
    cache.set(pageId, readFromStorage(pageId));
    emit();
  });
}

export function usePageAppearance(pageId: string): {
  app: PageAppearance;
  set: <K extends keyof PageAppearance>(key: K, value: PageAppearance[K]) => void;
} {
  const app = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => getFor(pageId),
    () => getFor(pageId),
  );
  const set = <K extends keyof PageAppearance>(key: K, value: PageAppearance[K]) => {
    setFor(pageId, key, value);
  };
  return { app, set };
}

/** Test hook — clears the in-memory cache. Never call from product code. */
export function __resetPageAppearanceForTest(): void {
  cache.clear();
  emit();
}
