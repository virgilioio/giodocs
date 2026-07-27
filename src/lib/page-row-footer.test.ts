import { describe, expect, it } from "vitest";
import { pageRowFooter } from "./page-row-footer";

describe("pageRowFooter", () => {
  it("joins edit + verify with different verbs — the point of the footer", () => {
    expect(
      pageRowFooter({
        editedRel: "3 hours ago",
        firstName: "Anouk",
        verifiedRel: "yesterday",
      }),
    ).toBe("Edited 3 hours ago by Anouk · verified yesterday");
  });

  it("drops the 'by …' fragment when the first name is missing", () => {
    expect(
      pageRowFooter({ editedRel: "5 minutes ago", verifiedRel: "last week" }),
    ).toBe("Edited 5 minutes ago · verified last week");
  });

  it("drops the verify clause when verifiedRel is empty", () => {
    expect(
      pageRowFooter({ editedRel: "2 days ago", firstName: "Sam" }),
    ).toBe("Edited 2 days ago by Sam");
  });

  it("returns empty string when there is no edited timestamp", () => {
    expect(pageRowFooter({ editedRel: null, firstName: "Sam" })).toBe("");
    expect(pageRowFooter({ editedRel: "  ", verifiedRel: "today" })).toBe("");
  });

  it("trims whitespace on all inputs before deciding what to render", () => {
    expect(
      pageRowFooter({
        editedRel: "  just now  ",
        firstName: "  Jo  ",
        verifiedRel: "  today  ",
      }),
    ).toBe("Edited just now by Jo · verified today");
  });
});
