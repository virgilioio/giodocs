import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export type ToastAction = { label: string; onClick: () => void };
export type Toast = {
  id: number;
  message: string;
  action?: ToastAction;
};

type ToastInput = string | { message: string; action?: ToastAction; durationMs?: number };

const ToastCtx = createContext<{ push: (input: ToastInput) => void } | null>(null);

let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((input: ToastInput) => {
    const id = seq++;
    const t: Toast =
      typeof input === "string"
        ? { id, message: input }
        : { id, message: input.message, action: input.action };
    const durationMs =
      typeof input === "string"
        ? 3500
        : (input.durationMs ?? (input.action ? 10_000 : 3500));
    setItems((prev) => [...prev, t].slice(-3));
    window.setTimeout(() => {
      setItems((prev) => prev.filter((x) => x.id !== id));
    }, durationMs);
  }, []);

  const dismiss = (id: number) =>
    setItems((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[var(--z-toast)] flex flex-col items-center gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-md items-center gap-3 rounded-lg bg-btn px-4 py-2 text-meta text-btnFg shadow-toast animate-toastUp"
          >
            <span>{t.message}</span>
            {t.action ? (
              <button
                type="button"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
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
