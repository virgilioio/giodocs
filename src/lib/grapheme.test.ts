import { describe, expect, it } from "vitest";
import { firstGrapheme } from "./grapheme";

describe("firstGrapheme", () => {
  it("returns the first grapheme of a simple emoji", () => {
    expect(firstGrapheme("🎨")).toBe("🎨");
    expect(firstGrapheme("🎨 hi")).toBe("🎨");
  });

  it("keeps multi-codepoint emoji intact", () => {
    // Family (ZWJ sequence): 👨‍👩‍👧 — one grapheme, many code units.
    const family = "👨\u200D👩\u200D👧";
    expect(firstGrapheme(family)).toBe(family);
    // Flag (regional indicator pair).
    expect(firstGrapheme("🇮🇹")).toBe("🇮🇹");
  });

  it("returns empty string for empty or whitespace input", () => {
    expect(firstGrapheme("")).toBe("");
    expect(firstGrapheme("   ")).toBe("");
  });
});
