import { describe, expect, it } from "vitest";
import { excerpt, highlightParts, matchRanges, queryWords, rootOf } from "./search-text";

const marked = (text: string, q: string) =>
  highlightParts(text, q)
    .map((p) => (p.hit ? `[${p.text}]` : p.text))
    .join("");

describe("search words", () => {
  it("reads the typed words as the database does", () => {
    expect(queryWords("Hiring  plan!")).toEqual(["hiring", "plan"]);
    expect(queryWords("laptop's")).toEqual(["laptop"]);
    expect(queryWords("a")).toEqual(["a"]);
    expect(queryWords("  ")).toEqual([]);
  });

  it("finds a word's root", () => {
    expect(rootOf("interviews")).toBe("interview");
    expect(rootOf("planning")).toBe("plann");
    expect(rootOf("bus")).toBe("bus");
  });

  it("highlights whole words that start with a typed word or its root", () => {
    expect(marked("Planning the hiring interviews", "hiring plan")).toBe(
      "[Planning] the [hiring] interviews",
    );
    expect(marked("How we interview.", "interviews")).toBe("How we [interview].");
    expect(marked("Café menu", "cafe")).toBe("[Café] menu");
    expect(matchRanges("nothing here", "zebra")).toEqual([]);
  });

  it("cuts a long line around the first match", () => {
    const long = `${"word ".repeat(60)}the kangaroo jumped ${"more ".repeat(60)}`;
    const e = excerpt(long, "kangaroo");
    expect(e.startsWith("…")).toBe(true);
    expect(e.endsWith("…")).toBe(true);
    expect(e).toContain("kangaroo");
    expect(e.length).toBeLessThanOrEqual(143);
    expect(excerpt("short line", "x")).toBe("short line");
  });
});
