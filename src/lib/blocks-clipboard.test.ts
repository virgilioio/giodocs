import { describe, it, expect } from "vitest";
import { blocksToClipboard } from "./blocks-clipboard";
import type { Block } from "./types";

const h1: Block = { id: "a", type: "h1", text: "Title" } as unknown as Block;
const bold: Block = {
  id: "b",
  type: "text",
  text: "hello **world**",
} as unknown as Block;

describe("blocksToClipboard", () => {
  it("markdown joins blockToMarkdown output with blank lines", () => {
    const { markdown } = blocksToClipboard([h1, bold]);
    expect(markdown).toContain("# Title");
    expect(markdown).toContain("hello **world**");
    // Two blocks → one blank line between them.
    expect(markdown.split("\n\n").length).toBeGreaterThanOrEqual(2);
  });

  it("html is non-empty and carries a heading tag and bold run", () => {
    const { html } = blocksToClipboard([h1, bold]);
    expect(html.length).toBeGreaterThan(0);
    // toHtml demotes h1 → h2 for exports; the fragment does the same
    // (it shares blockHtml). Either <h1> or <h2> is acceptable — assert
    // a heading tag is present.
    expect(/<h[1-4]>Title<\/h[1-4]>/.test(html)).toBe(true);
    expect(/<(strong|b)>world<\/(strong|b)>/.test(html)).toBe(true);
  });

  it("single block still round-trips", () => {
    const { markdown, html } = blocksToClipboard([h1]);
    expect(markdown).toBe("# Title");
    expect(html).toContain("Title");
  });
});
