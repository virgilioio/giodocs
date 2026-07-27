/* Tests for the offset translation layer. Two invariants:
 *   1. Every rendered index round-trips: toRendered(toSource(r)) === r.
 *   2. renderedText equals inlineToHtml(source) with tags stripped —
 *      so if the renderer's grammar drifts, these tests fail loudly.
 *
 * DOM caret tests (getCaretOffset/setCaretOffset) are deferred to
 * phase 2 acceptance: the current vitest config runs in Node and has
 * no jsdom/happy-dom environment, so we do not fake a DOM here.
 */
import { describe, expect, it } from "vitest";
import { buildOffsetMap } from "./ce-offsets";
import { inlineToHtml } from "./inline-markdown";

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

describe("buildOffsetMap — grammar coverage", () => {
  it("plain text: rendered and source indices are identical throughout", () => {
    const m = buildOffsetMap("hello world");
    expect(m.renderedText).toBe("hello world");
    for (let i = 0; i <= "hello world".length; i++) {
      expect(m.toSource(i)).toBe(i);
      expect(m.toRendered(i)).toBe(i);
    }
  });

  it("**bold**: rendered 0..4 map to source 2..6", () => {
    const m = buildOffsetMap("**bold**");
    expect(m.renderedText).toBe("bold");
    // rendered → source
    expect(m.toSource(0)).toBe(2);
    expect(m.toSource(1)).toBe(3);
    expect(m.toSource(2)).toBe(4);
    expect(m.toSource(3)).toBe(5);
    // rendered 4 is the end sentinel — clamps to srcLen (8).
    expect(m.toSource(4)).toBe(8);
    // round-trip on interior indices
    for (let r = 0; r < 4; r++) expect(m.toRendered(m.toSource(r))).toBe(r);
  });

  it("text before and after a delimiter maps on both sides", () => {
    const src = "a**b**c";
    const m = buildOffsetMap(src);
    expect(m.renderedText).toBe("abc");
    expect(m.toSource(0)).toBe(0); // before 'a'
    expect(m.toSource(1)).toBe(3); // after 'a', before 'b' (inside **)
    expect(m.toSource(2)).toBe(6); // after 'b', before 'c'
    expect(m.toSource(3)).toBe(7); // sentinel → srcLen
  });

  it("two adjacent formats: **a**==b==", () => {
    const src = "**a**==b==";
    const m = buildOffsetMap(src);
    expect(m.renderedText).toBe("ab");
    expect(m.toSource(0)).toBe(2); // 'a' starts at src 2
    expect(m.toSource(1)).toBe(7); // 'b' starts at src 7
  });

  it("nested: **bold *italic* end**", () => {
    const src = "**bold *italic* end**";
    const m = buildOffsetMap(src);
    expect(m.renderedText).toBe("bold italic end");
    // round-trip over every rendered index
    for (let r = 0; r <= m.renderedText.length; r++) {
      expect(m.toRendered(m.toSource(r))).toBe(r);
    }
  });

  it("link: rendered text is label; url positions clamp to link boundary", () => {
    const src = "[label](https://x)";
    const m = buildOffsetMap(src);
    expect(m.renderedText).toBe("label");
    // rendered inside label
    expect(m.toSource(0)).toBe(1);
    expect(m.toSource(1)).toBe(2);
    expect(m.toSource(5)).toBe(src.length); // sentinel
    // A source index inside the URL clamps to end-of-label rendered (5),
    // rather than throwing.
    const urlIdx = src.indexOf("https") + 2;
    expect(m.toRendered(urlIdx)).toBe(5);
  });

  it("inline code: ** inside code is literal", () => {
    const src = "`a**b`";
    const m = buildOffsetMap(src);
    expect(m.renderedText).toBe("a**b");
    // 'a' at src 1, '*' at src 2, '*' at src 3, 'b' at src 4
    expect(m.toSource(0)).toBe(1);
    expect(m.toSource(1)).toBe(2);
    expect(m.toSource(2)).toBe(3);
    expect(m.toSource(3)).toBe(4);
  });

  it("unmatched delimiters: **a maps every character literally", () => {
    const src = "**a";
    const m = buildOffsetMap(src);
    expect(m.renderedText).toBe("**a");
    for (let i = 0; i <= 3; i++) {
      expect(m.toSource(i)).toBe(i);
      expect(m.toRendered(i)).toBe(i);
    }
  });

  it("escape: \\* renders as one literal *", () => {
    const src = "a\\*b";
    const m = buildOffsetMap(src);
    expect(m.renderedText).toBe("a*b");
    // rendered 'a'=0 (src 0), '*'=1 (src 2 or 1 — either backslash or star, but
    // r2s picks the escaped char), 'b'=2 (src 3)
    expect(m.toSource(0)).toBe(0);
    expect(m.toSource(2)).toBe(3);
  });
});

describe("buildOffsetMap — round-trip", () => {
  const fixtures = [
    "",
    "plain",
    "**bold**",
    "*italic*",
    "~~strike~~",
    "==hi==",
    "`code`",
    "<u>u</u>",
    "a**b**c",
    "**a**==b==",
    "**bold *italic* end**",
    "[label](https://x)",
    "before [link](https://x) after",
    "`a**b`",
    "**a",
    "a\\*b",
    "mix **b** and *i* and `c` and ==h== and ~~s~~ and <u>u</u> end",
  ];
  it("toRendered(toSource(r)) === r for every rendered index", () => {
    for (const src of fixtures) {
      const m = buildOffsetMap(src);
      for (let r = 0; r <= m.renderedText.length; r++) {
        expect(m.toRendered(m.toSource(r))).toBe(r);
      }
    }
  });
});

describe("buildOffsetMap — renderedText matches the actual renderer", () => {
  // If inline-markdown.tsx's grammar changes, this fails immediately.
  const fixtures = [
    "plain",
    "**bold**",
    "*italic*",
    "~~strike~~",
    "==hi==",
    "`a**b`",
    "<u>u</u>",
    "a**b**c",
    "**a**==b==",
    "**bold *italic* end**",
    "[label](https://example.com)",
    "**a",
    "a\\*b",
    "mix **b** and *i* and `c` and ==h== and ~~s~~ end",
  ];
  it("equals inlineToHtml stripped of tags", () => {
    for (const src of fixtures) {
      const m = buildOffsetMap(src);
      expect(m.renderedText).toBe(stripTags(inlineToHtml(src)));
    }
  });
});
