import { describe, expect, it } from "vitest";
import { arrangeStrip, orderedKeys, readPageLayout, ruleOf, withMove, withRule } from "./page-layout";

const defs = [
  { key: "status", type: "status", position: 1 },
  { key: "owner", type: "person", position: 2 },
  { key: "sum", type: "rollup", position: 3 },
  { key: "due", type: "date", position: 4 },
  { key: "notes", type: "text", position: 5 },
  { key: "old", type: "text", position: 6, archived_at: "x" },
];

describe("readPageLayout", () => {
  it("reads defensively", () => {
    expect(readPageLayout(null)).toEqual({});
    expect(readPageLayout({ order: ["a", 1, "a"], show: { a: "always", b: "sometimes" } })).toEqual({
      order: ["a"],
      show: { a: "always" },
    });
  });
});

describe("default rule", () => {
  it("keeps the first three non-rollup properties, the rest when filled", () => {
    expect(orderedKeys(defs, {})).toEqual(["status", "owner", "sum", "due", "notes"]);
    expect(["status", "owner", "sum", "due", "notes"].map((k) => ruleOf(k, defs, {}))).toEqual([
      "always",
      "always",
      "filled",
      "always",
      "filled",
    ]);
    expect(arrangeStrip(defs, {}, new Set(["notes"]))).toEqual({
      shown: ["status", "owner", "due", "notes"],
      folded: ["sum"],
    });
  });
});

describe("a layout", () => {
  it("orders, shows always, hides when empty, and folds", () => {
    const l = { order: ["notes", "status"], show: { notes: "always" as const, owner: "never" as const, status: "filled" as const } };
    expect(arrangeStrip(defs, l, new Set(["owner"]))).toEqual({
      // due's default follows the new order: it's no longer among the first three.
      shown: ["notes"],
      folded: ["status", "owner", "sum", "due"],
    });
  });
  it("moving keeps what shows and writes the whole order", () => {
    const moved = withMove({}, defs, "notes", 0);
    expect(moved.order).toEqual(["notes", "status", "owner", "sum", "due"]);
    expect(arrangeStrip(defs, moved, new Set()).shown).toEqual(["status", "owner", "due"]);
    expect(withRule({}, "due", "never").show).toEqual({ due: "never" });
  });
});

describe("withMoveBeside", () => {
  it("drops before or after a property", async () => {
    const { withMoveBeside: mb } = await import("./page-layout");
    expect(mb({}, defs, "notes", "owner", false).order).toEqual(["status", "notes", "owner", "sum", "due"]);
    expect(mb({}, defs, "status", "due", true).order).toEqual(["owner", "sum", "due", "status", "notes"]);
  });
});
