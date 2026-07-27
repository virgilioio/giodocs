import { describe, it, expect } from "vitest";
import { applyAreaIcon, firstGrapheme } from "./area-icon";

describe("applyAreaIcon", () => {
  it("patches the icon on an existing option", () => {
    const before = [
      { value: "Product", label: "Product", icon: "🧭", dot: "whisper" },
      { value: "Legal", label: "Legal" },
    ];
    const after = applyAreaIcon(before, "Product", "🎨");
    expect(after[0]).toMatchObject({ value: "Product", icon: "🎨" });
    // Other options untouched.
    expect(after[1]).toEqual({ value: "Legal", label: "Legal" });
    // Pure — input not mutated.
    expect(before[0].icon).toBe("🧭");
  });

  it("appends a new option with defaults when the area isn't in the list", () => {
    const before = [{ value: "Product", label: "Product", icon: "🧭" }];
    const after = applyAreaIcon(before, "Legal", "🏛");
    expect(after).toHaveLength(2);
    expect(after[1]).toEqual({
      value: "Legal",
      label: "Legal",
      icon: "🏛",
      dot: "whisper",
      tint: "sunken",
      ink: "secondary",
    });
  });

  it("removes the icon key when emoji is null (without dropping the option)", () => {
    const before = [
      { value: "Product", label: "Product", icon: "🧭", dot: "whisper" },
    ];
    const after = applyAreaIcon(before, "Product", null);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual({
      value: "Product",
      label: "Product",
      dot: "whisper",
    });
    expect("icon" in after[0]).toBe(false);
  });

  it("does nothing when removing from an area not in the list", () => {
    const before = [{ value: "Product", icon: "🧭" }];
    const after = applyAreaIcon(before, "Legal", null);
    expect(after).toEqual([{ value: "Product", icon: "🧭" }]);
  });

  it("treats undefined/null options as empty and can append", () => {
    expect(applyAreaIcon(undefined, "Legal", "🏛")).toEqual([
      {
        value: "Legal",
        label: "Legal",
        icon: "🏛",
        dot: "whisper",
        tint: "sunken",
        ink: "secondary",
      },
    ]);
    expect(applyAreaIcon(null, "Legal", null)).toEqual([]);
  });
});

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
