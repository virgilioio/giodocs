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
      // Persist the migration so we only run it once per user. Writes are
      // safe here — this is client-only code and the effect below would
      // write the same object on the next render anyway.
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

type Ctx = {
  prefs: Prefs;
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
};

const PrefsCtx = createContext<Ctx | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(() => readStored());

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  }, [prefs]);

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
    }),
    [prefs],
  );

  return <PrefsCtx.Provider value={value}>{children}</PrefsCtx.Provider>;
}

export function usePrefs(): Ctx {
  const ctx = useContext(PrefsCtx);
  if (!ctx) throw new Error("usePrefs must be used within <PreferencesProvider>");
  return ctx;
}
