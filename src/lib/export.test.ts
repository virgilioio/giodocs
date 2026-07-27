import { describe, expect, it } from "vitest";
import { slugOf, toHtml, toMarkdown } from "./export";
import type { Block } from "./types";

const B = (type: string, extra: Record<string, unknown> = {}): Block =>
  ({ type, ...extra } as Block);

describe("slugOf", () => {
  it("empties fall back to 'untitled'", () => {
    expect(slugOf("")).toBe("untitled");
    expect(slugOf(null)).toBe("untitled");
    expect(slugOf("   ")).toBe("untitled");
    expect(slugOf("///")).toBe("untitled");
  });
  it("strips accents, emoji, and slashes and caps at 28 chars", () => {
    // acceptance 16 flavour: emoji + accent + slash in a long title
    const s = slugOf("🚀 Naïve / Design — a very long working title");
    expect(s).toBe("naive-design-a-very-long-wor");
    expect(s.length).toBeLessThanOrEqual(28);
    expect(/^[a-z0-9-]+$/.test(s)).toBe(true);
    expect(s.startsWith("-")).toBe(false);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("toMarkdown", () => {
  const base = { title: "Sample", blocks: [] as Block[] };

  it("emits YAML front matter for provided properties", () => {
    const md = toMarkdown({
      title: "Kickoff",
      area: "Ops",
      status: "In progress",
      ownerName: "Dana Ruiz",
      tags: ["urgent", "q3"],
      verifiedAt: "2026-07-25T12:34:56Z",
      blocks: [],
    });
    expect(md).toMatch(/^---\ntitle: Kickoff\narea: Ops\n/);
    expect(md).toMatch(/status: "In progress"/);
    expect(md).toMatch(/owner: "Dana Ruiz"/);
    expect(md).toMatch(/tags: \[urgent, q3\]/);
    expect(md).toMatch(/verified: 2026-07-25/);
  });

  it("renders every block type", () => {
    const blocks: Block[] = [
      B("text", { text: "hello" }),
      B("h1", { text: "Big" }),
      B("h2", { text: "Small" }),
      B("bullet", { text: "point" }),
      B("numbered", { text: "step" }),
      B("todo", { text: "done", checked: true }),
      B("todo", { text: "open", checked: false }),
      B("toggle", { text: "more", body: "hidden" }),
      B("quote", { text: "q" }),
      B("callout", { text: "note", icon: "⚠️" }),
      B("divider"),
      B("code", { text: "console.log(1)", lang: "js" }),
      B("table", { rows: [["A", "B"], ["1", "2"], ["3", "4"]] }),
    ];
    const md = toMarkdown({ ...base, blocks });
    expect(md).toContain("\nhello\n");
    expect(md).toContain("\n# Big\n");
    expect(md).toContain("\n## Small\n");
    expect(md).toContain("\n- point\n");
    expect(md).toContain("\n1. step\n");
    expect(md).toContain("\n- [x] done\n");
    expect(md).toContain("\n- [ ] open\n");
    expect(md).toContain("\n**more**\n  hidden\n");
    expect(md).toContain("\n> q\n");
    expect(md).toContain("\n> ⚠️ note\n");
    expect(md).toMatch(/\n---\n/); // divider (also front-matter delimiter)
    expect(md).toContain("\n```js\nconsole.log(1)\n```\n");
    // pipe table with separator row after row 0
    expect(md).toContain("\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n");
  });

  it("throws on unknown block types (no silent default)", () => {
    expect(() => toMarkdown({ ...base, blocks: [B("mystery")] })).toThrow();
  });
});

describe("toHtml", () => {
  it("escapes <script> in page content", () => {
    const html = toHtml({
      title: "Danger <script>alert(1)</script>",
      blocks: [
        { type: "text", text: "<script>alert('x')</script>" } as Block,
        { type: "code", text: "</style><script>bad()</script>" } as Block,
      ],
    });
    // Every angle bracket from user content is escaped
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<script>alert('x')</script>");
    expect(html).not.toContain("</style><script>bad()</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    // The document itself carries exactly one <style> block (ours)
    expect(html.match(/<style>/g)?.length).toBe(1);
    expect(html.match(/<\/style>/g)?.length).toBe(1);
    // No stray script tags in the emitted document
    expect(/<script\b/i.test(html)).toBe(false);
  });
});
