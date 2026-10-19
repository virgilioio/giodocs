import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useAppVersionCheck } from "@/hooks/use-app-version-check";

/**
 * "A new version is ready", exactly as Gio ATS shows it (Allan, 2026-10-19):
 * Gio ATS's ink Sonner toast, rebuilt to its measurements rather than adding
 * Sonner next to Gio Docs' own toasts. Bottom-left, 24px from the page beside
 * the rail (--gio-content-left, set by AppShell) and from the bottom; on
 * phones it spans the width above the floating bars. It stays until you
 * choose Refresh or Later (Later hides it for this version only); a swipe
 * down counts as Later. It rises in and leaves the way it came, 400ms, like
 * Sonner. The look lives in styles.css (UPDATE TOAST).
 */

/** Sonner's swipe distance before a release dismisses the toast. */
const SWIPE_THRESHOLD = 20;
/** Sonner's enter / exit transition. */
const EXIT_MS = 400;

export function AppUpdateToast() {
  const { updateAvailable, refresh, dismiss } = useAppVersionCheck();
  return <UpdateToastView open={updateAvailable} onRefresh={refresh} onLater={dismiss} />;
}

export function UpdateToastView({
  open,
  onRefresh,
  onLater,
}: {
  open: boolean;
  onRefresh: () => void;
  onLater: () => void;
}) {
  // `shown` keeps it in the DOM through the exit; `mounted` drives the slide.
  const [shown, setShown] = useState(open);
  const [mounted, setMounted] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setShown(true);
      // Two frames: paint it below the edge first, then let it rise.
      let b = 0;
      const a = requestAnimationFrame(() => {
        b = requestAnimationFrame(() => setMounted(true));
      });
      return () => {
        cancelAnimationFrame(a);
        cancelAnimationFrame(b);
      };
    }
    setMounted(false);
    const t = window.setTimeout(() => setShown(false), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!shown) return null;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    start.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current === null) return;
    setDrag(Math.max(0, e.clientY - start.current));
  };
  const onPointerUp = () => {
    if (start.current === null) return;
    start.current = null;
    if ((drag ?? 0) >= SWIPE_THRESHOLD) onLater();
    setDrag(null);
  };

  return (
    <section aria-label="Notifications" className="gio-update-toaster">
      <div
        role="status"
        aria-live="polite"
        data-update-toast
        data-mounted={mounted ? "true" : "false"}
        data-swiping={drag !== null ? "true" : undefined}
        className="gio-update-toast"
        style={drag !== null ? { transform: `translateY(${drag}px)` } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div data-content>
          <div data-title>A new version of Gio Docs</div>
          <div data-description>Refresh to load it. Save what you’re typing first.</div>
        </div>
        <button type="button" data-button data-cancel onClick={onLater}>
          Later
        </button>
        <button type="button" data-button onClick={onRefresh}>
          Refresh
        </button>
      </div>
    </section>
  );
}
