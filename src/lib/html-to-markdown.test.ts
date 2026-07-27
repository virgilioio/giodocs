import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "./html-to-markdown";
import { parseMarkdown } from "./markdown-import";
import { blockToMarkdown } from "./export";

describe("htmlToMarkdown — Notion-shaped fragments", () => {
  it("converts headings, bullets, checkboxes, bold/italic, link, table", () => {
    const html = `
      <h1>Title</h1>
      <p>Intro with <strong>bold</strong> and <em>italic</em> and a <a href="https://example.com/x">link</a>.</p>
      <ul>
        <li>alpha</li>
        <li>beta</li>
      </ul>
      <ul>
        <li><input type="checkbox" checked/> done thing</li>
        <li><input type="checkbox"/> open thing</li>
      </ul>
      <table><tbody>
        <tr><th>a</th><th>b</th></tr>
        <tr><td>1</td><td>2</td></tr>
      </tbody></table>
    `;
    const md = htmlToMarkdown(html);
    expect(md).toContain("# Title");
    expect(md).toContain("**bold**");
    expect(md).toContain("*italic*");
    expect(md).toContain("[link](https://example.com/x)");
    expect(md).toContain("- alpha");
    expect(md).toContain("- beta");
    expect(md).toContain("- [x] done thing");
    expect(md).toContain("- [ ] open thing");
    expect(md).toContain("| a | b |");
    expect(md).toContain("| 1 | 2 |");
  });

  it("hands off to parseMarkdown cleanly", () => {
    const html = `<h1>T</h1><p><strong>b</strong></p><ul><li>x</li></ul>`;
    const blocks = parseMarkdown(htmlToMarkdown(html));
    expect(blocks.map((b) => b.type)).toEqual(["h1", "text", "bullet"]);
    expect(blocks[1].text).toContain("**b**");
  });

  it("detects Notion's data-checked attribute", () => {
    const html = `<ul><li data-checked="true">done</li><li data-checked="false">open</li></ul>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("- [x] done");
    expect(md).toContain("- [ ] open");
  });

  it("strips style, class, spans-without-semantics and whitespace", () => {
    const html = `<p style="color:red" class="c"><span>hello <b>world</b></span></p>`;
    expect(htmlToMarkdown(html)).toBe("hello **world**");
  });

  it("preserves <pre><code> content", () => {
    const html = `<pre><code>const x = 1;\n</code></pre>`;
    const md = htmlToMarkdown(html);
    expect(md).toMatch(/```[\s\S]*const x = 1;[\s\S]*```/);
  });
});

describe("XSS — inert output", () => {
  it("drops <script> entirely", () => {
    const md = htmlToMarkdown(`<p>a</p><script>alert('x')</script><p>b</p>`);
    expect(md).not.toContain("alert");
    expect(md).not.toContain("<script");
    expect(md).toContain("a");
    expect(md).toContain("b");
  });
  it("drops onerror and other attributes", () => {
    const md = htmlToMarkdown(`<img src="x" onerror="alert(1)"/>`);
    expect(md).not.toContain("onerror");
    expect(md).not.toContain("alert");
  });
  it("does NOT emit javascript: as a link", () => {
    const md = htmlToMarkdown(`<a href="javascript:alert(1)">click</a>`);
    expect(md).not.toContain("javascript:");
    expect(md).not.toContain("](");
    expect(md).toContain("click");
  });
});

describe("Round-trip: blocks → blockToMarkdown → parseMarkdown", () => {
  it("preserves inline markers verbatim", () => {
    const blocks = [
      { id: "1", type: "text", text: "Plain **bold** and *italic* and `code` and ~~gone~~." },
      { id: "2", type: "h1", text: "**Titled**" },
      { id: "3", type: "bullet", text: "an item with [a link](https://x.example)" },
      { id: "4", type: "numbered", text: "one *emphasised*" },
      { id: "5", type: "quote", text: "> he said **loud**" },
    ] as const;
    const md = blocks
      .map((b, i) =>
        blockToMarkdown(b as never, b.type === "numbered" ? i : 1),
      )
      .join("\n\n");
    const parsed = parseMarkdown(md);
    // Ignoring ids, deep-equal type + text (inline markers preserved).
    expect(parsed.map((b) => ({ type: b.type, text: b.text }))).toEqual(
      blocks.map((b) => ({ type: b.type, text: b.text })),
    );
  });
});
