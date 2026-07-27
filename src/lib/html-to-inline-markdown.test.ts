// @vitest-environment happy-dom
/* Tests for htmlToInlineMarkdown — the total inverse of tokensToHtml
 * over the exact tag set the renderer emits. The round-trip fixture
 * set (source → inlineToHtml → htmlToInlineMarkdown === source) is
 * the load-bearing test: if it holds, typing in a contenteditable
 * cannot corrupt formatting.
 *
 * Runs in happy-dom (a test-only devDependency; never bundled).
 */
import { describe, expect, it } from "vitest";
import { htmlToInlineMarkdown } from "./inline-tokens";
import { inlineToHtml } from "./inline-markdown";

describe("htmlToInlineMarkdown — each emitted tag maps back to its delimiter", () => {
  it("<strong> → **", () => {
    expect(htmlToInlineMarkdown("<strong>bold</strong>")).toBe("**bold**");
  });
  it("<em> → *", () => {
    expect(htmlToInlineMarkdown("<em>it</em>")).toBe("*it*");
  });
  it("<s> → ~~", () => {
    expect(htmlToInlineMarkdown("<s>x</s>")).toBe("~~x~~");
  });
  it("<code> → `", () => {
    expect(htmlToInlineMarkdown("<code>a</code>")).toBe("`a`");
  });
  it("<mark> → ==", () => {
    expect(htmlToInlineMarkdown("<mark>hi</mark>")).toBe("==hi==");
  });
  it("<u> → <u>", () => {
    expect(htmlToInlineMarkdown("<u>u</u>")).toBe("<u>u</u>");
  });
  it("<a> → [label](url)", () => {
    expect(
      htmlToInlineMarkdown('<a href="https://x">label</a>'),
    ).toBe("[label](https://x)");
  });
  it("plain text passes through", () => {
    expect(htmlToInlineMarkdown("hello world")).toBe("hello world");
  });
});

describe("htmlToInlineMarkdown — nesting", () => {
  it("strong containing em", () => {
    expect(
      htmlToInlineMarkdown("<strong>a <em>b</em> c</strong>"),
    ).toBe("**a *b* c**");
  });
  it("em containing strong", () => {
    expect(
      htmlToInlineMarkdown("<em>x <strong>y</strong> z</em>"),
    ).toBe("*x **y** z*");
  });
  it("mark containing code", () => {
    expect(
      htmlToInlineMarkdown("<mark>see <code>fn</code></mark>"),
    ).toBe("==see `fn`==");
  });
});

describe("htmlToInlineMarkdown — browser injection is normalised", () => {
  it("<br> → \\n", () => {
    expect(htmlToInlineMarkdown("a<br>b")).toBe("a\nb");
  });
  it("<div> → \\n before its content", () => {
    expect(htmlToInlineMarkdown("a<div>b</div>")).toBe("a\nb");
  });
  it("&nbsp; → space", () => {
    // Note: parser converts the entity to U+00A0 before we see it.
    const div = document.createElement("div");
    div.innerHTML = "a&nbsp;b";
    expect(htmlToInlineMarkdown(div)).toBe("a b");
  });
  it("unknown wrapper contributes text content only", () => {
    expect(
      htmlToInlineMarkdown('<span style="color:red">hi <strong>x</strong></span>'),
    ).toBe("hi x");
  });
  it("comments contribute nothing", () => {
    expect(htmlToInlineMarkdown("a<!-- c -->b")).toBe("ab");
  });
  it("script contributes nothing", () => {
    expect(htmlToInlineMarkdown("a<script>alert(1)</script>b")).toBe("ab");
  });
  it("style contributes nothing", () => {
    expect(htmlToInlineMarkdown("a<style>x{}</style>b")).toBe("ab");
  });
  it("empty element → \"\"", () => {
    expect(htmlToInlineMarkdown("")).toBe("");
    expect(htmlToInlineMarkdown("<strong></strong>")).toBe("****");
    const el = document.createElement("div");
    expect(htmlToInlineMarkdown(el)).toBe("");
  });
  it("does not throw on genuinely unexpected markup", () => {
    expect(() =>
      htmlToInlineMarkdown('<custom-thing data-x="1"><br><foo>weird</foo></custom-thing>'),
    ).not.toThrow();
  });
});

describe("htmlToInlineMarkdown — accepts an HTMLElement directly", () => {
  it("walks an element rather than a string", () => {
    const el = document.createElement("div");
    el.innerHTML = "hello <strong>bold</strong> end";
    expect(htmlToInlineMarkdown(el)).toBe("hello **bold** end");
  });
});

/* THE ROUND TRIP — the test that matters. Every fixture is a source
 * string; each round-trips through inlineToHtml (which is the exact
 * output the renderer emits) and back through htmlToInlineMarkdown
 * byte-for-byte. If this holds for every fixture, typing in a
 * contenteditable rendered from these tokens cannot corrupt
 * formatting.
 */
const ROUND_TRIP_FIXTURES: string[] = [
  "",
  "plain text",
  "**bold**",
  "*italic*",
  "~~strike~~",
  "`code`",
  "==highlight==",
  "<u>underline</u>",
  "[label](https://example.com)",
  "**a** *b* `c` ==d== ~~e~~ <u>f</u>",
  "**bold with *italic* inside**",
  "*italic with **bold** inside*",
  "==mark with `code` inside==",
  "prefix **bold** middle *italic* suffix",
  "trailing space **bold** ",
  " leading space *italic*",
  "unmatched **a",
  "unmatched *b",
  "unmatched ~~c",
  "just a lone [ and ] and (",
  "backticks with `stars **inside** stay literal`",
  "[nested **bold** in label](https://x)",
];

describe("htmlToInlineMarkdown — ROUND TRIP", () => {
  for (const src of ROUND_TRIP_FIXTURES) {
    it(`round-trips: ${JSON.stringify(src)}`, () => {
      const html = inlineToHtml(src);
      const back = htmlToInlineMarkdown(html);
      expect(back).toBe(src);
    });
  }
});
