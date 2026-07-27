// Per-page, per-device appearance overrides. Never touches the database and
// never rides on global Preferences — this is why a serif setting on page A
// does not leak to page B.

import { useCallback, useEffect, useState } from "react";

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

function read(pageId: string): PageAppearance {
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

export function usePageAppearance(pageId: string): {
  app: PageAppearance;
  set: <K extends keyof PageAppearance>(key: K, value: PageAppearance[K]) => void;
} {
  const [app, setApp] = useState<PageAppearance>(() => read(pageId));

  // Re-read when the page changes.
  useEffect(() => {
    setApp(read(pageId));
  }, [pageId]);

  // Sync across tabs / other components on the same page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === keyFor(pageId)) setApp(read(pageId));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [pageId]);

  const set = useCallback(
    <K extends keyof PageAppearance>(key: K, value: PageAppearance[K]) => {
      setApp((prev) => {
        const next = { ...prev, [key]: value };
        try {
          window.localStorage.setItem(keyFor(pageId), JSON.stringify(next));
          // Broadcast to any other mount that reads the same page.
          window.dispatchEvent(
            new StorageEvent("storage", { key: keyFor(pageId) }),
          );
        } catch {
          /* ignore quota / disabled storage */
        }
        return next;
      });
    },
    [pageId],
  );

  return { app, set };
}
