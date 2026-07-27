import { describe, expect, it } from "vitest";
import { personalViewFooter } from "./personal-view-footer";

describe("personalViewFooter", () => {
  it("empty workspace has its own copy — no k/total, no sort clause", () => {
    expect(personalViewFooter({ matchCount: 0, totalCount: 0, sortLabel: "Newest edits" }))
      .toBe("No pages yet");
  });

  it("lowercases the sort intent label", () => {
    expect(
      personalViewFooter({ matchCount: 3, totalCount: 12, sortLabel: "Newest edits" }),
    ).toBe("3 of 12 pages match · newest edits first");
  });

  it("pluralises pages: 1 workspace page reads 'page'", () => {
    expect(
      personalViewFooter({ matchCount: 1, totalCount: 1, sortLabel: "Title A–Z" }),
    ).toBe("1 of 1 page match · title a–z first");
  });

  it("zero matches still show the clause and the sort", () => {
    expect(
      personalViewFooter({ matchCount: 0, totalCount: 8, sortLabel: "Oldest verification" }),
    ).toBe("0 of 8 pages match · oldest verification first");
  });

  it("omits the sort clause when label is empty/whitespace", () => {
    expect(
      personalViewFooter({ matchCount: 5, totalCount: 9, sortLabel: "   " }),
    ).toBe("5 of 9 pages match");
  });

  it("trims stray whitespace in the sort label before lowercasing", () => {
    expect(
      personalViewFooter({ matchCount: 2, totalCount: 3, sortLabel: "  Oldest Edits  " }),
    ).toBe("2 of 3 pages match · oldest edits first");
  });
});
