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
  explainQuery: false,
  showSidebarCounts: true,
};

const STORAGE_KEY = "gio.prefs";

function readStored(): Prefs {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULT, ...parsed };
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
