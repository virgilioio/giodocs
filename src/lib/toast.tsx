import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastAction = { label: string; onClick: () => void };
export type Toast = {
  id: number;
  message: string;
  action?: ToastAction;
};

type ToastInput = string | { message: string; action?: ToastAction; durationMs?: number };

const ToastCtx = createContext<{ push: (input: ToastInput) => void } | null>(null);

let seq = 1;

const MAX_VISIBLE = 3;
const EXIT_MS = 200;
const MOVE_MS = 240;
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

type Item = Toast & { leaving?: boolean };
type Timer = { remaining: number; start: number; handle: number | null };

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Toasts rise in at the bottom centre, leave the way they came, and pause
 * while the pointer is over them or the tab is hidden. When one leaves, the
 * others glide into place instead of jumping.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const timers = useRef(new Map<number, Timer>());
  const paused = useRef(false);
  /** The toast under the pointer, if any. */
  const hovered = useRef<number | null>(null);
  const nodes = useRef(new Map<number, HTMLDivElement>());
  const lastTops = useRef(new Map<number, number>());

  const remove = useCallback((id: number) => {
    timers.current.delete(id);
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);
  const setPausedRef = useRef<(next: boolean) => void>(() => {});

  const leave = useCallback(
    (id: number) => {
      const t = timers.current.get(id);
      if (t?.handle != null) window.clearTimeout(t.handle);
      timers.current.delete(id);
      setItems((prev) =>
        prev.map((x) => (x.id === id && !x.leaving ? { ...x, leaving: true } : x)),
      );
      // A toast leaving from under a still pointer gets no mouseleave; don't
      // stay paused because of it.
      if (hovered.current === id) {
        hovered.current = null;
        setPausedRef.current(document.hidden);
      }
      window.setTimeout(() => remove(id), reducedMotion() ? 0 : EXIT_MS);
    },
    [remove],
  );

  const run = useCallback(
    (id: number, t: Timer) => {
      t.start = Date.now();
      t.handle = window.setTimeout(() => leave(id), t.remaining);
    },
    [leave],
  );

  const setPaused = useCallback(
    (next: boolean) => {
      if (paused.current === next) return;
      paused.current = next;
      for (const [id, t] of timers.current) {
        if (next) {
          if (t.handle != null) window.clearTimeout(t.handle);
          t.handle = null;
          t.remaining = Math.max(0, t.remaining - (Date.now() - t.start));
        } else {
          run(id, t);
        }
      }
    },
    [run],
  );

  setPausedRef.current = setPaused;

  useEffect(() => {
    const onVis = () => setPaused(document.hidden || hovered.current !== null);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [setPaused]);

  const push = useCallback(
    (input: ToastInput) => {
      const id = seq++;
      const t: Toast =
        typeof input === "string"
          ? { id, message: input }
          : { id, message: input.message, action: input.action };
      const durationMs =
        typeof input === "string"
          ? 3500
          : (input.durationMs ?? (input.action ? 10_000 : 3500));
      setItems((prev) => {
        const live = prev.filter((x) => !x.leaving);
        const overflow = live.length - (MAX_VISIBLE - 1);
        if (overflow > 0) {
          const drop = new Set(live.slice(0, overflow).map((x) => x.id));
          queueMicrotask(() => drop.forEach((d) => leave(d)));
        }
        return [...prev, t];
      });
      const timer: Timer = { remaining: durationMs, start: Date.now(), handle: null };
      timers.current.set(id, timer);
      if (!paused.current) run(id, timer);
    },
    [leave, run],
  );

  // FLIP: toasts that moved because another arrived or left glide over.
  useLayoutEffect(() => {
    const reduce = reducedMotion();
    const next = new Map<number, number>();
    for (const [id, el] of nodes.current) {
      if (!el.isConnected) continue;
      const top = el.offsetTop;
      next.set(id, top);
      const before = lastTops.current.get(id);
      if (reduce || before === undefined || before === top) continue;
      el.animate(
        [{ transform: `translateY(${before - top}px)` }, { transform: "none" }],
        { duration: MOVE_MS, easing: EASE_OUT, composite: "add" },
      );
    }
    lastTops.current = next;
  }, [items]);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="gio-toasts pointer-events-none fixed inset-x-0 bottom-6 z-[var(--z-toast)] flex flex-col items-center gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            ref={(el) => {
              if (el) nodes.current.set(t.id, el);
              else nodes.current.delete(t.id);
            }}
            onMouseEnter={() => {
              hovered.current = t.id;
              setPaused(true);
            }}
            onMouseLeave={() => {
              if (hovered.current === t.id) hovered.current = null;
              setPaused(document.hidden || hovered.current !== null);
            }}
            aria-hidden={t.leaving ? true : undefined}
            className="pointer-events-auto flex max-w-md items-center gap-3 rounded-lg bg-btn px-4 py-2 text-meta text-btnFg shadow-toast animate-toastUp"
            style={
              t.leaving
                ? {
                    opacity: 0,
                    transform: reducedMotion() ? undefined : "translateY(12px)",
                    transition: `opacity ${EXIT_MS}ms ${EASE_OUT}, transform ${EXIT_MS}ms ${EASE_OUT}`,
                    pointerEvents: "none",
                  }
                : undefined
            }
          >
            <span>{t.message}</span>
            {t.action ? (
              <button
                type="button"
                onClick={() => {
                  t.action!.onClick();
                  leave(t.id);
                }}
                className="rounded-md px-2 py-0.5 text-meta font-bold text-btnFg hover:bg-white/10"
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  return ctx ?? { push: (_: ToastInput) => {} };
}
