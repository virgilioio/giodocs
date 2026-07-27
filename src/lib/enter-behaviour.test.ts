import { describe, it, expect } from "vitest";
import { enterAction } from "./enter-behaviour";

const t = (type: string, text = "") => ({ type, text });

describe("enterAction — content blocks split", () => {
  it("mid-caret on content splits", () => {
    const col = [t("text", "hello world")];
    expect(enterAction(col, 0, 5, "hello world")).toEqual({ kind: "split" });
  });
  it("caret at end on content splits", () => {
    const col = [t("text", "hi")];
    expect(enterAction(col, 0, 2, "hi")).toEqual({ kind: "split" });
  });
  it("caret at start on content splits", () => {
    const col = [t("bullet", "point")];
    expect(enterAction(col, 0, 0, "point")).toEqual({ kind: "split" });
  });
});

describe("enterAction — empty text block escapes from the end", () => {
  it("empty text that is LAST and NOT ONLY → escape, removeEmpty=true", () => {
    const col = [t("text", "one"), t("text", "")];
    expect(enterAction(col, 1, 0, "")).toEqual({
      kind: "escape-column",
      removeEmpty: true,
    });
  });
  it("empty text that is LAST AND ONLY → escape, removeEmpty=false", () => {
    const col = [t("text", "")];
    expect(enterAction(col, 0, 0, "")).toEqual({
      kind: "escape-column",
      removeEmpty: false,
    });
  });
  it("empty text that is NOT last → split", () => {
    const col = [t("text", ""), t("text", "next")];
    expect(enterAction(col, 0, 0, "")).toEqual({ kind: "split" });
  });
});

describe("enterAction — empty list-like blocks convert to text (not escape)", () => {
  it("empty bullet that is last → convert-to-text", () => {
    const col = [t("text", "a"), t("bullet", "")];
    expect(enterAction(col, 1, 0, "")).toEqual({ kind: "convert-to-text" });
  });
  it("empty numbered that is last → convert-to-text", () => {
    const col = [t("numbered", "")];
    expect(enterAction(col, 0, 0, "")).toEqual({ kind: "convert-to-text" });
  });
  it("empty todo that is last → convert-to-text", () => {
    const col = [t("todo", "")];
    expect(enterAction(col, 0, 0, "")).toEqual({ kind: "convert-to-text" });
  });
});

describe("enterAction — out-of-range falls back to split", () => {
  it("returns split for a bad index", () => {
    expect(enterAction([t("text", "x")], 5, 0, "x")).toEqual({ kind: "split" });
  });
});
