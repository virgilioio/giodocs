import { describe, expect, it } from "vitest";
import { cloneBlocksFresh, isBlankPage, mergeTemplateProps } from "./template-copy";

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
