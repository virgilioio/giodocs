import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type FontFamily = "default" | "serif" | "mono";
export type Density = "comfortable" | "compact";
export type DateFormatMode = "relative" | "absolute";
export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export type Prefs = {
  fontFamily: FontFamily;
  density: Density;
  dateFormat: DateFormatMode;
  explainQuery: boolean;
  showSidebarCounts: boolean;
};

const DEFAULT: Prefs = {
  fontFamily: "default",
  density: "comfortable",
  dateFormat: "relative",
  explainQuery: true,
  showSidebarCounts: true,
};

const STORAGE_KEY = "gio.prefs";
const THEME_KEY = "gio.theme";

/**
 * Preferences schema version. Bumped when we need a one-time correction to
 * every user's stored prefs (a merge over DEFAULT is not enough — stored
 * values win). Migrations run once in readStored() and rewrite storage.
 *
 * v2 — force explainQuery to true. B1 shipped with default=false which
 * persisted false into localStorage; B2 flipped the default to true, but
 * stored values still hid the sentence toolbar for anyone who touched the
 * app during that window.
 */
const PREFS_VERSION = 2;

function readStored(): Prefs {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<Prefs> & { prefsVersion?: number };
    const merged: Prefs = { ...DEFAULT, ...parsed };
    const version = typeof parsed.prefsVersion === "number" ? parsed.prefsVersion : 0;
    if (version < 2) {
      merged.explainQuery = true;
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...merged, prefsVersion: PREFS_VERSION }),
        );
      } catch {
        /* quota / disabled storage — the in-memory value is still correct */
      }
    }
    return merged;
  } catch {
    return DEFAULT;
  }
}

function readTheme(): ThemePref {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
    return "system";
  } catch {
    return "system";
  }
}

/** Pure resolver: given a preference and a matchMedia result, return the
 * resolved theme. Extracted so it can be reused (login, tests). */
export function resolveTheme(pref: ThemePref, prefersDark: boolean): ResolvedTheme {
  if (pref === "system") return prefersDark ? "dark" : "light";
  return pref;
}

type Ctx = {
  prefs: Prefs;
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  resolvedTheme: ResolvedTheme;
  systemPrefersDark: boolean;
};

const PrefsCtx = createContext<Ctx | null>(null);

function initialSystemDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(() => readStored());
  const [theme, setThemeState] = useState<ThemePref>(() => readTheme());
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => initialSystemDark());

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...prefs, prefsVersion: PREFS_VERSION }),
    );
  }, [prefs]);

  // Persist theme.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  // Subscribe once to system preference. State updates fire regardless of
  // current pref so `systemPrefersDark` (used by the help sentence) stays
  // truthful; but the DOM only flips when pref is "system".
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const resolvedTheme: ResolvedTheme = resolveTheme(theme, systemPrefersDark);

  // Apply the resolved theme to <html data-theme=…>. No transition here —
  // component-level transitions still animate their own properties normally.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.dataset.density = prefs.density;
    root.dataset.gioFont = prefs.fontFamily;
  }, [prefs.density, prefs.fontFamily]);

  const value = useMemo<Ctx>(
    () => ({
      prefs,
      set: (k, v) => setPrefs((prev) => ({ ...prev, [k]: v })),
      theme,
      setTheme: setThemeState,
      resolvedTheme,
      systemPrefersDark,
    }),
    [prefs, theme, resolvedTheme, systemPrefersDark],
  );

  return <PrefsCtx.Provider value={value}>{children}</PrefsCtx.Provider>;
}

export function usePrefs(): Ctx {
  const ctx = useContext(PrefsCtx);
  if (!ctx) throw new Error("usePrefs must be used within <PreferencesProvider>");
  return ctx;
}
