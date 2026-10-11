import { describe, expect, it } from "vitest";
import { cloneBlocksFresh, isBlankPage, mergeTemplateProps, pathForPage, retargetBlockPaths } from "./template-copy";

describe("cloneBlocksFresh", () => {
  it("gives every block, nested ones too, a new id and leaves the template alone", () => {
    const tpl = [
      { id: "a", type: "callout", text: "x", children: [{ id: "b", type: "text", text: "y" }] },
      { id: "c", type: "columns", cols: [[{ id: "d", type: "text", text: "l" }], [{ id: "e", type: "text", text: "r" }]] },
    ];
    const copy = cloneBlocksFresh(tpl) as Array<Record<string, unknown>>;
    const ids = JSON.stringify(copy).match(/"id":"[^"]+"/g) ?? [];
    expect(ids).toHaveLength(5);
    expect(ids.some((x) => /"id":"[a-e]"/.test(x))).toBe(false);
    expect(tpl[0].id).toBe("a");
    expect((copy[0].children as Array<Record<string, unknown>>)[0].text).toBe("y");
  });
});

describe("mergeTemplateProps", () => {
  it("keeps what the page already has", () => {
    expect(mergeTemplateProps({ status: "doing", area: "" }, { status: "todo", area: "Ops", tags: ["x"] })).toEqual({
      status: "doing",
      area: "Ops",
      tags: ["x"],
    });
  });
});

describe("isBlankPage", () => {
  it("is blank until someone writes", () => {
    expect(isBlankPage("", [])).toBe(true);
    expect(isBlankPage("", [{ id: "1", type: "text", text: " " }])).toBe(true);
    expect(isBlankPage("Plan", [])).toBe(false);
    expect(isBlankPage("", [{ id: "1", type: "h1", text: "" }])).toBe(false);
    expect(isBlankPage("", [{ id: "1", type: "text", text: "hi" }])).toBe(false);
  });
});

describe("template images", () => {
  it("moves image and file paths into the new page's folder", () => {
    expect(pathForPage("ws/tpl/a.png", "new")).toBe("ws/new/a.png");
    expect(pathForPage("ws/tpl/files/b.pdf", "new")).toBe("ws/new/files/b.pdf");
    expect(pathForPage("ws/emoji/x.png", "new")).toBeNull();
    expect(pathForPage("ws/new/a.png", "new")).toBeNull();
    const map = new Map([["ws/tpl/a.png", "ws/new/a.png"], ["ws/tpl/c.png", "ws/new/c.png"]]);
    const out = retargetBlockPaths(
      [
        { id: "1", type: "image", path: "ws/tpl/a.png" },
        { id: "2", type: "imagerow", cols: 2, paths: ["ws/tpl/c.png", "ws/tpl/missing.png"] },
        { id: "3", type: "callout", children: [{ id: "4", type: "image", path: "ws/tpl/a.png" }] },
      ],
      map,
    ) as Array<Record<string, unknown>>;
    expect(out[0].path).toBe("ws/new/a.png");
    expect(out[1].paths).toEqual(["ws/new/c.png", "ws/tpl/missing.png"]);
    expect(((out[2].children as Array<Record<string, unknown>>)[0]).path).toBe("ws/new/a.png");
  });
});

describe("keepStoredProps", () => {
  it("keeps only values the database's properties can hold", async () => {
    const { keepStoredProps } = await import("./template-copy");
    const defs = [
      { key: "status_2", type: "status" },
      { key: "old", type: "text", archived_at: "x" },
      { key: "req", type: "unique_id" },
      { key: "calc", type: "formula" },
      { key: "back", type: "relation", config: { of: "fwd" } },
    ];
    expect(
      keepStoredProps(
        { area: "People", status: "In review", status_2: "todo", old: "kept", req: 4, calc: 1, back: [] },
        defs,
      ),
    ).toEqual({ status_2: "todo", old: "kept" });
    expect(keepStoredProps(null, defs)).toEqual({});
  });
});
