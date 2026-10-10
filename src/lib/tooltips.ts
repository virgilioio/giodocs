/**
 * Styled tooltips for every `title` in the app.
 *
 * Gio Docs labels its icon buttons and truncated names with plain `title`
 * attributes. The browser shows those late, unstyled and sometimes twice.
 * This installer takes over on mouse hover only:
 *
 *   - Controls (buttons, links, anything with a role or tabindex) show their
 *     title after 400ms. Once one tooltip has shown, the next opens at once
 *     with no animation, for 400ms after the last one closed.
 *   - Plain text (a truncated page name with its full value in `title`)
 *     shows only when the text is actually cut off.
 *   - While the tooltip is up the `title` attribute is parked in
 *     data-gio-title, so the native one can't double up; it is put back on
 *     leave, so React and assistive tech see the original markup.
 *
 * Keyboard and touch never open these. Nothing to do at call sites: keep
 * writing `title` (and `aria-label` on icon-only controls).
 */

const DELAY = 400;
const SKIP = 400;
const GAP = 6;
const MARGIN = 8;

const CONTROL =
  'button, a[href], input, select, textarea, summary, [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [tabindex]';

function isCut(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

/** A child that truncates (ellipsis/clamp) and is cut. */
function cutDescendant(el: HTMLElement): boolean {
  if (isCut(el)) return true;
  for (const c of el.querySelectorAll<HTMLElement>("*")) {
    const cs = getComputedStyle(c);
    if (
      (cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none") &&
      isCut(c)
    )
      return true;
  }
  return false;
}

export function installTooltips(): () => void {
  if (typeof document === "undefined") return () => {};

  let tip: HTMLDivElement | null = null;
  let target: HTMLElement | null = null;
  let timer: number | null = null;
  let lastHidden = 0;

  const ensureTip = () => {
    if (tip) return tip;
    tip = document.createElement("div");
    tip.className = "gio-tooltip";
    tip.setAttribute("role", "tooltip");
    tip.setAttribute("aria-hidden", "true");
    document.body.appendChild(tip);
    return tip;
  };

  const restore = () => {
    if (!target) return;
    const parked = target.getAttribute("data-gio-title");
    if (parked != null) {
      // React may have set a new title meanwhile; keep that one.
      if (!target.hasAttribute("title")) target.setAttribute("title", parked);
      target.removeAttribute("data-gio-title");
    }
  };

  const hide = () => {
    if (timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (tip && tip.dataset.open === "true") {
      tip.dataset.open = "false";
      lastHidden = performance.now();
    }
    restore();
    target = null;
  };

  const show = (el: HTMLElement, text: string, instant: boolean) => {
    const t = ensureTip();
    t.textContent = text;
    t.dataset.instant = instant ? "true" : "false";
    t.dataset.open = "true";
    const r = el.getBoundingClientRect();
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(MARGIN, Math.min(window.innerWidth - w - MARGIN, left));
    // Below the control; above when it would leave the window.
    let top = r.bottom + GAP;
    let origin = "top";
    if (top + h + MARGIN > window.innerHeight) {
      top = r.top - GAP - h;
      origin = "bottom";
    }
    t.style.left = `${Math.round(left)}px`;
    t.style.top = `${Math.round(top)}px`;
    t.style.transformOrigin = `${origin} center`;
  };

  const onOver = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const from = e.target as Element | null;
    const el = from?.closest?.<HTMLElement>("[title], [data-gio-title]") ?? null;
    if (el === target) return;
    hide();
    if (!el) return;
    if (el.closest("[data-exit-ghost]")) return;
    const text = (el.getAttribute("title") ?? el.getAttribute("data-gio-title") ?? "").trim();
    if (!text) return;
    const control = el.matches(CONTROL);
    // Text that is fully visible (or a control whose own label already says
    // it) gets no tooltip at all, not even the browser's.
    const wanted =
      (control && el.textContent?.trim() !== text) || cutDescendant(el);
    target = el;
    if (el.hasAttribute("title")) {
      el.setAttribute("data-gio-title", el.getAttribute("title") ?? text);
      el.removeAttribute("title");
    }
    if (!wanted) return;
    const instant = performance.now() - lastHidden < SKIP;
    if (instant) show(el, text, true);
    else timer = window.setTimeout(() => {
      timer = null;
      if (target === el && el.isConnected) show(el, text, false);
    }, DELAY);
  };

  const onOut = (e: PointerEvent) => {
    if (!target) return;
    const to = e.relatedTarget as Node | null;
    if (to && target.contains(to)) return;
    hide();
  };

  const onDismiss = () => {
    if (target) hide();
  };

  document.addEventListener("pointerover", onOver, true);
  document.addEventListener("pointerout", onOut, true);
  document.addEventListener("pointerdown", onDismiss, true);
  document.addEventListener("keydown", onDismiss, true);
  window.addEventListener("scroll", onDismiss, true);
  window.addEventListener("blur", onDismiss);

  return () => {
    hide();
    document.removeEventListener("pointerover", onOver, true);
    document.removeEventListener("pointerout", onOut, true);
    document.removeEventListener("pointerdown", onDismiss, true);
    document.removeEventListener("keydown", onDismiss, true);
    window.removeEventListener("scroll", onDismiss, true);
    window.removeEventListener("blur", onDismiss);
    tip?.remove();
    tip = null;
  };
}
