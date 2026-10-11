// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { htmlToInlineMarkdown, mentionSource, tokenizeInline } from "./inline-tokens";
import { inlineToHtml } from "./inline-markdown";
import { buildOffsetMap } from "./ce-offsets";
import { splitInlineSource } from "./split-inline";
import { __resetMentionDirectory, setMentionDirectory } from "./mention-directory";

const SAM = "0b5e8f3c-1d2a-4c6e-9f00-123456789abc";
const PAGE = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function dir(users: Record<string, string>, pages: Record<string, string> = {}) {
  setMentionDirectory({
    users: new Map(Object.entries(users)),
    pages: new Map(Object.entries(pages).map(([k, v]) => [k, { title: v, icon: null }])),
  });
}

afterEach(() => __resetMentionDirectory());

describe("mention grammar", () => {
  it("parses people and pages, ahead of links", () => {
    const src = `Ask ${mentionSource("user", SAM, "Sam")} about ${mentionSource("page", PAGE, "Secret plan")} and [docs](https://a.io)`;
    expect(src).toContain(`@[](page:${PAGE})`); // a page title is never stored
    const kinds = tokenizeInline(src).filter((t) => t.kind !== "text").map((t) => t.kind);
    expect(kinds).toEqual(["mention", "mention", "link"]);
  });

  it("keeps brackets and line breaks out of a stored name", () => {
    expect(mentionSource("user", SAM, "Sam [ops]\nR")).toBe(`@[Sam ops R](user:${SAM})`);
  });

  it("leaves a malformed mention as text", () => {
    const toks = tokenizeInline("@[Sam](user:not-an-id) and @Sam");
    expect(toks.some((t) => t.kind === "mention")).toBe(false);
  });
});

describe("mention chips", () => {
  it("show the current name and round-trip through the editor's DOM", () => {
    dir({ [SAM]: "Sam O'Brien & Co" });
    const src = `Hi ${mentionSource("user", SAM, "Sam")} there`;
    const html = inlineToHtml(src);
    const el = document.createElement("div");
    el.innerHTML = html;
    expect(el.innerHTML).toBe(html); // the editor compares these on every keystroke
    expect(el.textContent).toBe("Hi @Sam O'Brien & Co there");
    // Editing the block writes the current name back.
    expect(htmlToInlineMarkdown(el)).toBe(`Hi @[Sam O'Brien & Co](user:${SAM}) there`);
  });

  it("keep the stored name for someone who left", () => {
    dir({});
    const el = document.createElement("div");
    el.innerHTML = inlineToHtml(`${mentionSource("user", SAM, "Sam")}`);
    expect(el.textContent).toBe("@Sam");
    expect(htmlToInlineMarkdown(el)).toBe(`@[Sam](user:${SAM})`);
  });

  it("never show a page this person can't open", () => {
    dir({}, {});
    const el = document.createElement("div");
    el.innerHTML = inlineToHtml(`See ${mentionSource("page", PAGE, "")}`);
    expect(el.textContent).toBe("See Private page");
    expect(htmlToInlineMarkdown(el)).toBe(`See @[](page:${PAGE})`);
    dir({}, { [PAGE]: "Launch plan" });
    el.innerHTML = inlineToHtml(`See ${mentionSource("page", PAGE, "")}`);
    expect(el.textContent).toBe("See Launch plan");
  });

  it("are one atom for the caret and for splitting", () => {
    dir({ [SAM]: "Sam" });
    const m = mentionSource("user", SAM, "Sam");
    const src = `ab${m}cd`;
    const map = buildOffsetMap(src);
    expect(map.renderedText).toBe("ab\uFFFCcd");
    expect(map.toRendered(2 + 5)).toBe(2); // inside the mention → its edge
    const [l, r] = splitInlineSource(src, 6);
    expect(l).toBe(`ab${m}`);
    expect(r).toBe("cd");
  });
});
