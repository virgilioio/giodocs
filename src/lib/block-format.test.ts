import { describe, it, expect } from "vitest";
import {
  MARK_BOLD,
  MARK_ITALIC,
  MARK_HIGHLIGHT,
  applyMarkToBlocks,
  canFormatBlockType,
  isWholeWrapped,
  unwrapWhole,
  wrapWhole,
} from "./block-format";

type B = { id: string; type: string; text?: string };

describe("isWholeWrapped", () => {
  it("true for a fully wrapped run", () => {
    expect(isWholeWrapped("**x**", MARK_BOLD)).toBe(true);
  });
  it("false for a partial run", () => {
    expect(isWholeWrapped("a **b** c", MARK_BOLD)).toBe(false);
  });
  it("tolerates surrounding whitespace", () => {
    expect(isWholeWrapped("  **x**  ", MARK_BOLD)).toBe(true);
  });
  it("detects bold before italic — a bold run is not italic", () => {
    expect(isWholeWrapped("**x**", MARK_BOLD)).toBe(true);
    expect(isWholeWrapped("**x**", MARK_ITALIC)).toBe(false);
  });
  it("false on empty-ish text", () => {
    expect(isWholeWrapped("", MARK_BOLD)).toBe(false);
  });
});

describe("wrapWhole", () => {
  it("strips an inner pair before wrapping (documented loss)", () => {
    expect(wrapWhole("hello **world**", MARK_BOLD)).toBe("**hello world**");
  });
  it("wraps plain text", () => {
    expect(wrapWhole("hello", MARK_HIGHLIGHT)).toBe("==hello==");
  });
  it("italic stripping does not eat bold", () => {
    expect(wrapWhole("a **b** c", MARK_ITALIC)).toBe("*a **b** c*");
  });
  it("leaves whitespace outside the marks", () => {
    expect(wrapWhole(" hi ", MARK_BOLD)).toBe(" **hi** ");
  });
  it("round trips with unwrapWhole to the stripped text", () => {
    const w = wrapWhole("hello **world**", MARK_BOLD);
    expect(unwrapWhole(w, MARK_BOLD)).toBe("hello world");
  });
});

describe("canFormatBlockType", () => {
  it("allows prose types", () => {
    for (const t of [
      "text",
      "h1",
      "h2",
      "h3",
      "bullet",
      "numbered",
      "todo",
      "quote",
      "caption",
      "callout",
      "toggle",
    ])
      expect(canFormatBlockType(t)).toBe(true);
  });
  it("rejects literal and non-prose types", () => {
    for (const t of [
      "divider",
      "code",
      "image",
      "imagerow",
      "file",
      "table",
      "sheet",
      "columns",
      "page",
    ])
      expect(canFormatBlockType(t)).toBe(false);
  });
});

describe("applyMarkToBlocks", () => {
  it("mixed selection wraps every eligible block", () => {
    const blocks: B[] = [
      { id: "a", type: "text", text: "**one**" },
      { id: "b", type: "text", text: "two" },
    ];
    const out = applyMarkToBlocks(blocks, new Set(["a", "b"]), MARK_BOLD);
    expect(out.map((b) => b.text)).toEqual(["**one**", "**two**"]);
  });
  it("all-wrapped selection unwraps every block", () => {
    const blocks: B[] = [
      { id: "a", type: "text", text: "**one**" },
      { id: "b", type: "text", text: "**two**" },
    ];
    const out = applyMarkToBlocks(blocks, new Set(["a", "b"]), MARK_BOLD);
    expect(out.map((b) => b.text)).toEqual(["one", "two"]);
  });
  it("ineligible blocks pass through byte-identical and do not affect the decision", () => {
    const code: B = { id: "c", type: "code", text: "**literal**" };
    const blocks: B[] = [{ id: "a", type: "text", text: "**one**" }, code];
    const out = applyMarkToBlocks(blocks, new Set(["a", "c"]), MARK_BOLD);
    expect(out[1]).toBe(code);
    // only the text block counted → all wrapped → unwrap
    expect(out[0].text).toBe("one");
  });
  it("a selection of only ineligible blocks returns the input array unchanged", () => {
    const blocks: B[] = [
      { id: "d", type: "divider" },
      { id: "t", type: "table" },
    ];
    const out = applyMarkToBlocks(blocks, new Set(["d", "t"]), MARK_BOLD);
    expect(out).toBe(blocks);
  });
  it("unselected blocks are untouched", () => {
    const keep: B = { id: "b", type: "text", text: "two" };
    const blocks: B[] = [{ id: "a", type: "text", text: "one" }, keep];
    const out = applyMarkToBlocks(blocks, new Set(["a"]), MARK_BOLD);
    expect(out[1]).toBe(keep);
  });
});
