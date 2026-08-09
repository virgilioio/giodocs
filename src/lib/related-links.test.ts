import { describe, it, expect } from "vitest";
import {
  hostOf,
  hrefOf,
  isUrlish,
  linkKind,
  relList,
  relResolve,
} from "./related-links";

const PAGES = [
  { id: "11111111-1111-1111-1111-111111111111", title: "Hiring", icon: "🧑" },
  { id: "22222222-2222-2222-2222-222222222222", title: "Roadmap", icon: null },
];

describe("linkKind", () => {
  it("names the known providers", () => {
    expect(linkKind("https://www.figma.com/file/abc").label).toBe("Figma");
    expect(linkKind("https://acme.notion.site/x").label).toBe("Notion");
    expect(linkKind("https://notion.so/x").label).toBe("Notion");
    expect(linkKind("https://loom.com/share/1").label).toBe("Loom");
    expect(linkKind("https://dropbox.com/s/1").label).toBe("Dropbox");
  });
  it("labels Google Docs by path", () => {
    expect(linkKind("https://docs.google.com/document/d/1/edit").label).toBe(
      "Doc",
    );
    expect(linkKind("https://docs.google.com/spreadsheets/d/1").label).toBe(
      "Sheet",
    );
    expect(linkKind("https://docs.google.com/presentation/d/1").label).toBe(
      "Slide",
    );
  });
  it("falls back to the bare hostname on sunken/secondary", () => {
    expect(linkKind("https://www.example.co.uk/a/b")).toEqual({
      label: "example.co.uk",
      tint: "sunken",
      ink: "secondary",
    });
  });
  it("only ever returns existing @theme token names", () => {
    const ok = new Set([
      "sunken",
      "strong",
      "secondary",
      "accent",
      "accentTint",
      "blue",
      "blueInk",
      "blueTint",
      "purple",
      "purpleTint",
      "pinkInk",
      "pinkTint",
      "amberTint",
      "amberInk",
    ]);
    for (const u of [
      "figma.com/f",
      "notion.so",
      "loom.com",
      "dropbox.com",
      "docs.google.com/document/d/1",
      "docs.google.com/spreadsheets/d/1",
      "docs.google.com/presentation/d/1",
      "whatever.dev",
    ]) {
      const k = linkKind(u);
      expect(ok.has(k.tint)).toBe(true);
      expect(ok.has(k.ink)).toBe(true);
    }
  });
});

describe("hostOf / hrefOf", () => {
  it("strips scheme, www and path", () => {
    expect(hostOf("https://www.Figma.com/file/x?y#z")).toBe("figma.com");
    expect(hostOf("figma.com")).toBe("figma.com");
  });
  it("adds https to a bare host", () => {
    expect(hrefOf("figma.com/f")).toBe("https://figma.com/f");
    expect(hrefOf("http://a.dev")).toBe("http://a.dev");
  });
});

describe("isUrlish", () => {
  it("accepts schemed and bare hosts", () => {
    expect(isUrlish("https://figma.com/file/x")).toBe(true);
    expect(isUrlish("http://a.dev")).toBe(true);
    expect(isUrlish("figma.com")).toBe(true);
    expect(isUrlish("docs.google.com/document/d/1")).toBe(true);
  });
  it("rejects ids, prose, bare words and other schemes", () => {
    expect(isUrlish("11111111-1111-1111-1111-111111111111")).toBe(false);
    expect(isUrlish("Acme acquisition terms")).toBe(false);
    expect(isUrlish("localhost")).toBe(false);
    expect(isUrlish("figma.com and more")).toBe(false);
    expect(isUrlish("javascript://x.dev")).toBe(false);
    expect(isUrlish("")).toBe(false);
    expect(isUrlish(null)).toBe(false);
    expect(isUrlish(12)).toBe(false);
  });
});

describe("relResolve", () => {
  it("resolves a visible page id to that page", () => {
    const r = relResolve(PAGES[0].id, PAGES);
    expect(r.kind).toBe("page");
    if (r.kind === "page") expect(r.page.title).toBe("Hiring");
  });
  it("resolves a URL to url", () => {
    const r = relResolve("https://figma.com/file/x", PAGES);
    expect(r).toEqual({ kind: "url", url: "https://figma.com/file/x" });
  });
  it("an id absent from the visible list is unresolved", () => {
    expect(
      relResolve("33333333-3333-3333-3333-333333333333", PAGES).kind,
    ).toBe("unresolved");
  });
  it("junk is unresolved — the SAME state, not a fourth one", () => {
    expect(relResolve("not a link", PAGES).kind).toBe("unresolved");
    expect(relResolve("", PAGES).kind).toBe("unresolved");
    expect(relResolve(null, PAGES).kind).toBe("unresolved");
  });
});

describe("relList", () => {
  it("keeps non-empty strings only", () => {
    expect(relList(["a", "", 3, null, "b"])).toEqual(["a", "b"]);
    expect(relList(null)).toEqual([]);
  });
});
