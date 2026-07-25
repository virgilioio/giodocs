import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export type Toast = { id: number; message: string };

const ToastCtx = createContext<{ push: (msg: string) => void } | null>(null);

let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((message: string) => {
    const id = seq++;
    setItems((prev) => [...prev, { id, message }].slice(-3));
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto max-w-md rounded-lg bg-noir px-4 py-2 text-meta text-canvas shadow-toast animate-toastUp"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  return ctx ?? { push: (_: string) => {} };
}
