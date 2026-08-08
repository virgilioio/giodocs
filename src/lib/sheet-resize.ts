/**
 * CHUNK 8 — the sheet BLOCK resize, as pure arithmetic.
 *
 * ⚠ THE CLAMP IS THE WHOLE POINT OF THIS MODULE.
 * The width delta (`bw`) bleeds symmetrically into the page gutters, so a
 * drag pushes the block's RIGHT EDGE outward by bw/2 beyond the text
 * column. Clamped against a CONSTANT (the spec's author shipped
 * Math.min(560, …)) that edge — and therefore the grip itself — ends up
 * PAST the viewport on a narrow window: unreachable, so it can neither be
 * dragged back nor double-clicked to reset, and the page silently becomes
 * horizontally scrollable, sliding every prose block sideways.
 *
 * So the ceiling is derived from the LIVE container measured at pointerdown
 * (`room`) and the block's own natural width, never from a literal. The
 * component measures; this module decides. That split is what makes the
 * clamp testable without a DOM.
 *
 * This is the FOURTH resize interaction in the codebase and they are
 * deliberately all different — table columns (pixels, independent), page
 * columns (fractions, paired), sheet columns (pixels, independent), and
 * this one (a delta bleeding into measured gutters). Do not unify them.
 */

/** Breathing room kept to the right of the block so the grip stays
 *  grabbable at maximum width. Anything smaller and the pointer target
 *  touches the viewport edge. */
export const GRIP_PAD = 20;

/** The smallest useful scrolling viewport: a header row plus a row or two.
 *  Below this the block reads as a broken element rather than a short one. */
export const MIN_BH = 80;

/** The largest width delta that keeps the block's right edge at least
 *  GRIP_PAD inside the measured container. Never negative: in a container
 *  narrower than the block's natural width the answer is "no bleed". */
export function maxBw(room: number, naturalWidth: number, pad = GRIP_PAD): number {
  return Math.max(0, room - naturalWidth - pad);
}

/** The width delta a drag should APPLY, clamped against the live container.
 *  Clamped here — during the drag — so the ceiling is FELT rather than
 *  snapping back on release. */
export function clampBw(args: {
  room: number;
  naturalWidth: number;
  startBw: number;
  /** Pointer travel on X since pointerdown. */
  dx: number;
  pad?: number;
}): number {
  const { room, naturalWidth, startBw, dx, pad = GRIP_PAD } = args;
  // The grip sits on the right edge, which moves at HALF the width delta
  // because the bleed is symmetric — so a pixel of pointer travel buys two
  // pixels of width.
  const requested = startBw + dx * 2;
  const ceiling = maxBw(room, naturalWidth, pad);
  if (!Number.isFinite(requested)) return 0;
  return Math.max(0, Math.min(ceiling, Math.round(requested)));
}

/** The height a drag should apply. 0 means "show every row" — the same
 *  value double-click resets to, so there is one representation of
 *  unconstrained, not two. */
export function clampBh(args: {
  startBh: number;
  dy: number;
  /** The height the grid would occupy with every row visible. */
  naturalHeight: number;
  min?: number;
}): number {
  const { startBh, dy, naturalHeight, min = MIN_BH } = args;
  const requested = Math.round((startBh > 0 ? startBh : naturalHeight) + dy);
  if (!Number.isFinite(requested)) return 0;
  // Dragged past the last row there is nothing left to reveal, so the
  // constraint is dropped entirely rather than pinned one pixel above it.
  if (requested >= naturalHeight) return 0;
  return Math.max(min, requested);
}

/** The bleed geometry. Width applies at PAGE SCOPE ONLY: inside a column or
 *  a callout there are no gutters to bleed into, so bw is ignored there
 *  while bh still applies. */
export function resizeStyle(args: {
  bw?: number;
  bh?: number;
  pageScope: boolean;
}): { width?: string; marginLeft?: number; flexShrink?: number; maxHeight?: number } {
  const bw = args.pageScope && typeof args.bw === "number" && args.bw > 0 ? Math.round(args.bw) : 0;
  const bh = typeof args.bh === "number" && args.bh > 0 ? Math.round(args.bh) : 0;
  const out: {
    width?: string;
    marginLeft?: number;
    flexShrink?: number;
    maxHeight?: number;
  } = {};
  if (bw > 0) {
    out.width = `calc(100% + ${bw}px)`;
    out.marginLeft = -bw / 2;
    out.flexShrink = 0;
  }
  if (bh > 0) out.maxHeight = bh;
  return out;
}

/** The live readout while dragging. Width reads as a DELTA (it is one);
 *  height reads as an absolute, because that is the number a reader of the
 *  page perceives. */
export function readoutText(bw: number, bh: number): string {
  const parts: string[] = [];
  parts.push(bw > 0 ? `+${Math.round(bw)}px wide` : "full width");
  parts.push(bh > 0 ? `${Math.round(bh)}px tall` : "all rows");
  return parts.join(" · ");
}
