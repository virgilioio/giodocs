import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Popover — a trigger button plus a portalled panel.
 *
 * The panel renders through `createPortal(document.body)` at `position: fixed`
 * so it always escapes any ancestor's `overflow: hidden` (table cells, sidebar
 * scrollers, etc.). Position is computed from the trigger's bounding rect and
 * refreshed on scroll and resize while open. The panel flips vertically when
 * there is not enough space below, and is clamped horizontally to the viewport
 * with an 8px margin.
 *
 * Public API (`trigger`, `children`, `align`, `width`, `onOpenChange`) is
 * unchanged. Outside-click closes; clicks inside the portalled panel count as
 * inside. Escape closes.
 */
export function Popover({
  trigger,
  children,
  align = "start",
  width = 220,
  onOpenChange,
}: {
  trigger: (props: {
    open: boolean;
    onClick: () => void;
    ref: React.Ref<HTMLButtonElement>;
  }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  width?: number;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  // Position + reposition on scroll/resize while open.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const btn = btnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const margin = 8;
      const gap = 4;
      const panel = panelRef.current;
      const panelH = panel?.offsetHeight ?? 320;

      // Horizontal: align to trigger's start or end, then clamp to viewport.
      let left = align === "end" ? r.right - width : r.left;
      if (left < margin) left = margin;
      const maxLeft = window.innerWidth - width - margin;
      if (left > maxLeft) left = Math.max(margin, maxLeft);

      // Vertical: prefer below, flip above when there is no room.
      let top = r.bottom + gap;
      if (
        top + panelH + margin > window.innerHeight &&
        r.top - gap - panelH > margin
      ) {
        top = r.top - gap - panelH;
      }
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align, width]);

  // Outside-click + Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (btnRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
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
    <>
      {trigger({ open, onClick: () => setOpen((v) => !v), ref: btnRef })}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              style={{
                position: "fixed",
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                width,
                zIndex: 90,
                visibility: pos ? "visible" : "hidden",
              }}
              className="rounded-lg border border-line bg-surface p-1 shadow-popover animate-popIn"
            >
              {children(close)}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
