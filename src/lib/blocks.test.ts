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
