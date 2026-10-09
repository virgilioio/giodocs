import { describe, it, expect } from "vitest";
import { splitBlock, mergeIntoPrev, mergeNextInto, duplicateBlock, type Blk } from "./block-ops";
import { resolveKey } from "./block-key-handler";

const facts = (key: string, value: string, start: number, end = start, extra: Partial<{ meta: boolean; shift: boolean }> = {}) => ({
  key,
  meta: false,
  shift: false,
  selStart: start,
  selEnd: end,
  valueLength: value.length,
  value,
  ...extra,
});

describe("splitBlock", () => {
  it("keeps marks intact on both halves", () => {
    const r = splitBlock([{ id: "a", type: "text", text: "say **hello world** now" }], "a", 11)!;
    expect(r.next.map((b) => b.text)).toEqual(["say **hello**", "** world** now"]);
  });
  it("Enter at the start opens a line above and leaves the block as it is", () => {
    const list: Blk[] = [{ id: "a", type: "h1", text: "Title" }];
    const r = splitBlock(list, "a", 0)!;
    expect(r.next.map((b) => [b.type, b.text])).toEqual([["text", ""], ["h1", "Title"]]);
    expect(r.focus).toEqual({ id: "a", caret: "start" });
  });
  it("a new list item keeps the indent", () => {
    const r = splitBlock([{ id: "a", type: "bullet", text: "x", indent: 2 }], "a", 1)!;
    expect(r.next[1].indent).toBe(2);
  });
});

describe("merges", () => {
  it("never merges text into a block that shows none", () => {
    const list: Blk[] = [
      { id: "i", type: "image", text: "" },
      { id: "a", type: "text", text: "keep" },
    ];
    expect(mergeIntoPrev(list, "a")).toBeNull();
  });
  it("forward Delete pulls the next block up, or removes a divider", () => {
    expect(mergeNextInto([{ id: "a", type: "text", text: "one" }, { id: "b", type: "text", text: " two" }], "a")!.next).toEqual([
      { id: "a", type: "text", text: "one two" },
    ]);
    expect(mergeNextInto([{ id: "a", type: "text", text: "one" }, { id: "d", type: "divider", text: "" }], "a")!.next).toHaveLength(1);
  });
});

describe("duplicateBlock", () => {
  it("gives every nested block a fresh id", () => {
    const list: Blk[] = [{ id: "c", type: "callout", text: "", children: [{ id: "k", type: "text", text: "in" }] }];
    const r = duplicateBlock(list, "c")!;
    const copy = r.next[1];
    expect(copy.id).not.toBe("c");
    expect(copy.children![0].id).not.toBe("k");
    expect(copy.children![0].text).toBe("in");
  });
});

describe("resolveKey", () => {
  it("Backspace at the start after a divider removes the divider; after an image selects it", () => {
    const d: Blk[] = [{ id: "d", type: "divider", text: "" }, { id: "a", type: "text", text: "x" }];
    expect(resolveKey("page", d, 1, facts("Backspace", "x", 0)).kind).toBe("remove-prev");
    const i: Blk[] = [{ id: "i", type: "image", text: "" }, { id: "a", type: "text", text: "x" }];
    expect(resolveKey("page", i, 1, facts("Backspace", "x", 0)).kind).toBe("select-prev");
  });
  it("Enter in a code block is a newline, and ⌘B does nothing there", () => {
    const c: Blk[] = [{ id: "c", type: "code", text: "a" }];
    expect(resolveKey("page", c, 0, facts("Enter", "a", 1)).kind).toBe("none");
    expect(resolveKey("page", c, 0, facts("b", "a", 0, 1, { meta: true })).kind).toBe("none");
  });
  it("Enter on an empty indented list item outdents", () => {
    const l: Blk[] = [{ id: "a", type: "bullet", text: "x" }, { id: "b", type: "bullet", text: "", indent: 1 }];
    expect(resolveKey("page", l, 1, facts("Enter", "", 0)).kind).toBe("outdent");
  });
  it("Delete at the end merges the next block", () => {
    const l: Blk[] = [{ id: "a", type: "text", text: "x" }, { id: "b", type: "text", text: "y" }];
    expect(resolveKey("page", l, 0, facts("Delete", "x", 1)).kind).toBe("merge-next");
  });
});
