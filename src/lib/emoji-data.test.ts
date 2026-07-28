import { describe, it, expect } from "vitest";
import {
  EMOJI,
  searchEmoji,
  shouldOpenEmojiTrigger,
  emojisByCategory,
  CATEGORY_ORDER,
} from "./emoji-data";

describe("emoji dataset", () => {
  it("has between 350 and 450 entries and every category populated", () => {
    expect(EMOJI.length).toBeGreaterThanOrEqual(350);
    expect(EMOJI.length).toBeLessThanOrEqual(450);
    for (const c of CATEGORY_ORDER) {
      expect(emojisByCategory(c).length).toBeGreaterThan(0);
    }
  });
  it("uses lowercase hyphenated shortcode names", () => {
    for (const e of EMOJI) {
      expect(e.name).toMatch(/^[a-z0-9-]+$/);
    }
  });
  it("includes every emoji already used in the app", () => {
    const need = ["🧭", "📄", "🗂", "📓", "🔍", "🎨", "🔧", "🤝", "📦", "💡"];
    const chars = new Set(EMOJI.map((e) => e.char));
    for (const n of need) expect(chars.has(n)).toBe(true);
  });
});

describe("searchEmoji", () => {
  it("returns nothing for an empty query", () => {
    expect(searchEmoji("")).toEqual([]);
    expect(searchEmoji("   ")).toEqual([]);
  });
  it("ranks name prefix above mid-string", () => {
    const results = searchEmoji("check");
    const names = results.map((r) => r.name);
    const wcm = names.indexOf("white-check-mark");
    const cm = names.indexOf("check-mark");
    expect(wcm).toBeGreaterThan(-1);
    expect(cm).toBeGreaterThan(-1);
    // "check-mark" is a name-prefix hit; "white-check-mark" is only mid-string.
    expect(cm).toBeLessThan(wcm);
  });
  it("finds by keyword", () => {
    const results = searchEmoji("alert");
    expect(results.some((r) => r.name === "warning")).toBe(true);
  });
  it("treats underscores as hyphens", () => {
    const a = searchEmoji("thumbs_up");
    const b = searchEmoji("thumbs-up");
    expect(a[0]?.name).toBe("thumbs-up");
    expect(b[0]?.name).toBe("thumbs-up");
  });
  it("respects the limit argument", () => {
    expect(searchEmoji("a", 5).length).toBe(5);
  });
});

describe("shouldOpenEmojiTrigger", () => {
  it("opens after ':' at block start with at least one char", () => {
    expect(shouldOpenEmojiTrigger(":t")).toEqual({ open: true, query: "t" });
  });
  it("opens after whitespace-colon", () => {
    expect(shouldOpenEmojiTrigger("hello :warn")).toEqual({
      open: true, query: "warn",
    });
  });
  it("does NOT open right after typing ':' alone (no query chars yet)", () => {
    expect(shouldOpenEmojiTrigger(":").open).toBe(false);
    expect(shouldOpenEmojiTrigger("hello :").open).toBe(false);
  });
  it("does NOT open when ':' is preceded by a word character", () => {
    expect(shouldOpenEmojiTrigger("word:foo").open).toBe(false);
    expect(shouldOpenEmojiTrigger("Note:").open).toBe(false);
    expect(shouldOpenEmojiTrigger("10:30").open).toBe(false);
    expect(shouldOpenEmojiTrigger("Re:the").open).toBe(false);
  });
  it("handles 'Note: hello' — space after colon closes it", () => {
    // The caret is after "hello" — the last ":" is followed by " hello".
    // Space is not in the accepted charset → closes.
    expect(shouldOpenEmojiTrigger("Note: hello").open).toBe(false);
  });
  it("closes on space in the query", () => {
    expect(shouldOpenEmojiTrigger(":ab cd").open).toBe(false);
  });
  it("closes past 24 chars", () => {
    expect(shouldOpenEmojiTrigger(":" + "a".repeat(25)).open).toBe(false);
    expect(shouldOpenEmojiTrigger(":" + "a".repeat(24)).open).toBe(true);
  });
  it("accepts letters, digits, hyphen, and underscore only", () => {
    expect(shouldOpenEmojiTrigger(":thumbs-up").open).toBe(true);
    expect(shouldOpenEmojiTrigger(":thumbs_up").open).toBe(true);
    expect(shouldOpenEmojiTrigger(":smile1").open).toBe(true);
    expect(shouldOpenEmojiTrigger(":smi.le").open).toBe(false);
    expect(shouldOpenEmojiTrigger(":smi!le").open).toBe(false);
  });
});
