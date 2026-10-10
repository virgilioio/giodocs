import { describe, expect, it } from "vitest";
import { tokenizeInline, type InlineToken } from "./inline-tokens";

const kinds = (ts: InlineToken[]): unknown =>
  ts.map((t) => ("children" in t ? { [t.kind]: kinds(t.children) } : t.kind === "text" ? t.text : t.kind));

describe("bold around italic", () => {
  it("***x*** is bold holding italic", () => {
    expect(kinds(tokenizeInline("***x***"))).toEqual([{ bold: [{ italic: ["x"] }] }]);
  });
  it("**a *b*** closes the italic, then the bold", () => {
    expect(kinds(tokenizeInline("**a *b***"))).toEqual([{ bold: ["a", " ", { italic: ["b"] }] }]);
  });
  it("**x** followed by *y* stays two tokens", () => {
    expect(kinds(tokenizeInline("**x***y*"))).toEqual([{ bold: ["x"] }, { italic: ["y"] }]);
  });
  it("plain bold and italic are unchanged", () => {
    expect(kinds(tokenizeInline("**b** and *i*"))).toEqual([{ bold: ["b"] }, " ", "a", "n", "d", " ", { italic: ["i"] }]);
  });
});
