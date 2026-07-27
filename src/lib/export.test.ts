import { describe, expect, it } from "vitest";
import {
  slugOf,
  toCsv,
  toHtml,
  toMarkdown,
  toMarkdownTable,
  type ExportViewRow,
} from "./export";
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
    expect(md).toMatch(/status: In progress/);
    expect(md).toMatch(/owner: Dana Ruiz/);
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

/* ─────────────────────────── View exports ─────────────────────────── */

const mkRow = (over: Partial<ExportViewRow> = {}): ExportViewRow => ({
  title: "Sample",
  area: null,
  ownerId: null,
  status: null,
  tags: [],
  verifiedAt: null,
  editedAt: null,
  ...over,
});

const resolveOwner = (id: string | null) =>
  id === "u1" ? "Dana Ruiz" : id === "u2" ? "Sam Lee" : "";

describe("toCsv", () => {
  it("quotes fields with commas and doubles embedded quotes; uses CRLF", () => {
    const csv = toCsv(
      [
        mkRow({
          title: 'Kickoff, part "1"',
          area: "Ops",
          ownerId: "u1",
          status: "In progress",
          tags: ["urgent", "q3"],
          verifiedAt: "2026-07-25T12:34:56Z",
          editedAt: "2026-07-27T01:00:00Z",
        }),
      ],
      {
        columns: ["title", "area", "owner", "status", "tags", "verified", "edited"],
        resolveOwner,
      },
    );
    // CRLF line endings, one header + one row
    expect(csv.endsWith("\r\n")).toBe(true);
    const lines = csv.split("\r\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(2);
    // Header
    expect(lines[0]).toBe("Page,Area,Owner,Status,Tags,Verified,Edited");
    // Title contains both a comma and an embedded quote — must be quoted with "" for the quote
    expect(lines[1]).toContain('"Kickoff, part ""1"""');
    // Tags joined with "; "
    expect(lines[1]).toContain("urgent; q3");
    // Owner resolved via callback
    expect(lines[1]).toContain("Dana Ruiz");
    // Dates as ISO 8601 calendar date (YYYY-MM-DD)
    expect(lines[1]).toContain("2026-07-25");
    expect(lines[1]).toContain("2026-07-27");
  });

  it("Untitled fallback + column selection (omits unchecked columns entirely)", () => {
    const csv = toCsv(
      [mkRow({ title: "   ", ownerId: "u2", tags: ["a"] })],
      { columns: ["title", "owner"], resolveOwner },
    );
    // Only two columns in header and body
    expect(csv.split("\r\n")[0]).toBe("Page,Owner");
    expect(csv.split("\r\n")[1]).toBe("Untitled,Sam Lee");
    // Tags column omitted
    expect(csv).not.toContain("Tags");
  });
});

describe("toMarkdownTable", () => {
  it("emits GFM header + separator, escapes pipes in cells, keeps raw ISO dates", () => {
    const md = toMarkdownTable(
      [
        mkRow({
          title: "a | b",
          ownerId: "u1",
          verifiedAt: "2026-07-25T12:34:56Z",
          editedAt: "2026-07-27T01:00:00Z",
        }),
      ],
      {
        columns: ["title", "owner", "verified", "edited"],
        resolveOwner,
      },
    );
    const lines = md.split("\n");
    expect(lines[0]).toBe("| Page | Owner | Verified | Edited |");
    expect(lines[1]).toBe("| --- | --- | --- | --- |");
    // Escaped pipe in title
    expect(lines[2]).toContain("a \\| b");
    // Dates stay ISO (full timestamp), not date-only
    expect(lines[2]).toContain("2026-07-25T12:34:56.000Z");
    expect(lines[2]).toContain("2026-07-27T01:00:00.000Z");
  });

  it("respects column selection — unchecked columns don't appear anywhere", () => {
    const md = toMarkdownTable(
      [mkRow({ title: "hi", tags: ["skip-me"], area: "Ops" })],
      { columns: ["title", "area"], resolveOwner },
    );
    expect(md).toContain("| Page | Area |");
    expect(md).not.toContain("Tags");
    expect(md).not.toContain("skip-me");
  });
});
