import { describe, expect, it } from "vitest";
import { publicBlocks, publicHref, publicPageHtml } from "./public-page";
import type { PublishedPage } from "./public-links";
import type { Block } from "./types";

const data = (over: Partial<PublishedPage["page"]> = {}): PublishedPage => ({
  workspace: "Virgilio",
  root: "r",
  page: {
    id: "r",
    title: "Plan <b>",
    icon: "📘",
    blocks: [{ id: "a", type: "text", text: "Hello" }],
    is_database: false,
    edited_at: null,
    ...over,
  },
  path: [{ id: "r", title: "Plan", icon: null }],
  children: [{ id: "c", title: "Child & co", icon: "📄", is_database: false }],
  mentioned: [],
  emoji: [],
});

describe("public pages", () => {
  it("puts a note where an inline database was, at any depth", () => {
    const out = publicBlocks([
      { id: "v", type: "view" } as Block,
      { id: "t", type: "toggle", children: [{ id: "v2", type: "view" }] } as unknown as Block,
    ]);
    expect(out[0].type).toBe("callout");
    expect((out[1] as unknown as { children: Block[] }).children[0].type).toBe("callout");
  });

  it("links a page inside the published one by its own address", () => {
    expect(publicHref("tok", "r", "r")).toBe("/s/tok");
    expect(publicHref("tok", "c", "r")).toBe("/s/tok?p=c");
  });

  it("writes the page, escapes titles and lists the pages inside it", () => {
    const html = publicPageHtml(data(), "tok", new Map(), "");
    expect(html).toContain("Hello");
    expect(html).toContain("Plan &lt;b&gt;");
    expect(html).toContain('<base target="_blank"/>');
    expect(html).toContain('<a target="_top" href="/s/tok?p=c">📄 Child &amp; co</a>');
    expect(html).not.toContain("<script");
  });

  it("shows a database page as a note", () => {
    const html = publicPageHtml(data({ is_database: true, blocks: [] }), "tok", new Map(), "");
    expect(html).toContain("Databases aren’t shown on public pages yet.");
  });
});
