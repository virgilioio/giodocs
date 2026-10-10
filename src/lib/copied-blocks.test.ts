import { beforeEach, describe, expect, it } from "vitest";
import { __resetCopiedForTest, recallCopied, rememberCopied } from "./copied-blocks";

describe("copied blocks", () => {
  beforeEach(() => __resetCopiedForTest());
  const view = { id: "v1", type: "view", text: "", view: { name: "Tasks", filter: [] } };
  it("a paste of exactly what was copied gets the blocks back, with fresh ids", () => {
    rememberCopied("View: Tasks", [view]);
    const got = recallCopied("View: Tasks\n") as Array<Record<string, unknown>>;
    expect(got).toHaveLength(1);
    expect(got[0].type).toBe("view");
    expect(got[0].view).toEqual(view.view);
    expect(got[0].id).not.toBe("v1");
  });
  it("anything else pastes as before", () => {
    rememberCopied("View: Tasks", [view]);
    expect(recallCopied("something else")).toBeNull();
    expect(recallCopied("")).toBeNull();
  });
  it("blocks holding stored files or pages aren't kept", () => {
    rememberCopied("x", [{ id: "a", type: "text", text: "x" }, { id: "i", type: "image", path: "p" }]);
    expect(recallCopied("x")).toBeNull();
  });
});
