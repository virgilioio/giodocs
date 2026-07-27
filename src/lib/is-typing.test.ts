/* @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { isTypingTarget, shouldSelectAllBlocks } from "./is-typing";

describe("isTypingTarget", () => {
  it("returns true for a textarea", () => {
    const el = document.createElement("textarea");
    expect(isTypingTarget(el)).toBe(true);
  });
  it("returns true for a text input", () => {
    const el = document.createElement("input");
    el.type = "text";
    expect(isTypingTarget(el)).toBe(true);
  });
  it("returns true for a number input", () => {
    const el = document.createElement("input");
    el.type = "number";
    expect(isTypingTarget(el)).toBe(true);
  });
  it("returns true for a select", () => {
    const el = document.createElement("select");
    expect(isTypingTarget(el)).toBe(true);
  });
  it("returns true for a contenteditable div", () => {
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    document.body.appendChild(el);
    expect(isTypingTarget(el)).toBe(true);
    document.body.removeChild(el);
  });
  it("returns true for a span nested inside a contenteditable", () => {
    const wrap = document.createElement("div");
    wrap.setAttribute("contenteditable", "true");
    const span = document.createElement("span");
    wrap.appendChild(span);
    document.body.appendChild(wrap);
    expect(isTypingTarget(span)).toBe(true);
    document.body.removeChild(wrap);
  });
  it("returns false for a plain div", () => {
    const el = document.createElement("div");
    expect(isTypingTarget(el)).toBe(false);
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
