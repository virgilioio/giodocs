import { describe, expect, it, vi } from "vitest";
import {
  blockToMarkdown,
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

  it("degrades unknown block types to plain text (no throw)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => toMarkdown({ ...base, blocks: [B("mystery", { text: "x" })] })).not.toThrow();
    spy.mockRestore();
  });

  it("emits true ordinals for a run of numbered blocks", () => {
    // BUG 1: even though GFM renumbers, exported files should read the way
    // the page reads. Three consecutive numbereds → 1., 2., 3.
    const md = toMarkdown({
      ...base,
      blocks: [
        B("numbered", { id: "n1", text: "first" }),
        B("numbered", { id: "n2", text: "second" }),
        B("numbered", { id: "n3", text: "third" }),
      ],
    });
    expect(md).toContain("\n1. first\n");
    expect(md).toContain("\n2. second\n");
    expect(md).toContain("\n3. third\n");
  });

  it("survives realistic PageFull edge cases (null verified_by, empty tags, unresolved owner)", () => {
    // BUG 2 regression fixture — these three shapes are the ones most likely
    // to throw against real data. Neither toMarkdown nor toHtml may throw.
    const blocks: Block[] = [
      B("text", { text: "intro" }),
      B("numbered", { id: "n1", text: "one" }),
      B("numbered", { id: "n2", text: "two" }),
      B("todo", { text: "check", checked: false }),
      B("code", { text: "x = 1" }),
    ];
    const ctx = {
      title: "Real page",
      area: "Ops",
      status: null,
      ownerName: null, // owner id not present in members → no name resolved
      tags: [], // empty tags array
      verifiedAt: null, // verified_by null → verifiedAt null
      blocks,
    };
    expect(() => toMarkdown(ctx)).not.toThrow();
    expect(() => toHtml(ctx)).not.toThrow();
    const html = toHtml(ctx);
    // Consecutive numbered blocks merge into ONE <ol> in the outline
    // renderer; both list items live inside it in order.
    expect(html).toContain('<ol><li>one</li><li>two</li></ol>');
  });
});

describe("blockToMarkdown", () => {
  it("divider serialises to '---' with no trailing newline", () => {
    expect(blockToMarkdown(B("divider"))).toBe("---");
  });
  it("todo checked serialises to '- [x] text'", () => {
    expect(blockToMarkdown(B("todo", { text: "ship it", checked: true }))).toBe(
      "- [x] ship it",
    );
    expect(blockToMarkdown(B("todo", { text: "later", checked: false }))).toBe(
      "- [ ] later",
    );
  });
  it("table serialises to a GFM pipe table with a --- separator row", () => {
    const md = blockToMarkdown(
      B("table", { rows: [["A", "B"], ["1", "2"], ["3", "4"]] }),
    );
    expect(md).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |");
  });
  it("toMarkdown output for each block matches blockToMarkdown for that block", () => {
    // Prove the extraction didn't change per-block output: for every kind,
    // running the full pipeline should embed blockToMarkdown(b) verbatim.
    const cases: Block[] = [
      B("text", { text: "hi" }),
      B("h1", { text: "H" }),
      B("h2", { text: "H2" }),
      B("bullet", { text: "b" }),
      B("numbered", { text: "n" }),
      B("todo", { text: "t", checked: true }),
      B("toggle", { text: "top", body: "inner" }),
      B("quote", { text: "q" }),
      B("callout", { text: "note", icon: "⚠️" }),
      B("divider"),
      B("code", { text: "x = 1", lang: "py" }),
      B("table", { rows: [["A"], ["1"]] }),
    ];
    for (const c of cases) {
      const md = toMarkdown({ title: "Sample", blocks: [c] });
      expect(md).toContain(blockToMarkdown(c));
    }
  });
});

describe("callout with children serialisation", () => {
  const cwith = () =>
    ({
      id: "ca",
      type: "callout",
      text: "",
      icon: "💡",
      children: [
        { id: "k1", type: "text", text: "one" },
        { id: "k2", type: "numbered", text: "two" },
      ],
    }) as unknown as Block;

  it("blockToMarkdown emits '> {icon}' first line then quoted children", () => {
    const md = blockToMarkdown(cwith());
    // First line carries the icon; subsequent lines are each child's
    // markdown, `> `-prefixed line by line.
    expect(md.split("\n")).toEqual(["> 💡", "> one", "> 1. two"]);
  });

  it("legacy callout without children still emits '> {icon} {text}'", () => {
    const md = blockToMarkdown(
      B("callout", { text: "note", icon: "⚠️" }),
    );
    expect(md).toBe("> ⚠️ note");
  });

  it("empty children array falls back to the legacy single-line form", () => {
    const md = blockToMarkdown(
      B("callout", { text: "hi", icon: "💡", children: [] as unknown }),
    );
    expect(md).toBe("> 💡 hi");
  });
});

