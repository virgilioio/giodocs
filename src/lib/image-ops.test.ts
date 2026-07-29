import { describe, it, expect } from "vitest";
import {
  clampW,
  rejectReason,
  storagePath,
  extForMime,
  resizeW,
  alignAfterResize,
  readAlign,
  readW,
  readCols,
  readPaths,
  collectImagePaths,
  droppedImagePaths,
} from "./image-ops";

describe("rejectReason", () => {
  it("accepts a normal screenshot", () => {
    expect(rejectReason({ type: "image/png", size: 2_000_000 })).toBeNull();
  });
  it("rejects a non-image", () => {
    expect(rejectReason({ type: "application/pdf", size: 10 })).toMatch(/image/i);
  });
  it("rejects over 10 MB", () => {
    expect(rejectReason({ type: "image/png", size: 11 * 1024 * 1024 })).toMatch(
      /10/,
    );
  });
});

describe("paths", () => {
  it("is {workspace}/{page}/{uuid}.{ext}", () => {
    expect(storagePath("ws", "pg", "uu", "png")).toBe("ws/pg/uu.png");
  });
  it("maps mime to extension", () => {
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/webp")).toBe("webp");
  });
});

describe("width", () => {
  it("clamps to 25..100", () => {
    expect(clampW(5)).toBe(25);
    expect(clampW(400)).toBe(100);
    expect(clampW(60)).toBe(60);
  });
  it("resizes a centred image symmetrically", () => {
    // 64px of travel on a 640px container is 10% of width per side, so a
    // centred image gains twice that.
    const left = resizeW(50, -64, 640, "center", "left");
    const right = resizeW(50, 64, 640, "center", "right");
    expect(left).toBe(right);
    expect(left).toBeGreaterThan(50);
  });
  it("resizes a left-aligned image from the right edge only", () => {
    expect(resizeW(50, 64, 640, "left", "right")).toBe(60);
  });
  it("leaves full-width when resized", () => {
    expect(alignAfterResize("full")).toBe("center");
    expect(alignAfterResize("left")).toBe("left");
  });
});

describe("readers", () => {
  it("defaults align to center and w to 100", () => {
    expect(readAlign({})).toBe("center");
    expect(readW({})).toBe(100);
  });
  it("defaults a row to two slots", () => {
    expect(readCols({})).toBe(2);
    expect(readPaths({})).toEqual([null, null]);
  });
  it("pads a row to its column count", () => {
    expect(readPaths({ cols: 3, paths: ["a"] })).toEqual(["a", null, null]);
  });
});

describe("collectImagePaths", () => {
  const tree = [
    { id: "1", type: "image", path: "w/p/a.png" },
    { id: "2", type: "imagerow", cols: 2, paths: ["w/p/b.png", null] },
    {
      id: "3",
      type: "callout",
      children: [{ id: "4", type: "image", path: "w/p/c.png" }],
    },
    {
      id: "5",
      type: "columns",
      cols: [[{ id: "6", type: "image", path: "w/p/d.png" }]],
    },
  ];
  it("walks callouts and columns", () => {
    expect(collectImagePaths(tree as never)).toEqual([
      "w/p/a.png",
      "w/p/b.png",
      "w/p/c.png",
      "w/p/d.png",
    ]);
  });
  it("reports only paths that disappeared", () => {
    const next = tree.slice(0, 2);
    expect(droppedImagePaths(tree as never, next as never)).toEqual([
      "w/p/c.png",
      "w/p/d.png",
    ]);
  });
  it("never reports a path that merely moved", () => {
    const moved = [...tree].reverse();
    expect(droppedImagePaths(tree as never, moved as never)).toEqual([]);
  });
});
