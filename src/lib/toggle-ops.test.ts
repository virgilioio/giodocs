import { describe, expect, it } from "vitest";
import { lastShownId, toggleKey, toggleKids } from "./toggle-ops";
import type { Blk } from "./block-ops";

const k = (key: string, shift = false) => ({ key, shift, meta: false, alt: false });
const toggle = (over: Partial<Blk> = {}): Blk => ({
  id: "t",
  type: "toggle",
  text: "Plans",
  open: true,
  ...over,
});

describe("toggleKids", () => {
  it("reads children, or an older import's body as one block", () => {
    expect(
      toggleKids(toggle({ children: [{ id: "a", type: "text", text: "x" }] })).map((b) => b.id),
    ).toEqual(["a"]);
    expect(toggleKids(toggle({ body: "hidden" }))).toEqual([
      { id: "t-body", type: "text", text: "hidden" },
    ]);
    expect(toggleKids(toggle())).toEqual([]);
  });
});

describe("toggleKey", () => {
  it("Enter in an open toggle's title starts its first block", () => {
    const list = [toggle({ children: [{ id: "a", type: "text", text: "old" }] })];
    const r = toggleKey(list, "t", k("Enter"), 2, 2)!;
    const t = r.next![0];
    expect(t.text).toBe("Pl");
    expect(t.children!.map((c) => c.text)).toEqual(["ans", "old"]);
    expect(r.focus).toEqual({ id: t.children![0].id, caret: "start" });
  });

  it("leaves a closed toggle, Shift+Enter and other blocks to the usual keys", () => {
    expect(toggleKey([toggle({ open: false })], "t", k("Enter"), 0, 0)).toBeNull();
    expect(toggleKey([toggle()], "t", k("Enter", true), 0, 0)).toBeNull();
    expect(toggleKey([{ id: "x", type: "text", text: "hi" }], "x", k("Enter"), 2, 2)).toBeNull();
  });

  it("steps down into the first block from the end of the title", () => {
    const list = [toggle({ children: [{ id: "a", type: "text", text: "x" }] })];
    expect(toggleKey(list, "t", k("ArrowDown"), 5, 5)).toEqual({
      next: null,
      focus: { id: "a", caret: "start" },
    });
    expect(toggleKey(list, "t", k("ArrowDown"), 2, 2)).toBeNull();
  });

  it("Tab tucks the block below a toggle into it, and opens it", () => {
    const list: Blk[] = [
      toggle({ open: false }),
      { id: "x", type: "bullet", text: "item", indent: 1 },
    ];
    const r = toggleKey(list, "x", k("Tab"), 3, 3)!;
    expect(r.next!.map((b) => b.id)).toEqual(["t"]);
    expect(r.next![0].open).toBe(true);
    expect(r.next![0].children!.map((c) => c.id)).toEqual(["x"]);
    expect(r.next![0].children![0].indent).toBeUndefined();
    expect(r.focus).toEqual({ id: "x", caret: 3 });
    expect(
      toggleKey(
        [
          { id: "y", type: "text" },
          { id: "x", type: "text" },
        ],
        "x",
        k("Tab"),
        0,
        0,
      ),
    ).toBeNull();
  });
});

describe("lastShownId", () => {
  it("finds the last block an open toggle shows, toggles inside included", () => {
    const inner = toggle({ id: "i", children: [{ id: "deep", type: "text" }] });
    expect(lastShownId(toggle({ children: [{ id: "a", type: "text" }, inner] }))).toBe("deep");
    expect(lastShownId(toggle({ open: false, children: [{ id: "a", type: "text" }] }))).toBe("t");
    expect(lastShownId({ id: "p", type: "text" })).toBe("p");
  });
});
