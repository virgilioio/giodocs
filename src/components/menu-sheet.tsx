import { useRef, useState, type ReactNode, type Ref } from "react";
import { exitOnly, exitRef } from "@/lib/exit-motion";

/* On a phone every menu and popover opens as a sheet from the bottom
 * (2026-10-11): the same contents as on desktop, full width, with a handle
 * to drag it down, at phone sizes (.gio-menu-sheet in styles.css). The
 * caller portals it and handles outside clicks as it does for the menu. */

export function MenuSheetFrame({
  onClose,
  panelRef,
  role,
  zIndex,
  children,
}: {
  onClose: () => void;
  /** The caller's own panel ref (outside-click checks, measuring). */
  panelRef?: Ref<HTMLDivElement>;
  role?: string;
  /** A CSS z-index for the panel; the scrim sits one below. */
  zIndex: string | number;
  children: ReactNode;
}) {
  const own = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  return (
    <>
      <div
        ref={exitOnly("fade")}
        aria-hidden
        className="animate-fadeIn"
        onMouseDown={onClose}
        style={{ position: "fixed", inset: 0, zIndex: `calc(${zIndex} - 1)`, background: "rgba(13,13,9,.28)" }}
      />
      <div
        ref={exitRef("sheet", own, panelRef)}
        role={role}
        data-menu-sheet
        onMouseDown={(e) => e.stopPropagation()}
        className="gio-sheet gio-menu-sheet fixed inset-x-0 bottom-0 flex flex-col"
        style={{
          zIndex,
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: start.current === null && drag === 0 ? "transform 240ms var(--ease-drawer)" : "none",
        }}
      >
        <div
          className="shrink-0 touch-none"
          style={{ padding: "10px 0 6px" }}
          onPointerDown={(e) => {
            start.current = e.clientY;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (start.current !== null) setDrag(Math.max(0, e.clientY - start.current));
          }}
          onPointerUp={() => {
            const d = drag;
            start.current = null;
            if (d > 80) onClose();
            else setDrag(0);
          }}
          onPointerCancel={() => {
            start.current = null;
            setDrag(0);
          }}
        >
          <div className="mx-auto rounded-full bg-lineStrong" style={{ width: 40, height: 5 }} />
        </div>
        <div className="gio-menu-sheet-body min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
