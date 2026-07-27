import { describe, expect, it } from "vitest";
import { numberedOrdinals } from "./blocks";
import type { Block } from "./types";

const B = (id: string, type: string, extra: Record<string, unknown> = {}): Block =>
  ({ id, type, ...extra } as Block);

describe("numberedOrdinals", () => {
  it("empty array → empty map", () => {
    const m = numberedOrdinals([]);
    expect(m.size).toBe(0);
  });
  it("single numbered → 1", () => {
    const m = numberedOrdinals([B("a", "numbered")]);
    expect(m.get("a")).toBe(1);
  });
  it("three consecutive numbered → 1, 2, 3", () => {
    const m = numberedOrdinals([
      B("a", "numbered"),
      B("b", "numbered"),
      B("c", "numbered"),
    ]);
    expect(m.get("a")).toBe(1);
    expect(m.get("b")).toBe(2);
    expect(m.get("c")).toBe(3);
  });
  it("run broken by a text block → 1,2 then 1,2", () => {
    const m = numberedOrdinals([
      B("a", "numbered"),
      B("b", "numbered"),
      B("t", "text"),
      B("c", "numbered"),
      B("d", "numbered"),
    ]);
    expect([m.get("a"), m.get("b"), m.get("c"), m.get("d")]).toEqual([1, 2, 1, 2]);
    expect(m.has("t")).toBe(false);
  });
  it("run broken by an h2 → same reset behaviour", () => {
    const m = numberedOrdinals([
      B("a", "numbered"),
      B("b", "numbered"),
      B("h", "h2"),
      B("c", "numbered"),
      B("d", "numbered"),
    ]);
    expect([m.get("a"), m.get("b"), m.get("c"), m.get("d")]).toEqual([1, 2, 1, 2]);
  });
  it("interleaved bullets reset the run — they do not participate", () => {
    const m = numberedOrdinals([
      B("a", "numbered"),
      B("x", "bullet"),
      B("b", "numbered"),
    ]);
    expect(m.get("a")).toBe(1);
    expect(m.get("b")).toBe(1);
  });
});

import { clampIndent, ordinalLabel } from "./blocks";

describe("clampIndent — parent+1 rule", () => {
  it("floors at 0 and ceilings at 6", () => {
    expect(clampIndent(0, -1)).toBe(0);
    expect(clampIndent(6, 10)).toBe(6);
  });
  it("clamps a requested indent to prev+1", () => {
    expect(clampIndent(0, 2)).toBe(1); // no jump from 0 → 2
    expect(clampIndent(2, 1)).toBe(1);
    expect(clampIndent(5, 7)).toBe(6);
    expect(clampIndent(0, 0)).toBe(0);
    expect(clampIndent(3, 4)).toBe(4);
  });
});

describe("ordinalLabel — cycles every 3 indent levels", () => {
  it("(1,0)→'1.', (2,1)→'b.', (3,2)→'iii.', (4,3)→'4.'", () => {
    expect(ordinalLabel(1, 0)).toBe("1.");
    expect(ordinalLabel(2, 1)).toBe("b.");
    expect(ordinalLabel(3, 2)).toBe("iii.");
    // level 3 → cycle back to numeric
    expect(ordinalLabel(4, 3)).toBe("4.");
    // level 4 → alpha again
    expect(ordinalLabel(3, 4)).toBe("c.");
    // level 5 → roman again
    expect(ordinalLabel(6, 5)).toBe("vi.");
  });
});

describe("numberedOrdinals with indent — level-aware runs", () => {
  const N = (id: string, indent: number): Block =>
    ({ id, type: "numbered", indent } as unknown as Block);
  const T = (id: string, indent: number, type = "text"): Block =>
    ({ id, type, indent } as unknown as Block);
  it("mixed [0,0,1,1,0,1] → [1,2,1,2,3,1]", () => {
    const m = numberedOrdinals([
      N("a", 0),
      N("b", 0),
      N("c", 1),
      N("d", 1),
      N("e", 0),
      N("f", 1),
    ]);
    expect([m.get("a"), m.get("b"), m.get("c"), m.get("d"), m.get("e"), m.get("f")])
      .toEqual([1, 2, 1, 2, 3, 1]);
  });
  it("a non-numbered block at the same indent breaks the run", () => {
    const m = numberedOrdinals([
      N("a", 1),
      T("x", 1, "bullet"),
      N("b", 1),
    ]);
    expect([m.get("a"), m.get("b")]).toEqual([1, 1]);
  });
  it("a deeper non-numbered block does NOT break the run", () => {
    const m = numberedOrdinals([
      N("a", 0),
      T("x", 1, "bullet"),
      N("b", 0),
    ]);
    expect([m.get("a"), m.get("b")]).toEqual([1, 2]);
  });
});
