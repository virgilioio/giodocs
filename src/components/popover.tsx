import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Minimal popover: renders trigger; on click, shows content absolutely below
 * with click-outside + Escape to close. Not portalled — sufficient for cell popovers.
 */
export function Popover({
  trigger,
  children,
  align = "start",
  width = 220,
}: {
  trigger: (props: { open: boolean; onClick: () => void; ref: React.Ref<HTMLButtonElement> }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-block">
      {trigger({ open, onClick: () => setOpen((v) => !v), ref: btnRef })}
      {open && (
        <div
          style={{ width, [align === "end" ? "right" : "left"]: 0 }}
          className="absolute top-full z-40 mt-1 rounded-lg border border-line bg-surface p-1 shadow-popover animate-popIn"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
