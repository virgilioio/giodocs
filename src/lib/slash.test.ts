import { describe, it, expect } from "vitest";
import { slashTrigger, stripSlash } from "./slash";

describe("slashTrigger", () => {
  it("opens at the start of a block or after a space", () => {
    expect(slashTrigger("/to", 3, "text")).toEqual({ at: 0, query: "to" });
    expect(slashTrigger("note /h1", 8, "text")).toEqual({ at: 5, query: "h1" });
  });
  it("never opens mid-word, in URLs or in code", () => {
    expect(slashTrigger("and/or", 6, "text")).toBeNull();
    expect(slashTrigger("24/7", 4, "text")).toBeNull();
    expect(slashTrigger("https://x.io/table", 18, "text")).toBeNull();
    expect(slashTrigger("/x", 2, "code")).toBeNull();
  });
});

describe("stripSlash", () => {
  it("removes only the typed /query and keeps the rest of the line", () => {
    expect(stripSlash("client /to do later", 7, "to")).toBe("client  do later");
    expect(stripSlash("/h1", 0, "h1")).toBe("");
  });
});
