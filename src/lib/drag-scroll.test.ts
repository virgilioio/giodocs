import { describe, expect, it } from "vitest";
import { edgeVelocity, SCROLL_MAX } from "./drag-scroll";

const rect = { top: 0, left: 0, right: 400, bottom: 400 };

describe("edgeVelocity", () => {
  it("is zero well inside the rect", () => {
    expect(edgeVelocity({ x: 200, y: 200 }, rect)).toEqual({ dx: 0, dy: 0 });
  });

  it("is max at the edge", () => {
    expect(edgeVelocity({ x: 0, y: 200 }, rect).dx).toBe(-SCROLL_MAX);
    expect(edgeVelocity({ x: 400, y: 200 }, rect).dx).toBe(SCROLL_MAX);
    expect(edgeVelocity({ x: 200, y: 400 }, rect).dy).toBe(SCROLL_MAX);
  });

  it("ramps proportionally — half speed at half a zone in", () => {
    const { dy } = edgeVelocity({ x: 200, y: 30 }, rect, { zone: 60 });
    expect(dy).toBeCloseTo(-SCROLL_MAX / 2, 5);
  });

  it("returns both axes at a corner", () => {
    const v = edgeVelocity({ x: 395, y: 5 }, rect);
    expect(v.dx).toBeGreaterThan(0);
    expect(v.dy).toBeLessThan(0);
  });

  it("clamps to max when the pointer is outside", () => {
    expect(edgeVelocity({ x: -900, y: 9000 }, rect)).toEqual({
      dx: -SCROLL_MAX,
      dy: SCROLL_MAX,
    });
  });

  it("does not divide by zero on a zero-size rect", () => {
    const v = edgeVelocity({ x: 0, y: 0 }, { top: 0, left: 0, right: 0, bottom: 0 });
    expect(Number.isFinite(v.dx)).toBe(true);
    expect(v).toEqual({ dx: 0, dy: 0 });
  });

  it("never scrolls both directions at once in a narrow container", () => {
    const narrow = { top: 0, left: 0, right: 20, bottom: 400 };
    const v = edgeVelocity({ x: 10, y: 200 }, narrow);
    expect(v.dx).toBe(0);
  });
});
