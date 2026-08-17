import { describe, expect, it } from "vitest";
import { linkPaste, isBareUrl } from "./paste-link";
import { tokenizeInline, type InlineToken } from "./inline-tokens";

const find = (ts: InlineToken[], kind: string): InlineToken | null => {
  for (const t of ts) {
    if (t.kind === kind) return t;
    if ("children" in t) {
      const r = find(t.children, kind);
      if (r) return r;
    }
  }
  return null;
};

describe("linkPaste — snapping to token inner text", () => {
  const url = "https://www.linkedin.com/in/tairattigan/";

  it("end past the closing ** snaps inward (the measured bug)", () => {
    const r = linkPaste("**Tai Rattigan** - COO", 2, 16, url)!;
    expect(r.text).toBe(`**[Tai Rattigan](${url})** - COO`);
    const bold = find(tokenizeInline(r.text), "bold")!;
    expect(bold.kind).toBe("bold");
    const link = find([bold], "link")! as Extract<
      InlineToken,
      { kind: "link" }
    >;
    expect(link.url).toBe(url);
  });

  it("start inside the opening ** also snaps inward", () => {
    const r = linkPaste("**Tai Rattigan** - COO", 0, 16, url)!;
    expect(r.text).toBe(`**[Tai Rattigan](${url})** - COO`);
    const bold = find(tokenizeInline(r.text), "bold")!;
    expect(find([bold], "link")).not.toBeNull();
  });

  it("plain unformatted selection is unchanged", () => {
    const r = linkPaste("see the docs here", 8, 12, "https://gogio.io")!;
    expect(r.text).toBe("see the [docs](https://gogio.io) here");
  });

  it("a selection straddling a formatting boundary is declined", () => {
    expect(linkPaste("**bold** tail", 2, 13, "https://gogio.io")).toBeNull();
  });

  it("snaps through nested runs", () => {
    const r = linkPaste("==**x**==", 4, 9, "https://u.io")!;
    expect(r.text).toBe("==**[x](https://u.io)**==");
  });
});


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

  it("declines a URL containing ')' — the post-verify rejects it", () => {
    // Previously spliced verbatim, which tokenized to a link ending at the
    // inner paren plus literal text. The post-verify now declines instead,
    // so the caller falls through to the native paste.
    expect(linkPaste("wiki", 0, 4, "https://en.wikipedia.org/wiki/A_(b)")).toBeNull();
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
