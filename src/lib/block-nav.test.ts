import { describe, it, expect } from "vitest";
import { nextEditableIndex } from "./block-nav";

const B = (type: string) => ({ type });

describe("nextEditableIndex", () => {
  it("returns the adjacent index for a normal text block", () => {
    const blocks = [B("text"), B("text"), B("text")];
    expect(nextEditableIndex(blocks, 0, 1)).toBe(1);
    expect(nextEditableIndex(blocks, 2, -1)).toBe(1);
  });

  it("skips a single divider", () => {
    const blocks = [B("text"), B("divider"), B("text")];
    expect(nextEditableIndex(blocks, 0, 1)).toBe(2);
    expect(nextEditableIndex(blocks, 2, -1)).toBe(0);
  });

  it("skips a run of three dividers", () => {
    const blocks = [
      B("text"),
      B("divider"),
      B("divider"),
      B("divider"),
      B("text"),
    ];
    expect(nextEditableIndex(blocks, 0, 1)).toBe(4);
    expect(nextEditableIndex(blocks, 4, -1)).toBe(0);
  });

  it("also skips tables (no single caret to address)", () => {
    const blocks = [B("text"), B("table"), B("divider"), B("text")];
    expect(nextEditableIndex(blocks, 0, 1)).toBe(3);
  });

  it("returns null at the end in that direction", () => {
    const blocks = [B("text"), B("text")];
    expect(nextEditableIndex(blocks, 1, 1)).toBeNull();
  });

  it("returns null when every remaining block is non-editable", () => {
    const blocks = [B("text"), B("divider"), B("table"), B("divider")];
    expect(nextEditableIndex(blocks, 0, 1)).toBeNull();
  });

  it("direction -1 from index 0 returns null", () => {
    const blocks = [B("text"), B("text")];
    expect(nextEditableIndex(blocks, 0, -1)).toBeNull();
  });
});
