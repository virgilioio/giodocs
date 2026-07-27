import { describe, it, expect } from "vitest";
import { toggleWrap, isWrapped } from "./toggle-wrap";

describe("toggleWrap — collapsed caret", () => {
  it("inserts a pair with caret between", () => {
    const r = toggleWrap("hello", 2, 2, "**");
    expect(r.text).toBe("he****llo");
    expect(r.start).toBe(4);
    expect(r.end).toBe(4);
  });
  it("works with distinct open/close (underline)", () => {
    const r = toggleWrap("x", 1, 1, "<u>", "</u>");
    expect(r.text).toBe("x<u></u>");
    expect(r.start).toBe(4);
    expect(r.end).toBe(4);
  });
});

describe("toggleWrap — wrap a selection", () => {
  it("wraps the selection and keeps the same words selected", () => {
    const r = toggleWrap("the quick fox", 4, 9, "**");
    expect(r.text).toBe("the **quick** fox");
    expect(r.text.slice(r.start, r.end)).toBe("quick");
  });
  it("supports asymmetric delimiters", () => {
    const r = toggleWrap("abc", 0, 3, "<u>", "</u>");
    expect(r.text).toBe("<u>abc</u>");
    expect(r.text.slice(r.start, r.end)).toBe("abc");
  });
});

describe("toggleWrap — unwrap", () => {
  it("unwraps when the selection itself is delimited", () => {
    const r = toggleWrap("x **quick** y", 2, 11, "**");
    expect(r.text).toBe("x quick y");
    expect(r.text.slice(r.start, r.end)).toBe("quick");
  });
  it("unwraps when delimiters sit immediately outside the selection", () => {
    const r = toggleWrap("x **quick** y", 4, 9, "**");
    expect(r.text).toBe("x quick y");
    expect(r.text.slice(r.start, r.end)).toBe("quick");
  });
});

describe("toggleWrap — toggle twice is identity", () => {
  const cases: Array<[string, number, number, string, string?]> = [
    ["hello world", 6, 11, "**"],
    ["a b c", 0, 5, "*"],
    ["one two three", 4, 7, "~~"],
    ["highlight me now", 10, 12, "=="],
    ["code: xy", 6, 8, "`"],
    ["u me", 0, 1, "<u>", "</u>"],
  ];
  for (const [t, s, e, open, close] of cases) {
    it(`round-trips "${t}" [${s},${e}] ${open}…${close ?? open}`, () => {
      const a = toggleWrap(t, s, e, open, close);
      const b = toggleWrap(a.text, a.start, a.end, open, close);
      expect(b.text).toBe(t);
      expect(b.start).toBe(s);
      expect(b.end).toBe(e);
    });
  }
});

describe("toggleWrap — nesting", () => {
  it("bold nested inside highlight survives a round trip", () => {
    // Selection covers the bold run inside a highlight.
    const src = "==foo **bar** baz==";
    // Select just the "**bar**"
    const start = src.indexOf("**bar**");
    const end = start + "**bar**".length;
    // Toggle bold off, then bold on → back to original.
    const a = toggleWrap(src, start, end, "**");
    const b = toggleWrap(a.text, a.start, a.end, "**");
    expect(b.text).toBe(src);
  });
});

describe("isWrapped", () => {
  it("true when selection itself is the delimited run", () => {
    expect(isWrapped("**x**", 0, 5, "**")).toBe(true);
  });
  it("true when delimiters sit outside", () => {
    expect(isWrapped("**x**", 2, 3, "**")).toBe(true);
  });
  it("false when nothing is delimited", () => {
    expect(isWrapped("hello", 0, 5, "**")).toBe(false);
  });
  it("false on a collapsed selection", () => {
    expect(isWrapped("**x**", 3, 3, "**")).toBe(false);
  });
});
