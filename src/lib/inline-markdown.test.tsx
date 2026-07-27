import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderInline, inlineToHtml } from "./inline-markdown";

const html = (s: string) => renderToStaticMarkup(<>{renderInline(s)}</>);

describe("renderInline — six forms", () => {
  it("renders bold", () => {
    expect(html("**strong**")).toContain("<strong");
    expect(html("**strong**")).toContain(">strong<");
  });
  it("renders italic with * and _", () => {
    expect(html("*a*")).toContain("<em");
    expect(html("_b_")).toContain("<em");
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
