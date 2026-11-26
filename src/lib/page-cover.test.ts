import { describe, expect, it } from "vitest";
import {
  COVER_GALLERY,
  canReposition,
  clampPosition,
  coverForCopy,
  coverOverflow,
  dragPosition,
  galleryCover,
  linkCover,
  randomGalleryCover,
  readCover,
} from "./page-cover";

const WS = "11111111-1111-1111-1111-111111111111";
const PG = "22222222-2222-2222-2222-222222222222";

describe("page covers", () => {
  it("reads what the database accepts and nothing else", () => {
    expect(readCover({ kind: "gallery", value: "lilac" })).toEqual({
      kind: "gallery",
      value: "lilac",
    });
    expect(readCover({ kind: "upload", value: `${WS}/${PG}/a.png`, position: 30 })).toEqual({
      kind: "upload",
      value: `${WS}/${PG}/a.png`,
      position: 30,
    });
    expect(readCover({ kind: "link", value: "https://x.y/a.jpg", position: 140 })?.position).toBe(
      100,
    );
    expect(readCover({ kind: "link", value: "javascript:alert(1)" })).toBeNull();
    expect(readCover({ kind: "gallery", value: "Not A Name" })).toBeNull();
    expect(readCover({ kind: "upload", value: `${WS}/../x.png` })).toBeNull();
    expect(readCover({ kind: "video", value: "x" })).toBeNull();
    expect(readCover("lilac")).toBeNull();
    expect(readCover(null)).toBeNull();
  });

  it("names every gallery entry once, from tokens only", () => {
    const ids = COVER_GALLERY.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of COVER_GALLERY) expect(g.css).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(galleryCover("nope").id).toBe(COVER_GALLERY[0].id);
    expect(randomGalleryCover(() => 0.999).kind).toBe("gallery");
  });

  it("turns a pasted address into a link cover, or says why not", () => {
    expect(linkCover("images.example.com/a.jpg").cover?.value).toBe(
      "https://images.example.com/a.jpg",
    );
    expect(linkCover("ftp://x/y").problem).toMatch(/web address/);
    expect(linkCover("  ").problem).toBe("Paste the address of an image.");
  });

  it("moves an image with the drag, within 0 to 100", () => {
    expect(clampPosition(-5)).toBe(0);
    expect(clampPosition("x")).toBe(50);
    // A 600px-tall image in a 200px cover: 400px to travel.
    expect(coverOverflow({ w: 1000, h: 1000 }, { w: 600, h: 200 })).toBe(400);
    expect(dragPosition(50, 100, 400, 200)).toBe(25);
    expect(dragPosition(50, -1000, 400, 200)).toBe(100);
    expect(canReposition({ kind: "gallery", value: "lilac" })).toBe(false);
    expect(canReposition({ kind: "link", value: "https://x/y" })).toBe(true);
  });

  it("gives a copy its own uploaded file", () => {
    const up = { kind: "upload" as const, value: `${WS}/${PG}/a.png`, position: 10 };
    const r = coverForCopy(up, "new-page");
    expect(r.cover?.value).toBe(`${WS}/new-page/a.png`);
    expect(r.copy).toEqual({ from: `${WS}/${PG}/a.png`, to: `${WS}/new-page/a.png` });
    expect(coverForCopy({ kind: "gallery", value: "dawn" }, "new-page").copy).toBeNull();
    expect(coverForCopy(null, "x").cover).toBeNull();
  });
});
