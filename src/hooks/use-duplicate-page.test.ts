/**
 * Regression test for CHUNK 4: `useDuplicatePage` must produce fresh block
 * ids on the copy. This tests the id-cloning logic in isolation from the
 * network, mirroring what the hook does on the raw blocks array.
 */
import { describe, it, expect } from "vitest";

/** Copied from the mutationFn — kept in sync deliberately. */
function cloneWithFreshIds(rawBlocks: unknown[]): unknown[] {
  return rawBlocks.map((b) => {
    if (b && typeof b === "object" && !Array.isArray(b)) {
      const rec = b as Record<string, unknown>;
      return {
        ...rec,
        id:
          globalThis.crypto?.randomUUID?.() ??
          `blk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };
    }
    return b;
  });
}

describe("useDuplicatePage — block id freshness", () => {
  it("assigns a new id to every block; none share the source's id", () => {
    const src = [
      { id: "a-1", type: "text", text: "one" },
      { id: "a-2", type: "text", text: "two" },
      { id: "a-3", type: "heading", text: "three" },
    ];
    const copy = cloneWithFreshIds(src) as Array<Record<string, unknown>>;
    expect(copy).toHaveLength(src.length);

    const srcIds = new Set(src.map((b) => b.id));
    const copyIds = copy.map((b) => b.id as string);

    // No id from the source survives on the copy.
    for (const id of copyIds) {
      expect(srcIds.has(id)).toBe(false);
    }

    // Every copy id is unique among itself.
    expect(new Set(copyIds).size).toBe(copyIds.length);

    // Non-id fields are preserved.
    for (let i = 0; i < src.length; i++) {
      expect(copy[i].type).toBe(src[i].type);
      expect(copy[i].text).toBe(src[i].text);
    }
  });

  it("handles blocks without a prior id", () => {
    const src = [{ type: "text", text: "hi" }, { type: "text", text: "yo" }];
    const copy = cloneWithFreshIds(src) as Array<Record<string, unknown>>;
    for (const b of copy) expect(typeof b.id).toBe("string");
    const ids = copy.map((b) => b.id as string);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
