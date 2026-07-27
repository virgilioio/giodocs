/* Marquee selection intersection — pure, scroll-invariant.
 *
 * The marquee bug this file exists to prevent: computing membership in
 * VIEWPORT coordinates. When the scroll container auto-scrolls during a
 * drag, viewport-space row rects move but the anchor doesn't, so rows
 * that WERE inside the rectangle drop out. Fix: do everything in the
 * scrolling container's CONTENT coordinates, where a row's top is stable
 * regardless of scroll.
 *
 * This function takes rows already measured in content space and returns
 * the ids whose vertical span intersects the band [min(y1,y2), max(y1,y2)].
 * It is horizontal-agnostic on purpose — a marquee that spans the column
 * selects any block it vertically touches, matching Notion's behaviour.
 *
 * The invariant this preserves: if you shift EVERY row's top by a constant
 * AND shift the band by the same constant, the selection is unchanged.
 * That is the scroll-invariance the bug violated.
 */

export type MarqueeRow = { id: string; top: number; height: number };

export function rowsInBand(
  rows: MarqueeRow[],
  y1: number,
  y2: number,
): string[] {
  const top = Math.min(y1, y2);
  const bot = Math.max(y1, y2);
  const out: string[] = [];
  for (const r of rows) {
    const rt = r.top;
    const rb = r.top + r.height;
    // Intersection test — inclusive so a zero-height band sitting inside
    // a row still selects that row.
    if (rb >= top && rt <= bot) out.push(r.id);
  }
  return out;
}
