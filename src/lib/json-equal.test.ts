import { describe, it, expect } from "vitest";
import { jsonEqual } from "./json-equal";

describe("jsonEqual", () => {
  it("ignores key order, the way jsonb re-sorts keys", () => {
    expect(jsonEqual([{ id: "a", type: "text", text: "x" }], [{ text: "x", type: "text", id: "a" }])).toBe(true);
  });
  it("treats an undefined property as absent", () => {
    expect(jsonEqual({ a: 1, checked: undefined }, { a: 1 })).toBe(true);
  });
  it("sees real differences", () => {
    expect(jsonEqual([{ id: "a", text: "x" }], [{ id: "a", text: "y" }])).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual({ a: null }, { a: undefined })).toBe(false);
  });
});
