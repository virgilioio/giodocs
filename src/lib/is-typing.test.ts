import { describe, it, expect } from "vitest";
import { isTypingTarget, shouldSelectAllBlocks } from "./is-typing";

// Minimal fake element implementing the tiny surface isTypingTarget uses:
// `closest(selector)` returning self on match, walking up the parent chain,
// plus `isContentEditable`.
type Fake = {
  tag: string;
  isContentEditable?: boolean;
  contenteditable?: boolean;
  parent?: Fake;
  closest: (sel: string) => unknown;
};
function fake(opts: Omit<Fake, "closest">): Fake {
  const self: Fake = {
    ...opts,
    closest(sel: string) {
      const matches = (n: Fake): boolean => {
        // super-tiny matcher for the selectors we actually use
        if (sel === "textarea, input, select") {
          return n.tag === "textarea" || n.tag === "input" || n.tag === "select";
        }
        if (sel === "[contenteditable]") return !!n.contenteditable;
        return false;
      };
      let cur: Fake | undefined = self;
      while (cur) {
        if (matches(cur)) return cur as unknown;
        cur = cur.parent;
      }
      return null;
    },
  };
  return self;
}

describe("isTypingTarget", () => {
  it("returns true for a textarea", () => {
    expect(isTypingTarget(fake({ tag: "textarea" }) as unknown as EventTarget)).toBe(true);
  });
  it("returns true for a text input", () => {
    expect(isTypingTarget(fake({ tag: "input" }) as unknown as EventTarget)).toBe(true);
  });
  it("returns true for a number input (any input type)", () => {
    expect(isTypingTarget(fake({ tag: "input" }) as unknown as EventTarget)).toBe(true);
  });
  it("returns true for a select", () => {
    expect(isTypingTarget(fake({ tag: "select" }) as unknown as EventTarget)).toBe(true);
  });
  it("returns true for a contenteditable element", () => {
    const el = fake({ tag: "div", contenteditable: true, isContentEditable: true });
    expect(isTypingTarget(el as unknown as EventTarget)).toBe(true);
  });
  it("returns true for a span nested inside a contenteditable", () => {
    const wrap = fake({ tag: "div", contenteditable: true, isContentEditable: true });
    const span = fake({ tag: "span", parent: wrap });
    expect(isTypingTarget(span as unknown as EventTarget)).toBe(true);
  });
  it("returns false for a plain div", () => {
    expect(isTypingTarget(fake({ tag: "div" }) as unknown as EventTarget)).toBe(false);
  });
  it("returns false for null", () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("shouldSelectAllBlocks", () => {
  it("empty value → true (empty block edge case)", () => {
    expect(shouldSelectAllBlocks(0, 0, 0)).toBe(true);
  });
  it("caret only, non-empty → false", () => {
    expect(shouldSelectAllBlocks(3, 3, 10)).toBe(false);
  });
  it("partial selection → false", () => {
    expect(shouldSelectAllBlocks(1, 5, 10)).toBe(false);
  });
  it("selection covers whole value → true", () => {
    expect(shouldSelectAllBlocks(0, 10, 10)).toBe(true);
  });
  it("selection from 0 but short of end → false", () => {
    expect(shouldSelectAllBlocks(0, 9, 10)).toBe(false);
  });
});
