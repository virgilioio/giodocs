/**
 * Edge autoscroll velocity — pure geometry, no DOM APIs.
 *
 * Every drag in this app that can run off the edge of a scroll container
 * needs the same answer: "given where the pointer is and where the
 * container's box is, how fast should this thing scroll this frame?"
 * That question has nothing to do with WHAT is being dragged, so it lives
 * here as a pure function and gets tested as arithmetic.
 *
 * Two properties matter for feel:
 *   1. The ramp is PROPORTIONAL, not binary. At the very edge the speed is
 *      `max`; `zone` px inside it is 0; linear in between. A binary
 *      "near edge → constant speed" is what makes autoscroll feel like a
 *      machine rather than a hand.
 *   2. Both axes come back independently, so one wide table can scroll
 *      horizontally and one long page vertically from the same call.
 *
 * A pointer OUTSIDE the rect clamps to `max` in that direction — the user
 * has left the box entirely, so there is nothing left to ramp.
 */
export type EdgeVelocity = { dx: number; dy: number };

export type Rect = { top: number; right: number; bottom: number; left: number };

export const SCROLL_ZONE = 60;
export const SCROLL_MAX = 18;

/** Velocity along one axis. `lo`/`hi` are the two edges, `p` the pointer. */
function axisVelocity(p: number, lo: number, hi: number, zone: number, max: number): number {
  if (!Number.isFinite(p) || !Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
  if (p < lo) return -max;
  if (p > hi) return max;
  const span = hi - lo;
  // Never let the two zones overlap (a container narrower than 2×zone would
  // otherwise scroll both ways at once, i.e. never settle).
  const z = Math.min(zone, span / 2);
  if (z <= 0) return 0;
  const fromLo = p - lo;
  if (fromLo < z) return -max * ((z - fromLo) / z);
  const fromHi = hi - p;
  if (fromHi < z) return max * ((z - fromHi) / z);
  return 0;
}

export function edgeVelocity(
  pointer: { x: number; y: number },
  rect: Rect,
  opts?: { zone?: number; max?: number },
): EdgeVelocity {
  const zone = opts?.zone ?? SCROLL_ZONE;
  const max = opts?.max ?? SCROLL_MAX;
  return {
    dx: axisVelocity(pointer.x, rect.left, rect.right, zone, max),
    dy: axisVelocity(pointer.y, rect.top, rect.bottom, zone, max),
  };
}
