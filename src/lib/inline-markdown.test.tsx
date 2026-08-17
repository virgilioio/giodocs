import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderInline, inlineToHtml } from "./inline-markdown";

const html = (s: string) => renderToStaticMarkup(<>{renderInline(s)}</>);

describe("renderInline — six forms", () => {
  it("renders bold", () => {
    expect(html("**strong**")).toContain("<strong");
    expect(html("**strong**")).toContain(">strong<");
  });
  it("renders italic with * (underscore is NOT a delimiter)", () => {
    expect(html("*a*")).toContain("<em");
    // Deliberately: _b_ must NOT parse as italic — see file header.
    expect(html("_b_")).not.toContain("<em");
    expect(html("_b_")).toContain("_b_");
  });
  it("renders strike", () => {
    expect(html("~~gone~~")).toContain("<s");
  });
  it("renders code", () => {
    const s = html("`x`");
    expect(s).toContain("<code");
    expect(s).toContain(">x<");
  });
  it("renders underline via inline HTML", () => {
    expect(html("<u>u</u>")).toContain("<u");
  });
  it("renders a link with href and label", () => {
    const s = html("[Docs](https://example.com/x)");
    expect(s).toContain('href="https://example.com/x"');
    expect(s).toContain(">Docs<");
    expect(s).toContain('target="_blank"');
    expect(s).toContain('rel="noopener noreferrer"');
  });
});

describe("renderInline — nesting", () => {
  it("bold containing italic (two deep)", () => {
    const s = html("**bold with *italic* inside**");
    expect(s).toMatch(/<strong[^>]*>.*<em[^>]*>italic<\/em>.*<\/strong>/);
  });
  it("code contents are never parsed", () => {
    // Inside a code span, asterisks are literal.
    const s = html("`no **bold** here`");
    expect(s).toContain("no **bold** here");
    expect(s).not.toContain("<strong");
  });
});

describe("renderInline — malformed & escapes", () => {
  it("unmatched delimiters render literally", () => {
    const s = html("a ** b");
    expect(s).not.toContain("<strong");
    expect(s).toContain("**");
  });
  it("a lone asterisk is literal", () => {
    const s = html("2 * 3");
    expect(s).not.toContain("<em");
    expect(s).toContain("*");
  });
  it("backslash-star renders a literal star", () => {
    const s = html("\\*not italic\\*");
    expect(s).not.toContain("<em");
    expect(s).toContain("*not italic*");
  });
  it("does not throw on nonsense", () => {
    expect(() => renderInline("**")).not.toThrow();
    expect(() => renderInline("[unclosed](")).not.toThrow();
    expect(() => renderInline("~~ ~ ~ ~~")).not.toThrow();
  });
});

describe("renderInline — dangerous links", () => {
  it("javascript: hrefs never emit an <a> element", () => {
    const s = html("[click](javascript:alert(1))");
    expect(s).not.toContain("<a");
  });
  it("data: URLs never emit an <a> element", () => {
    const s = html("[x](data:text/html,<script>)");
    expect(s).not.toContain("<a");
  });
});

describe("inlineToHtml", () => {
  it("emits the same anchor classes the React renderer uses", () => {
    expect(inlineToHtml("[a](https://x.com)")).toContain(
      'class="text-accent hover:underline"',
    );
  });
  it("escapes user text before wrapping", () => {
    // "<script>" inside a bold marker must be escaped in output.
    expect(inlineToHtml("**<script>**")).toBe("<strong>&lt;script&gt;</strong>");
  });

  it("escapes href", () => {
    const s = inlineToHtml('[a](https://x.com/?a="b")');
    expect(s).toContain("&quot;");
  });
  it("does not emit dangerous links", () => {
    expect(inlineToHtml("[x](javascript:alert(1))")).not.toContain("<a ");
  });
});

/* ─────────── Underscore runs must never be treated as italic ─────────── */
describe("renderInline — underscore runs (legal-contract fill-ins)", () => {
  it("preserves a long fill-in blank verbatim", () => {
    const s = "_____________________";
    const out = html(s);
    expect(out).not.toContain("<em");
    // The run of underscores must appear verbatim in the rendered output.
    expect(out).toContain(s);
  });
  it("preserves 'Firma: ___________________________'", () => {
    const s = "Firma: ___________________________";
    const out = html(s);
    expect(out).not.toContain("<em");
    expect(out).toContain(s);
  });
  it("preserves 'a_b_c' unchanged", () => {
    const s = "a_b_c";
    const out = html(s);
    expect(out).not.toContain("<em");
    expect(out).toContain(s);
  });
  it("*real italic* still works alongside underscores", () => {
    const s = "____ *emphasised* ____";
    const out = html(s);
    expect(out).toContain("<em");
    expect(out).toContain("emphasised");
    // The surrounding underscore runs survive.
    expect(out).toContain("____");
  });
  it("a lone ~~ or ** does not eat following text", () => {
    expect(html("a ** b c")).not.toContain("<strong");
    expect(html("a ~~ b c")).not.toContain("<s");
    expect(html("a ** b c")).toContain("a ** b c");
  });
});

describe("renderInline / inlineToHtml — highlight ==…==", () => {
  it("renders ==text== as <mark>", () => {
    const s = html("hello ==world== end");
    expect(s).toContain("<mark");
    expect(s).toContain("world");
    expect(s).not.toContain("==world==");
  });
  it("unmatched == renders literally", () => {
    const s = html("a == b");
    expect(s).not.toContain("<mark");
    expect(s).toContain("==");
  });
  it("== inside `code` is NOT parsed", () => {
    const s = html("`==literal==`");
    expect(s).toContain("<code");
    expect(s).toContain("==literal==");
    expect(s).not.toContain("<mark");
  });
  it("inlineToHtml emits <mark> and escapes user text inside", () => {
    const out = inlineToHtml("==<script>==");
    expect(out).toContain("<mark>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script>");
  });
  it("bold can nest inside highlight", () => {
    const s = html("==a **b** c==");
    expect(s).toMatch(/<mark[^>]*>.*<strong[^>]*>b<\/strong>.*<\/mark>/);
  });
});
