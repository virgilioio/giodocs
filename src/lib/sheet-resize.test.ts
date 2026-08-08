import { describe, expect, it } from "vitest";
import {
  clampBh,
  clampBw,
  GRIP_PAD,
  MIN_BH,
  maxBw,
  readoutText,
  resizeStyle,
} from "./sheet-resize";

/* ⚠ THE POINT OF THIS FILE: the clamp is derived from a MEASURED container,
 * never a constant, and it can never put the block's right edge — and so the
 * grip — past `room - GRIP_PAD`. The spec's author shipped Math.min(560, …)
 * and on a 924px viewport the grip landed 51px off-screen, unreachable. */
describe("the width clamp", () => {
  it("never puts the right edge past room minus the pad, for any requested delta", () => {
    const rooms = [320, 640, 780, 924, 1280, 1600];
    const naturals = [200, 560, 780, 900];
    const deltas = [-500, -1, 0, 1, 40, 200, 2000, 99999];
    for (const room of rooms) {
      for (const naturalWidth of naturals) {
        for (const dx of deltas) {
          for (const startBw of [0, 120, 600]) {
            const bw = clampBw({ room, naturalWidth, startBw, dx });
            expect(bw).toBeGreaterThanOrEqual(0);
            // The block is centred on the text column, so its right edge
            // sits half the delta beyond the natural right edge.
            const rightEdge = naturalWidth + bw;
            // In a container narrower than the block's own natural width
            // there is nothing to give back, so the ceiling is "no bleed".
            expect(rightEdge).toBeLessThanOrEqual(
              Math.max(naturalWidth, room - GRIP_PAD) + 1e-9,
            );
          }
        }
      }
    }
  });

  it("refuses any bleed when the container is already narrower than the block", () => {
    expect(maxBw(600, 780)).toBe(0);
    expect(clampBw({ room: 600, naturalWidth: 780, startBw: 300, dx: 400 })).toBe(0);
  });

  it("reproduces the shipped bug: a constant ceiling would exceed the measured room", () => {
    // The failing case, verbatim: a 924px viewport, a 780px text column.
    const room = 924;
    const naturalWidth = 780;
    expect(maxBw(room, naturalWidth)).toBe(124);
    // Math.min(560, …) would have allowed 560 — a right edge 436px past
    // what the container has room for.
    expect(clampBw({ room, naturalWidth, startBw: 0, dx: 1000 })).toBe(124);
  });

  it("buys two pixels of width per pixel of pointer travel, because the bleed is symmetric", () => {
    expect(clampBw({ room: 4000, naturalWidth: 780, startBw: 0, dx: 80 })).toBe(160);
  });

  it("clamps at zero rather than going negative", () => {
    expect(clampBw({ room: 4000, naturalWidth: 780, startBw: 100, dx: -400 })).toBe(0);
  });
});

describe("the height clamp", () => {
  it("turns a shortened block into a viewport and keeps a floor", () => {
    expect(clampBh({ startBh: 0, dy: -200, naturalHeight: 600 })).toBe(400);
    expect(clampBh({ startBh: 0, dy: -5000, naturalHeight: 600 })).toBe(MIN_BH);
  });

  it("drops the constraint entirely once the drag passes the last row", () => {
    expect(clampBh({ startBh: 300, dy: 900, naturalHeight: 600 })).toBe(0);
  });

  it("continues from an existing height rather than the natural one", () => {
    expect(clampBh({ startBh: 300, dy: 40, naturalHeight: 900 })).toBe(340);
  });
});

describe("the bleed geometry", () => {
  it("grows outward from the text column on both sides", () => {
    expect(resizeStyle({ bw: 160, pageScope: true })).toEqual({
      width: "calc(100% + 160px)",
      marginLeft: -80,
      flexShrink: 0,
    });
  });

  it("ignores bw inside a container but still applies bh", () => {
    expect(resizeStyle({ bw: 400, bh: 260, pageScope: false })).toEqual({ maxHeight: 260 });
  });

  it("treats 0 and undefined as unconstrained", () => {
    expect(resizeStyle({ bw: 0, bh: 0, pageScope: true })).toEqual({});
    expect(resizeStyle({ pageScope: true })).toEqual({});
  });
});

describe("the live readout", () => {
  it("reads width as a delta and height as an absolute", () => {
    expect(readoutText(160, 269)).toBe("+160px wide · 269px tall");
    expect(readoutText(0, 0)).toBe("full width · all rows");
  });
});
