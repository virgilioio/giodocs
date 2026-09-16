import { describe, expect, it, vi, afterEach } from "vitest";
import { collectEmojiNames, resolveEmojiDataUris } from "./emoji-export";
import { toHtml } from "./export";
import type { Block } from "./types";

const SET = [
  { name: "brand", url: "https://s.example/brand.png" },
  { name: "ship-it", url: "https://s.example/ship.png" },
  { name: "zed", url: "https://s.example/zed.png" },
];

const B = (type: string, extra: Record<string, unknown> = {}): Block =>
  ({ id: Math.random().toString(36).slice(2), type, ...extra }) as unknown as Block;

describe("collectEmojiNames", () => {
  it("returns [] for a page with none", () => {
    expect(collectEmojiNames([B("text", { text: "plain :nope: text" })], null, SET)).toEqual([]);
  });

  it("finds inline names, dedupes and sorts", () => {
    const names = collectEmojiNames(
      [
        B("text", { text: "hi :zed: and **:brand:** and :brand: again" }),
      ],
      null,
      SET,
    );
    expect(names).toEqual(["brand", "zed"]);
  });

  it("finds a callout icon, a callout child, a column block, a table cell, a toggle body and the page icon", () => {
    const blocks = [
      B("callout", {
        icon: ":brand:",
        children: [B("text", { text: "inside :zed:" })],
      }),
      B("columns", { cols: [[B("text", { text: "col :ship-it:" })], []] }),
      B("table", { rows: [["h", "cell :zed:"]] }),
      B("toggle", { text: "sum", body: "body :brand:" }),
    ];
    expect(collectEmojiNames(blocks, ":ship-it:", SET)).toEqual([
      "brand",
      "ship-it",
      "zed",
    ]);
  });

  it("takes the page icon alone", () => {
    expect(collectEmojiNames([], ":brand:", SET)).toEqual(["brand"]);
    expect(collectEmojiNames([], "🚀", SET)).toEqual([]);
  });
});

describe("toHtml with embedded emoji", () => {
  const uri = "data:image/png;base64,AAAA";
  const emoji = new Map([["brand", uri]]);

  it("emits exactly ONE .e-brand rule for three uses, three spans, and the .emoji box rule", () => {
    const html = toHtml({
      title: "T",
      blocks: [
        B("text", { text: ":brand: one" }),
        B("bullet", { text: ":brand: two" }),
        B("text", { text: "three :brand:" }),
      ],
      emoji,
    });
    expect(html.match(/\.e-brand\{/g)?.length).toBe(1);
    expect(html.match(/class="emoji e-brand"/g)?.length).toBe(3);
    expect(html).toContain(".emoji{display:inline-block");
    expect(html).toContain(uri);
  });

  it("falls back to alt text for a name absent from ctx.emoji", () => {
    const html = toHtml({
      title: "T",
      blocks: [B("text", { text: "x :zed: y" })],
      emoji,
    });
    expect(html).toContain(":zed:");
    expect(html).not.toContain("e-zed");
  });

  it("renders the span for a callout icon and for the page icon", () => {
    const html = toHtml({
      title: "T",
      icon: ":brand:",
      blocks: [B("callout", { icon: ":brand:", text: "note" })],
      emoji,
    });
    expect(html).toContain(`<h1 class="title"><span class="emoji e-brand"`);
    expect(html).toContain(`<span class="ico"><span class="emoji e-brand"`);
  });

  it("keeps a unicode page icon as a plain character", () => {
    const html = toHtml({ title: "T", icon: "🚀", blocks: [], emoji });
    expect(html).toContain(`<h1 class="title">🚀 T</h1>`);
  });

  it("is byte-identical to the no-emoji output when ctx.emoji is empty", () => {
    const blocks = [B("text", { text: "a :brand: b" })];
    const base = toHtml({ title: "T", blocks });
    expect(toHtml({ title: "T", blocks, emoji: new Map() })).toBe(base);
    expect(base).toContain(":brand:");
    expect(base).not.toContain("class=\"emoji");
  });
});

describe("resolveEmojiDataUris", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips a fetch failure and still resolves the rest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("ship")) throw new Error("boom");
        return {
          ok: true,
          headers: { get: () => "image/png" },
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as unknown as Response;
      }),
    );
    const map = await resolveEmojiDataUris(["brand", "ship-it"], SET);
    expect(map.has("ship-it")).toBe(false);
    expect(map.get("brand")).toMatch(/^data:image\/png;base64,/);
  });

  it("skips a name that is not in the set and returns an empty map for no names", async () => {
    expect((await resolveEmojiDataUris([], SET)).size).toBe(0);
    vi.stubGlobal("fetch", vi.fn());
    expect((await resolveEmojiDataUris(["ghost"], SET)).size).toBe(0);
  });
});
