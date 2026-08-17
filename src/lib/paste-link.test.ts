import { describe, expect, it } from "vitest";
import { linkPaste, isBareUrl } from "./paste-link";

describe("linkPaste", () => {
  it("links a selection", () => {
    const r = linkPaste("see the docs here", 8, 12, "https://gogio.io");
    expect(r).not.toBeNull();
    expect(r!.text).toBe("see the [docs](https://gogio.io) here");
  });

  it("returns null on a collapsed caret", () => {
    expect(linkPaste("see the docs", 4, 4, "https://gogio.io")).toBeNull();
  });

  it("returns null on a multi-word paste", () => {
    expect(linkPaste("see the docs", 8, 12, "https://a.io and more")).toBeNull();
  });

  it("returns null on a multi-line paste", () => {
    expect(linkPaste("see the docs", 8, 12, "https://a.io\nhttps://b.io")).toBeNull();
  });

  it("returns null on a javascript: URL (safeUrl rejects)", () => {
    expect(linkPaste("see the docs", 8, 12, "javascript:alert(1)")).toBeNull();
  });

  it("returns null on a plain word that is not URL-shaped", () => {
    expect(linkPaste("see the docs", 8, 12, "Hello")).toBeNull();
  });

  it("returns null when the selection already holds a link", () => {
    const src = "see [docs](https://a.io) now";
    expect(linkPaste(src, 4, 24, "https://b.io")).toBeNull();
  });

  it("puts the caret collapsed just past the closing paren", () => {
    const r = linkPaste("docs", 0, 4, "https://gogio.io")!;
    expect(r.text).toBe("[docs](https://gogio.io)");
    expect(r.caret).toBe(r.text.length);
    expect(r.text[r.caret - 1]).toBe(")");
  });

  it("uses safeUrl's trimmed output, not the raw paste", () => {
    const r = linkPaste("docs", 0, 4, "  https://gogio.io  ")!;
    expect(r.text).toBe("[docs](https://gogio.io)");
  });

  it("passes a URL with parens through verbatim (documented behaviour)", () => {
    const r = linkPaste("wiki", 0, 4, "https://en.wikipedia.org/wiki/A_(b)")!;
    expect(r.text).toBe("[wiki](https://en.wikipedia.org/wiki/A_(b))");
  });

  it("keeps a trailing period inside the href (documented behaviour)", () => {
    const r = linkPaste("x", 0, 1, "https://gogio.io/a.")!;
    expect(r.text).toBe("[x](https://gogio.io/a.)");
  });

  it("normalises a reversed range", () => {
    const r = linkPaste("docs", 4, 0, "www.gogio.io")!;
    expect(r.text).toBe("[docs](www.gogio.io)");
  });
});

describe("isBareUrl", () => {
  it("accepts schemes, www and dotted hosts", () => {
    expect(isBareUrl("https://a.io")).toBe(true);
    expect(isBareUrl("www.a.io")).toBe(true);
    expect(isBareUrl("gogio.io/docs")).toBe(true);
    expect(isBareUrl("mailto:a@b.io")).toBe(true);
  });
  it("rejects empties, prose and unsafe schemes", () => {
    expect(isBareUrl("")).toBe(false);
    expect(isBareUrl("hello there")).toBe(false);
    expect(isBareUrl("javascript:alert(1)")).toBe(false);
  });
});
