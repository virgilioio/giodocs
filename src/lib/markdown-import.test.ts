import { describe, it, expect } from "vitest";
import { parseMarkdown } from "./markdown-import";
import { blockToMarkdown } from "./export";

/** Strip ids for structural comparison. */
function stripIds(blocks: Array<Record<string, unknown>>) {
  return blocks.map((b) => {
    const { id: _id, ...rest } = b;
    return rest;
  });
}

describe("parseMarkdown", () => {
  it("parses h1", () => {
    const [b] = parseMarkdown("# Title");
    expect(b.type).toBe("h1");
    expect(b.text).toBe("Title");
  });

  it("parses h2 (and collapses ### into h2)", () => {
    expect(parseMarkdown("## Two")[0].type).toBe("h2");
    expect(parseMarkdown("### Three")[0].type).toBe("h2");
    expect(parseMarkdown("### Three")[0].text).toBe("Three");
  });

  it("parses bullet with `-`, `*`, `+`", () => {
    expect(parseMarkdown("- a")[0]).toMatchObject({ type: "bullet", text: "a" });
    expect(parseMarkdown("* b")[0]).toMatchObject({ type: "bullet", text: "b" });
    expect(parseMarkdown("+ c")[0]).toMatchObject({ type: "bullet", text: "c" });
  });

  it("parses numbered; 1. and 2. both produce numbered (ordinal ignored)", () => {
    const bs = parseMarkdown("1. one\n2. two");
    expect(bs.map((b) => b.type)).toEqual(["numbered", "numbered"]);
    expect(bs.map((b) => b.text)).toEqual(["one", "two"]);
  });

  it("parses todo checked and unchecked BEFORE bullet", () => {
    const bs = parseMarkdown("- [ ] open\n- [x] done");
    expect(bs[0]).toMatchObject({ type: "todo", text: "open", checked: false });
    expect(bs[1]).toMatchObject({ type: "todo", text: "done", checked: true });
  });

  it("parses quote", () => {
    const [b] = parseMarkdown("> a wise thing");
    expect(b).toMatchObject({ type: "quote", text: "a wise thing" });
  });

  it("parses callout when quote leads with an emoji", () => {
    const [b] = parseMarkdown("> 💡 note this");
    expect(b).toMatchObject({ type: "callout", icon: "💡", text: "note this" });
  });

  it("parses --- and *** as divider", () => {
    expect(parseMarkdown("---")[0].type).toBe("divider");
    expect(parseMarkdown("***")[0].type).toBe("divider");
  });

  it("parses fenced code with language tag (language ignored)", () => {
    const [b] = parseMarkdown("```js\nconst x = 1;\nconst y = 2;\n```");
    expect(b.type).toBe("code");
    expect(b.text).toBe("const x = 1;\nconst y = 2;");
  });

  it("parses pipe table with separator row", () => {
    const [b] = parseMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(b.type).toBe("table");
    expect(b.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("consecutive plain lines join into one text block; blank line starts a new one", () => {
    const bs = parseMarkdown("first\nsecond\n\nthird");
    expect(bs).toHaveLength(2);
    expect(bs[0]).toMatchObject({ type: "text", text: "first\nsecond" });
    expect(bs[1]).toMatchObject({ type: "text", text: "third" });
  });

  it("preserves inline markers verbatim in text", () => {
    const src = "**bold** and *italic* and [a](b)";
    const [b] = parseMarkdown(src);
    expect(b).toMatchObject({ type: "text", text: src });
  });

  it("parses toggle when **title** is followed by 2-space indented body", () => {
    const [b] = parseMarkdown("**Details**\n  hidden line one\n  hidden line two");
    expect(b).toMatchObject({
      type: "toggle",
      text: "Details",
      body: "hidden line one\nhidden line two",
    });
  });

  it("round-trips all twelve block types via blockToMarkdown", () => {
    const fixture: Array<Record<string, unknown>> = [
      { id: "1", type: "text", text: "**bold** paragraph with [link](url)" },
      { id: "2", type: "h1", text: "The Heading" },
      { id: "3", type: "h2", text: "Sub Heading" },
      { id: "4", type: "bullet", text: "one bullet" },
      { id: "5", type: "numbered", text: "one step" },
      { id: "6", type: "todo", text: "unchecked", checked: false },
      { id: "7", type: "quote", text: "a wise saying" },
      { id: "8", type: "callout", icon: "💡", text: "a callout" },
      { id: "9", type: "divider", text: "" },
      { id: "10", type: "code", text: "const x = 1;\nconst y = 2;" },
      {
        id: "11",
        type: "table",
        text: "",
        rows: [
          ["a", "b"],
          ["1", "2"],
        ],
      },
      {
        id: "12",
        type: "toggle",
        text: "Details",
        body: "hidden line one\nhidden line two",
      },
    ];

    const md = fixture
      .map((b, i) => blockToMarkdown(b as never, i === 4 ? 1 : 1))
      .join("\n\n");
    const parsed = parseMarkdown(md);

    // Normalise: fixture entries don't declare fields the parser omits.
    // We strip ids and compare shape.
    expect(stripIds(parsed as never)).toEqual(stripIds(fixture));
  });
});
