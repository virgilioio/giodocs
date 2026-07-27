import { describe, it, expect } from "vitest";
import { htmlToBlocks, htmlToMarkdown } from "./html-to-markdown";
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

/* ─────────────────── Notion callouts (styled div/figure) ─────────────────── */
describe("Notion callouts → `> {emoji} {text}` → callout block", () => {
  it("class='callout' with an emoji span converts and parses", () => {
    const html = `
      <div class="notion-callout callout">
        <span>💡</span>
        <div>Heads up — remember the client.</div>
      </div>
    `;
    const md = htmlToMarkdown(html);
    expect(md).toBe("> 💡 Heads up — remember the client.");
    const blocks = parseMarkdown(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("callout");
    expect(blocks[0].icon).toBe("💡");
    expect(blocks[0].text).toContain("Heads up");
  });

  it("preserves a non-💡 emoji", () => {
    const html = `<figure class="callout"><span>⚠️</span><p>Beware</p></figure>`;
    const md = htmlToMarkdown(html);
    expect(md).toBe("> ⚠️ Beware");
    const blocks = parseMarkdown(md);
    expect(blocks[0].type).toBe("callout");
    expect(blocks[0].icon).toBe("⚠️");
  });

  it("shape-based: div with leading emoji child, no class", () => {
    const html = `<div><div>🔥</div><div>Hot take</div></div>`;
    const md = htmlToMarkdown(html);
    expect(md).toBe("> 🔥 Hot take");
    expect(parseMarkdown(md)[0].type).toBe("callout");
  });

  it("class='callout' without any emoji defaults to 💡", () => {
    const html = `<div class="callout"><p>Just text</p></div>`;
    const md = htmlToMarkdown(html);
    expect(md).toBe("> 💡 Just text");
    const blocks = parseMarkdown(md);
    expect(blocks[0].type).toBe("callout");
    expect(blocks[0].icon).toBe("💡");
  });

  it("malformed callout still yields the text, never vanishes", () => {
    // No class, no leading emoji — must fall back to a paragraph.
    const html = `<div><span>plain container</span> some words</div>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("plain container");
    expect(md).toContain("some words");
    // And it must not be swallowed as a callout.
    expect(md.startsWith(">")).toBe(false);
  });
});

/* ─────────── Integration: full legal-contract shape round-trip ─────────── */
describe("legal-contract fixture → block sequence", () => {
  it("preserves heading levels, bold-in-heading, dividers, bullets, table", () => {
    const fixture = `
      <h2>Sección A</h2>
      <p>Firma: ___________________________</p>
      <hr />
      <h3><strong>SEXTA. OBLIGACIONES DEL CLIENTE</strong></h3>
      <p>El cliente <strong>deberá</strong> lo siguiente:</p>
      <ul>
        <li>pagar a tiempo</li>
        <li>notificar cambios</li>
      </ul>
      <hr />
      <h3>Datos</h3>
      <table>
        <tr><th>Campo</th><th>Valor</th><th>Fuente</th><th>Notas</th></tr>
        <tr><td>Nombre</td><td>_________</td><td>—</td><td>—</td></tr>
      </table>
    `;
    const md = htmlToMarkdown(fixture);
    const blocks = parseMarkdown(md);
    // Heading levels: our model collapses h3+ to h2.
    expect(blocks.map((b) => b.type)).toEqual([
      "h2", // <h2> → ## (our model collapses to h1/h2 only; h1 stays h1)
      "text",
      "divider",
      "h2",
      "text",
      "bullet",
      "bullet",
      "divider",
      "h2",
      "table",
    ]);
    // The bold-wrapped heading must keep its ** so renderInline bolds it
    // at render time — it must NOT arrive as a text block.
    const boldedHeading = blocks[3];
    expect(boldedHeading.type).toBe("h2");
    expect(boldedHeading.text).toContain("**");
    expect(boldedHeading.text).toContain("SEXTA");
    // Underscore fill-in blanks survive untouched.
    expect(blocks[1].text).toContain("___________________________");
  });
});

/* ─────────────────── htmlToBlocks (structured) ─────────────────── */
describe("htmlToBlocks — Notion column_list → columns block", () => {
  it("builds a columns block with the correct count and preserved content", () => {
    const html = `
      <div class="column_list">
        <div class="column"><p>left one</p><ul><li>a</li></ul></div>
        <div class="column"><h2>right</h2><p>two</p></div>
      </div>
    `;
    const blocks = htmlToBlocks(html);
    expect(blocks).not.toBeNull();
    expect(blocks!.length).toBe(1);
    const cb = blocks![0] as { type?: string; cols?: unknown[][] };
    expect(cb.type).toBe("columns");
    expect(cb.cols!.length).toBe(2);
    // Left column: contains a paragraph and a bullet
    const leftTexts = (cb.cols![0] as Array<{ type?: string; text?: string }>).map(
      (b) => `${b.type}:${b.text}`,
    );
    expect(leftTexts.some((s) => s.startsWith("text:") && s.includes("left one"))).toBe(true);
    expect(leftTexts.some((s) => s.startsWith("bullet:") && s.includes("a"))).toBe(true);
    // Right column: h2 + paragraph
    const rightTexts = (cb.cols![1] as Array<{ type?: string; text?: string }>).map(
      (b) => `${b.type}:${b.text}`,
    );
    expect(rightTexts.some((s) => s.startsWith("h2:") && s.includes("right"))).toBe(true);
    expect(rightTexts.some((s) => s.startsWith("text:") && s.includes("two"))).toBe(true);
  });

  it("returns null when no column_list is present (caller falls back)", () => {
    const html = `<h1>Just a page</h1><p>no columns here</p>`;
    expect(htmlToBlocks(html)).toBeNull();
    // And the fallback path yields the text as stacked blocks.
    const parsed = parseMarkdown(htmlToMarkdown(html));
    expect(parsed.map((b) => b.type)).toEqual(["h1", "text"]);
  });

  it("clamps at 6 columns — overflow content flattened into last kept column", () => {
    const cols = Array.from(
      { length: 8 },
      (_, i) => `<div class="column"><p>c${i}</p></div>`,
    ).join("");
    const html = `<div class="column_list">${cols}</div>`;
    const blocks = htmlToBlocks(html);
    expect(blocks).not.toBeNull();
    const cb = blocks![0] as { cols?: unknown[][] };
    expect(cb.cols!.length).toBe(6);
    // Overflow c6, c7 pushed into last kept column (index 5).
    const last = cb.cols![5] as Array<{ text?: string }>;
    const combined = last.map((b) => b.text ?? "").join("|");
    expect(combined).toContain("c5");
    expect(combined).toContain("c6");
    expect(combined).toContain("c7");
  });
});