describe("columns block serialisation", () => {
  const cb = (n: number) => ({
    id: "c1",
    type: "columns",
    cols: Array.from({ length: n }, (_, i) => [
      { id: `a${i}`, type: "text", text: `alpha-${i}` },
      { id: `b${i}`, type: "numbered", text: `beta-${i}` },
    ]),
  } as unknown as Block);

  it("blockToMarkdown flattens both columns in order, blank line between", () => {
    const md = blockToMarkdown(cb(2));
    // Each column's blocks appear in order; 1. resets per column.
    expect(md).toContain("alpha-0\n\n1. beta-0");
    expect(md).toContain("alpha-1\n\n1. beta-1");
    // Column 0 content appears before column 1 content
    expect(md.indexOf("alpha-0")).toBeLessThan(md.indexOf("alpha-1"));
    // No column marker in the output
    expect(md).not.toMatch(/col2|columns|::col/i);
  });

  it("toHtml emits a real CSS grid with repeat(N,minmax(0,1fr))", () => {
    const html = toHtml({ title: "T", blocks: [cb(3)] });
    expect(html).toContain('grid-template-columns:repeat(3,minmax(0,1fr))');
    expect(html).toContain("alpha-0");
    expect(html).toContain("alpha-2");
    // User text is escaped through the normal path
    const dangerous = {
      id: "c2",
      type: "columns",
      cols: [
        [{ id: "x", type: "text", text: "<script>bad()</script>" }],
        [{ id: "y", type: "text", text: "safe" }],
      ],
    } as unknown as Block;
    const h2 = toHtml({ title: "T", blocks: [dangerous] });
    expect(h2).not.toContain("<script>bad()</script>");
    expect(h2).toContain("&lt;script&gt;bad()&lt;/script&gt;");
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

describe("h3, caption, and toggle-heading serialisation", () => {
  it("blockToMarkdown round-trips h3 (### heading)", () => {
    expect(blockToMarkdown(B("h3", { text: "Small" }))).toBe("### Small");
  });

  it("toHtml emits <h4> for h3 and escapes text", () => {
    const html = toHtml({ title: "T", blocks: [B("h3", { text: "<x>" })] });
    expect(html).toContain("<h4>&lt;x&gt;</h4>");
  });

  it("caption exports as plain paragraph in markdown and <p class=\"caption\"> in HTML", () => {
    expect(blockToMarkdown(B("caption", { text: "note" }))).toBe("note");
    const html = toHtml({ title: "T", blocks: [B("caption", { text: "note" })] });
    expect(html).toContain('<p class="caption">note</p>');
  });

  it("levelled toggle emits summary at heading depth in markdown", () => {
    expect(
      blockToMarkdown(B("toggle", { text: "Sec", body: "hi", level: "h2" })),
    ).toBe("## Sec\n\nhi");
  });

  it("levelled toggle wraps summary in <h3> for h2 (post-demotion)", () => {
    const html = toHtml({
      title: "T",
      blocks: [B("toggle", { text: "Sec", level: "h2" })],
    });
    expect(html).toContain("<summary><h3>Sec</h3></summary>");
  });

  it("plain toggle (no level) keeps today's output — regression guard", () => {
    expect(
      blockToMarkdown(B("toggle", { text: "Details", body: "line" })),
    ).toBe("**Details**\n  line");
    const html = toHtml({
      title: "T",
      blocks: [B("toggle", { text: "Details" })],
    });
    expect(html).toContain("<summary>Details</summary>");
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

describe("unknown block types (graceful fallback)", () => {
  it("blockToMarkdown returns plain text and does not throw", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const b = { type: "paragraph", text: "legacy content" } as unknown as Block;
    expect(() => blockToMarkdown(b)).not.toThrow();
    expect(blockToMarkdown(b)).toBe("legacy content");
    spy.mockRestore();
  });
  it("toHtml emits <p>escaped</p> for unknown block and does not throw", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = toHtml({
      title: "T",
      blocks: [{ type: "paragraph", text: "<b>hi</b>" } as unknown as Block],
    });
    expect(html).toContain("<p>&lt;b&gt;hi&lt;/b&gt;</p>");
    spy.mockRestore();
  });
  it("toMarkdown embeds unknown block as plain paragraph", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const md = toMarkdown({
      title: "T",
      blocks: [{ type: "paragraph", text: "hello world" } as unknown as Block],
    });
    expect(md).toContain("hello world");
  spy.mockRestore();
  });
});

describe("includeDetails toggle", () => {
  const richCtx = {
    title: "My Page",
    area: "Engineering",
    status: "Active",
    ownerName: "Ada Lovelace",
    tags: ["alpha", "beta"],
    verifiedAt: "2024-06-01T10:00:00Z",
    blocks: [{ type: "paragraph", text: "body" } as unknown as Block],
  };

  it("toMarkdown with details OFF starts with '# ' and has no front matter", () => {
    const md = toMarkdown({ ...richCtx, includeDetails: false });
    expect(md.startsWith("# ")).toBe(true);
    expect(md.indexOf("---")).not.toBe(0);
    expect(md).not.toContain("area:");
    expect(md).not.toContain("status:");
  });

  it("toMarkdown with details ON emits title/area/status/owner/tags/verified", () => {
    const md = toMarkdown({ ...richCtx, includeDetails: true });
    expect(md.startsWith("---")).toBe(true);
    expect(md).toContain("title:");
    expect(md).toContain("area:");
    expect(md).toContain("status:");
    expect(md).toContain("owner:");
    expect(md).toContain("tags:");
    expect(md).toContain("verified:");
  });

  it("toHtml with details OFF has no <dl and no orphaned header rule", () => {
    const html = toHtml({ ...richCtx, includeDetails: false });
    expect(html).not.toContain("<dl");
    expect(html).not.toContain('<header class="meta"');
    expect(html).toContain("<h1 class=\"title\">My Page</h1>");
  });

  it("toHtml with details ON contains <dl and header.meta", () => {
    const html = toHtml({ ...richCtx, includeDetails: true });
    expect(html).toContain("<dl");
    expect(html).toContain('<header class="meta"');
  });

  it("toHtml always contains the masthead and the page title", () => {
    for (const inc of [true, false]) {
      const html = toHtml({ ...richCtx, includeDetails: inc });
      expect(html).toContain('class="masthead"');
      expect(html).toContain("My Page");
    }
  });

  it("toHtml contains no fixed-position footer (deleted — fought pagination)", () => {
    const html = toHtml(richCtx);
    expect(html).not.toContain("print-footer");
    expect(html).not.toMatch(/position:\s*fixed/);
  });

  it("toHtml declares real @page margins and page-break controls", () => {
    const html = toHtml(richCtx);
    expect(html).toMatch(/@page\s*{[^}]*margin:\s*0\.8in\s+0\.75in/);
    expect(html).toContain("break-inside: avoid");
    expect(html).toContain("orphans: 3");
    expect(html).toContain("print-color-adjust: exact");
    expect(html).toContain("display: table-header-group");
  });

  it("toHtml contains no external references (self-contained)", () => {
    for (const inc of [true, false]) {
      const html = toHtml({ ...richCtx, includeDetails: inc });
      // Base64 data URI is fine; assert no protocol references outside it.
      // Strip data: URIs first so their inner blobs don't false-positive.
      const stripped = html.replace(/data:[^"'\s)]+/g, "");
      expect(stripped).not.toContain("http://");
      expect(stripped).not.toContain("https://");
      expect(stripped).not.toContain("<script");
    }
  });
});

describe("nested list HTML — outline exports", () => {
  it("nests <ul>/<ol> and closes parent <li> when ascending", () => {
    const blocks = [
      { id: "a", type: "bullet", text: "a", indent: 0 },
      { id: "b", type: "bullet", text: "b", indent: 1 },
      { id: "c", type: "bullet", text: "c", indent: 1 },
      { id: "d", type: "bullet", text: "d", indent: 0 },
    ] as unknown as Block[];
    const html = toHtml({ title: "T", blocks, includeDetails: false });
    expect(html).toContain(
      "<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>",
    );
  });
  it("switches list tag when a numbered follows a bullet at same depth", () => {
    const blocks = [
      { id: "a", type: "bullet", text: "a", indent: 0 },
      { id: "b", type: "numbered", text: "b", indent: 0 },
    ] as unknown as Block[];
    const html = toHtml({ title: "T", blocks, includeDetails: false });
    expect(html).toContain("<ul><li>a</li></ul>");
    expect(html).toContain("<ol><li>b</li></ol>");
  });
});

describe("blockToMarkdown — indent prefix", () => {
  it("emits 2 spaces per indent level for bullet/numbered/todo", () => {
    expect(blockToMarkdown({ type: "bullet", text: "x", indent: 2 } as never))
      .toBe("    - x");
    expect(
      blockToMarkdown({ type: "numbered", text: "y", indent: 1 } as never, 3),
    ).toBe("  3. y");
    expect(
      blockToMarkdown({ type: "todo", text: "z", indent: 1, checked: true } as never),
    ).toBe("  - [x] z");
  });
});
