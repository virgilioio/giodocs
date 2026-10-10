import { describe, expect, it } from "vitest";
import { planGridToDatabase } from "./table-to-database";

describe("turning a grid into a database", () => {
  it("first column is the title, the header names the properties", () => {
    const plan = planGridToDatabase(
      [
        ["Name", "**Role**", "Team"],
        ["Ana", "PM", "Ops"],
        ["", "", ""],
        ["Ben", "Eng", ""],
      ],
      true,
    );
    expect(plan.labels).toEqual(["Role", "Team"]);
    expect(plan.records).toEqual([
      { title: "Ana", values: ["PM", "Ops"] },
      { title: "Ben", values: ["Eng", ""] },
    ]);
  });
  it("without a header row every row is a row and columns get numbers", () => {
    const plan = planGridToDatabase([["a", "b"], ["c", "d"]], false);
    expect(plan.labels).toEqual(["Column 2"]);
    expect(plan.records.map((r) => r.title)).toEqual(["a", "c"]);
  });
  it("repeated or empty header names stay distinct", () => {
    expect(planGridToDatabase([["x", "Note", "note", ""]], true).labels).toEqual(["Note", "note 2", "Column 4"]);
  });
});
