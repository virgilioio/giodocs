import { describe, it, expect } from "vitest";
import { splitInlineSource } from "./split-inline";

describe("splitInlineSource", () => {
  it("closes and re-opens bold around the caret", () => {
    expect(splitInlineSource("say **hello world** now", 11)).toEqual(["say **hello**", "** world** now"]);
  });
  it("handles nested marks", () => {
    expect(splitInlineSource("**a *bc* d**", 6)).toEqual(["**a *b***", "***c* d**"]);
  });
  it("splits link text and keeps the url on both halves", () => {
    expect(splitInlineSource("go [here now](https://x.io) ok", 8)).toEqual([
      "go [here](https://x.io)",
      "[ now](https://x.io) ok",
    ]);
  });
  it("moves a caret inside a delimiter to the token edge", () => {
    expect(splitInlineSource("a **b** c", 3)).toEqual(["a ", "**b** c"]);
    expect(splitInlineSource("a **b** c", 6)).toEqual(["a **b**", " c"]);
  });
  it("splits inline code", () => {
    expect(splitInlineSource("x `abcd` y", 5)).toEqual(["x `ab`", "`cd` y"]);
  });
  it("leaves plain text alone", () => {
    expect(splitInlineSource("hello", 2)).toEqual(["he", "llo"]);
    expect(splitInlineSource("hello", 0)).toEqual(["", "hello"]);
    expect(splitInlineSource("hello", 5)).toEqual(["hello", ""]);
  });
});
