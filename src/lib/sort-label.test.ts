import { describe, expect, it } from "vitest";
import { sortLabel } from "./sort-label";

const defs = [
  { key: "due", label: "Due" },
  { key: "effort", label: "Effort" },
];

describe("sortLabel", () => {
  it("keeps the familiar names", () => {
    expect(sortLabel({ prop: "edited", dir: "desc" }, defs)).toBe("Newest edits");
    expect(sortLabel(null, defs)).toBe("Newest edits");
    expect(sortLabel({ prop: "title", dir: "asc" }, defs)).toBe("Title A–Z");
  });
  it("names any property, and a second sort", () => {
    expect(sortLabel({ prop: "p:due", dir: "desc" }, defs)).toBe("Due ↓");
    expect(
      sortLabel(
        [
          { prop: "p:due", dir: "asc" },
          { prop: "p:effort", dir: "desc" },
        ],
        defs,
      ),
    ).toBe("Due ↑, then Effort ↓");
    expect(sortLabel({ prop: "@created_by", dir: "asc" }, defs)).toBe("Created by ↑");
  });
});
