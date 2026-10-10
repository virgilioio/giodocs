import { describe, expect, it } from "vitest";
import { describeDiff, diffVersion } from "./version-diff";

const t = (id: string, text: string) => ({ id, type: "text", text });

describe("diffVersion", () => {
  it("counts blocks to bring back, revert and remove", () => {
    const version = { title: "Plan", icon: "📄", blocks: [t("a", "one"), t("b", "two"), t("c", "three")] };
    const now = { title: "Plan v2", icon: "📄", blocks: [t("a", "one"), t("b", "TWO"), t("d", "four"), t("e", "five")] };
    const d = diffVersion(version, now);
    expect(d).toEqual({ missing: 1, changed: 1, added: 2, titleChanged: true, iconChanged: false });
    expect(describeDiff(d, version.title)).toBe(
      "Restoring renames the page to “Plan”, brings back 1 block, reverts 1 edited block and removes 2 newer blocks.",
    );
  });

  it("looks inside callouts and columns, counting a child edit once", () => {
    const version = {
      title: "x",
      icon: null,
      blocks: [{ id: "p", type: "callout", text: "", children: [t("k", "a")] }, { id: "cols", type: "columns", cols: [[t("l", "left")], [t("r", "right")]] }],
    };
    const now = {
      title: "x",
      icon: null,
      blocks: [{ id: "p", type: "callout", text: "", children: [t("k", "b")] }, { id: "cols", type: "columns", cols: [[t("l", "left")], []] }],
    };
    expect(diffVersion(version, now)).toMatchObject({ missing: 1, changed: 1, added: 0 });
  });

  it("doesn't count defaults the editor fills in as edits", () => {
    const version = { title: "x", icon: null, blocks: [{ id: "a", type: "bullet", text: "one" }] };
    const now = { title: "x", icon: null, blocks: [{ id: "a", type: "bullet", text: "one", indent: 0, checked: false, cap: "" }] };
    expect(diffVersion(version, now)).toMatchObject({ changed: 0 });
    const moved = { title: "x", icon: null, blocks: [{ id: "a", type: "bullet", text: "one", indent: 1 }] };
    expect(diffVersion(version, moved)).toMatchObject({ changed: 1 });
  });

  it("ignores empty paragraphs and says when nothing changes", () => {
    const version = { title: "x", icon: null, blocks: [t("a", "same"), t("z", "")] };
    const now = { title: "x", icon: null, blocks: [t("a", "same"), t("y", " ")] };
    const d = diffVersion(version, now);
    expect(d).toMatchObject({ missing: 0, changed: 0, added: 0 });
    expect(describeDiff(d, "x")).toBe("This version has the same content as the page now.");
  });
});
