import { useSyncExternalStore } from "react";

/* Screen-size rules (2026-10-11, the phone layout):
 * - phone: narrower than 768px — the phone frame (top tabs, Home as the
 *   navigation, floating buttons and bars, sheets for menus).
 * - compact: narrower than 1120px — the desktop frame, with the sidebar
 *   over the page instead of beside it. */

export const PHONE_QUERY = "(max-width: 767px)";
export const COMPACT_QUERY = "(max-width: 1119px)";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

export const useIsPhone = () => useMediaQuery(PHONE_QUERY);
export const useIsCompact = () => useMediaQuery(COMPACT_QUERY);
