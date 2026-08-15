/**
 * useDragSession — the ONE drag primitive for this app.
 *
 * WHAT THIS OWNS (never re-implement any of it in a caller):
 *   • pointer capture and the pointermove/up/cancel lifecycle
 *   • the movement threshold, so a press that does not move stays a plain
 *     click and the caller's own onClick still fires
 *   • swallowing exactly ONE click after a real drag, so a drop never also
 *     triggers the click handler the press would have
 *   • the ghost element: a CLONE appended to document.body, following the
 *     pointer by transform only
 *   • edge autoscroll on a rAF loop, using edgeVelocity from
 *     src/lib/drag-scroll.ts, re-running the hit test after each scroll step
 *     so scrolling EXTENDS the drag instead of freezing the target
 *   • cancellation on Escape, pointercancel, blur and visibilitychange
 *   • unconditional cleanup — ghost removed, rAF cancelled, capture
 *     released, body userSelect restored — on commit, cancel AND unmount
 *
 * WHAT THE CALLER OWNS (passed in):
 *   • hitTest: where the pointer currently points, in the caller's own terms
 *   • commit: what a drop means
 *   • makeGhost: what the in-flight thing looks like
 *   • scrollTargets: which containers may autoscroll
 *
 * WHY HIT-TESTING IS DELIBERATELY NOT SHARED: the block drag's
 * containment-wins `hitContainer` and the table's index-from-measured-metrics
 * are different problems with different correctness rules. Merging them would
 * break the container logic that already works, so the session is shared and
 * the hit test is not. Do not "unify" them.
 *
 * STATUS: the table row/column reorder is migrated. The block drag
 * (`beginDrag`/`computeGap`/`hitContainer`), the marquee, the table's
 * column-resize grip and the sheet fill handle are STILL on their own
 * bespoke implementations, pending migration. If you are adding a new drag:
 * use this hook. If you are touching one of those four: migrating it here is
 * the intended direction.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { edgeVelocity } from "@/lib/drag-scroll";

export type DragPoint = { x: number; y: number };

export type DragSessionOptions<T, P> = {
  /** px of movement before a press becomes a drag. Default 4. */
  threshold?: number;
  hitTest: (pt: DragPoint, payload: P) => T | null;
  commit: (target: T, payload: P) => void;
  makeGhost?: (payload: P) => HTMLElement | null;
  scrollTargets?: (payload: P) => (HTMLElement | null | undefined)[];
};

export type DragSession<T, P> = {
  begin: (ev: React.PointerEvent, payload: P) => void;
  active: boolean;
  target: T | null;
};

/** z-index above every app tier (menus/popovers) so the ghost is never
 *  occluded by the surface it is being dragged over. */
const GHOST_Z = 9999;

