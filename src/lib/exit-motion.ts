/**
 * Exit animations for hand-rolled overlays.
 *
 * Gio Docs' menus, popovers and dialogs are plain conditionally rendered
 * elements, so React removes them the instant they close. Rather than thread
 * "closing" state through every parent, an overlay opts in with a ref:
 *
 *   <div ref={exitRef("pop")} className="animate-popIn" …>
 *
 * When React actually removes that element, a visual copy is put back where
 * it was and plays the exit (120ms for menus, 150ms for dialogs), then is
 * removed. The copy is inert: aria-hidden, no pointer events, no focus.
 *
 * It only fires on a real removal. A re-render, a ref swap or React's
 * StrictMode double-mount leave the element connected, so nothing happens.
 *
 * Kinds:
 *   pop    — menus and popovers: scale .96 + fade, keeps its transform-origin.
 *   dialog — a dialog card: scale .96 + fade from its centre. If the element
 *            is a scrim that contains the card, mark the card with
 *            data-motion-card and the scrim fades while the card scales.
 *   fade   — scrims, bars, anything that should only fade.
 *   drawer — a side panel: slides back out to the right (240ms).
 *   sheet  — a bottom sheet (phones): slides back down (240ms).
 *   rail   — the sidebar over the page (tablets): slides back left (240ms).
 *
 * Reduced motion keeps the fade and drops the scale.
 */

export type ExitKind = "pop" | "dialog" | "fade" | "drawer" | "sheet" | "rail";

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const EASE_DRAWER = "cubic-bezier(0.32, 0.72, 0, 1)";

const EXIT: Record<ExitKind, { name: string; ms: number; ease?: string }> = {
  pop: { name: "popOut", ms: 120 },
  dialog: { name: "dialogOut", ms: 150 },
  fade: { name: "fadeOut", ms: 120 },
  drawer: { name: "drawerOut", ms: 240, ease: EASE_DRAWER },
  sheet: { name: "sheetOut", ms: 240, ease: EASE_DRAWER },
  rail: { name: "railOut", ms: 240, ease: EASE_DRAWER },
};

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function play(el: HTMLElement, name: string, ms: number, ease = EASE_OUT) {
  el.style.animation = `${name} ${ms}ms ${ease} forwards`;
}

/** Put a copy of `node` back in `parent` and play its exit. */
export function playExit(
  node: HTMLElement,
  parent: Node,
  next: Node | null,
  kind: ExitKind,
) {
  if (!parent.isConnected || typeof document === "undefined") return;
  // Unit tests query document.body directly; a lingering copy would match.
  if (import.meta.env.MODE === "test") return;
  const reduce = reducedMotion();
  const spec = EXIT[kind];
  const ghost = node.cloneNode(true) as HTMLElement;
  ghost.setAttribute("aria-hidden", "true");
  ghost.setAttribute("inert", "");
  ghost.removeAttribute("id");
  ghost.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  ghost.style.pointerEvents = "none";
  ghost.dataset.exitGhost = "";
  if (next && next.parentNode === parent) parent.insertBefore(ghost, next);
  else parent.appendChild(ghost);
  // A scrolled list would jump to the top in the copy.
  if (node.scrollTop) ghost.scrollTop = node.scrollTop;
  // A fresh copy would replay its children's enter animations.
  ghost
    .querySelectorAll<HTMLElement>('[class*="animate-"]')
    .forEach((el) => (el.style.animation = "none"));

  const card =
    kind === "dialog" ? ghost.querySelector<HTMLElement>("[data-motion-card]") : null;
  if (card) {
    play(ghost, "fadeOut", spec.ms);
    play(card, reduce ? "fadeOut" : "dialogOut", spec.ms);
  } else {
    play(ghost, reduce ? "fadeOut" : spec.name, spec.ms, spec.ease);
  }

  let done = false;
  const remove = () => {
    if (done) return;
    done = true;
    ghost.remove();
  };
  ghost.addEventListener("animationend", (e) => {
    if (e.target === ghost) remove();
  });
  window.setTimeout(remove, spec.ms + 80);
}

/**
 * A ref callback (React 19 cleanup form) that plays `kind` when the element
 * is removed. Pass extra refs to keep them pointed at the element.
 */
export function exitRef<T extends HTMLElement>(
  kind: ExitKind,
  ...refs: Array<React.Ref<T> | undefined>
): (node: T | null) => (() => void) | void {
  return (node) => {
    for (const r of refs) setRef(r, node);
    if (!node) return;
    return () => {
      const parent = node.parentNode;
      const next = node.nextSibling;
      // React detaches the element after running ref cleanups. Check once the
      // commit is over: still connected means this was a re-render (a new
      // callback), not a removal. Only then clear the other refs, so code
      // reading them mid-commit never sees a transient null.
      queueMicrotask(() => {
        if (node.isConnected) return;
        for (const r of refs) {
          if (r && typeof r === "object" && r.current !== node) continue;
          setRef(r, null);
        }
        if (parent) playExit(node, parent, next, kind);
      });
    };
  };
}

const cache = new Map<ExitKind, (node: HTMLElement | null) => (() => void) | void>();

/** A stable exit ref for elements that need no other ref. */
export function exitOnly(kind: ExitKind) {
  let r = cache.get(kind);
  if (!r) {
    r = exitRef<HTMLElement>(kind);
    cache.set(kind, r);
  }
  return r;
}

function setRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else (ref as React.MutableRefObject<T | null>).current = value;
}
