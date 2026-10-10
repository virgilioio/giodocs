import { describe, expect, it } from "vitest";
import { bulletOnSpace, newLine, unlistOnBackspace } from "./cell-lines";
import { toHtml, toMarkdown } from "./export";
import { parseMarkdown } from "./markdown-import";

describe("lines and lists in a cell", () => {
  it("- or * then space at a line start makes a bullet", () => {
    expect(bulletOnSpace("-", 1)).toEqual({ text: "• ", caret: 2 });
    expect(bulletOnSpace("a\n*", 3)).toEqual({ text: "a\n• ", caret: 4 });
    expect(bulletOnSpace("a-", 2)).toBeNull();
  });
  it("Shift+Enter adds a line; in a list it continues the list", () => {
    expect(newLine("ab", 1, 1)).toEqual({ text: "a\nb", caret: 2 });
    expect(newLine("• one", 5, 5)).toEqual({ text: "• one\n• ", caret: 8 });
    expect(newLine("x\n2. two", 8, 8)).toEqual({ text: "x\n2. two\n3. ", caret: 12 });
  });
  it("Shift+Enter on an empty item ends the list", () => {
    expect(newLine("• one\n• ", 8, 8)).toEqual({ text: "• one\n", caret: 6 });
    expect(newLine("1. a\n2. ", 8, 8)).toEqual({ text: "1. a\n", caret: 5 });
  });
  it("Backspace right after a mark turns the line back to text", () => {
    expect(unlistOnBackspace("• one", 2)).toEqual({ text: "one", caret: 0 });
    expect(unlistOnBackspace("a\n12. b", 6)).toEqual({ text: "a\nb", caret: 2 });
    expect(unlistOnBackspace("• one", 3)).toBeNull();
  });
});

describe("line breaks in cells survive export", () => {
  const block = { id: "t", type: "table", rows: [["Facts", "B"], ["• one\n• two", "x"]] } as never;
  it("Markdown writes <br> and the importer reads it back", () => {
    const md = toMarkdown({ title: "T", blocks: [block], includeDetails: false } as never);
    expect(md).toContain("| • one<br>• two | x |");
    const back = parseMarkdown(md).find((b) => b.type === "table") as unknown as { rows: string[][] };
    expect(back.rows[1][0]).toBe("• one\n• two");
  });
  it("HTML breaks the line", () => {
    expect(toHtml({ title: "T", blocks: [block] } as never)).toContain("• one<br>• two");
  });
});