export function useDragSession<T, P>(
  opts: DragSessionOptions<T, P>,
): DragSession<T, P> {
  const threshold = opts.threshold ?? 4;

  // Options are re-created every render; refs keep the live listeners bound
  // to the newest closures without tearing down the session.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [active, setActive] = useState(false);
  const [target, setTarget] = useState<T | null>(null);

  const s = useRef<{
    payload: P;
    pointerId: number;
    node: HTMLElement;
    startX: number;
    startY: number;
    moved: boolean;
    pt: DragPoint;
    ghost: HTMLElement | null;
    ghostOff: DragPoint;
    raf: number | null;
    target: T | null;
    userSelect: string;
  } | null>(null);

  /** Consumes exactly one click after a real drag, then removes itself.
   *  It is also disarmed by the NEXT press and by unmount — a swallow that
   *  outlives its own gesture would eat an unrelated click, which reads as
   *  "the menu randomly doesn't open". */
  const disarmRef = useRef<(() => void) | null>(null);
  const disarmClickSwallow = useCallback(() => {
    disarmRef.current?.();
    disarmRef.current = null;
  }, []);
  const armClickSwallow = useCallback(() => {
    disarmClickSwallow();
    const onClick = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
      disarmClickSwallow();
    };
    document.addEventListener("click", onClick, true);
    // Safety valve: if no click ever arrives (touch, cancelled gesture) the
    // listener must not linger into the next interaction.
    const t = window.setTimeout(() => disarmClickSwallow(), 400);
    disarmRef.current = () => {
      window.clearTimeout(t);
      document.removeEventListener("click", onClick, true);
    };
  }, [disarmClickSwallow]);


  const teardown = useCallback((swallowClick: boolean) => {
    const d = s.current;
    s.current = null;
    if (!d) return;
    if (d.raf != null) cancelAnimationFrame(d.raf);
    if (d.ghost?.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    try {
      d.node.releasePointerCapture?.(d.pointerId);
    } catch {
      /* pointer already gone — nothing to release */
    }
    document.body.style.userSelect = d.userSelect;
    if (swallowClick && d.moved) armClickSwallow();
    setActive(false);
    setTarget(null);
  }, [armClickSwallow]);

  const moveGhost = useCallback(() => {
    const d = s.current;
    if (!d?.ghost) return;
    const x = d.pt.x + d.ghostOff.x;
    const y = d.pt.y + d.ghostOff.y;
    d.ghost.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.02)`;
  }, []);

  const runHit = useCallback(() => {
    const d = s.current;
    if (!d) return;
    const next = optsRef.current.hitTest(d.pt, d.payload);
    d.target = next;
    setTarget(next);
  }, []);

  const startGhost = useCallback(() => {
    const d = s.current;
    if (!d) return;
    const make = optsRef.current.makeGhost;
    const el = make ? make(d.payload) : null;
    if (!el) return;
    el.style.position = "fixed";
    el.style.left = "0px";
    el.style.top = "0px";
    el.style.margin = "0";
    el.style.pointerEvents = "none";
    el.style.opacity = ".6";
    el.style.zIndex = String(GHOST_Z);
    el.style.boxShadow = "var(--shadow-popover)";
    el.style.willChange = "transform";
    document.body.appendChild(el);
    d.ghost = el;
    moveGhost();
  }, [moveGhost]);

  const tick = useCallback(() => {
    const d = s.current;
    if (!d) return;
    const targets = optsRef.current.scrollTargets?.(d.payload) ?? [];
    let scrolled = false;
    for (const el of targets) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const v = edgeVelocity(d.pt, r);
      if (v.dx) {
        const before = el.scrollLeft;
        el.scrollLeft = before + v.dx;
        if (el.scrollLeft !== before) scrolled = true;
      }
      if (v.dy) {
        const before = el.scrollTop;
        el.scrollTop = before + v.dy;
        if (el.scrollTop !== before) scrolled = true;
      }
    }
    // Scrolling moves the content under a stationary cursor, so the target
    // must be recomputed or the drag appears to freeze.
    if (scrolled) runHit();
    d.raf = requestAnimationFrame(tick);
  }, [runHit]);

  const begin = useCallback(
    (ev: React.PointerEvent, payload: P) => {
      if (s.current) return;
      const node = ev.currentTarget as HTMLElement;
      try {
        node.setPointerCapture?.(ev.pointerId);
      } catch {
        /* non-mouse pointers work without capture */
      }
      const r = node.getBoundingClientRect();
      s.current = {
        payload,
        pointerId: ev.pointerId,
        node,
        startX: ev.clientX,
        startY: ev.clientY,
        moved: false,
        pt: { x: ev.clientX, y: ev.clientY },
        ghost: null,
        ghostOff: { x: r.left - ev.clientX, y: r.top - ev.clientY },
        raf: null,
        target: null,
        userSelect: document.body.style.userSelect,
      };
      ev.preventDefault();
      ev.stopPropagation();
    },
    [],
  );

  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      const d = s.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      d.pt = { x: ev.clientX, y: ev.clientY };
      if (!d.moved) {
        const dx = ev.clientX - d.startX;
        const dy = ev.clientY - d.startY;
        if (Math.sqrt(dx * dx + dy * dy) < threshold) return;
        d.moved = true;
        document.body.style.userSelect = "none";
        setActive(true);
        startGhost();
        d.raf = requestAnimationFrame(tick);
      }
      moveGhost();
      runHit();
    };
    const onUp = (ev: PointerEvent) => {
      const d = s.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      const moved = d.moved;
      const hit = d.target;
      const payload = d.payload;
      teardown(true);
      if (moved && hit != null) optsRef.current.commit(hit, payload);
    };
    const onCancel = () => {
      if (s.current) teardown(true);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !s.current) return;
      ev.preventDefault();
      ev.stopPropagation();
      teardown(true);
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("blur", onCancel);
    document.addEventListener("visibilitychange", onCancel);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("blur", onCancel);
      document.removeEventListener("visibilitychange", onCancel);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [moveGhost, runHit, startGhost, teardown, threshold, tick]);

  // Unmount mid-drag must not leave a ghost or a rAF on the page.
  useEffect(() => () => teardown(false), [teardown]);

  return { begin, active, target };
}
