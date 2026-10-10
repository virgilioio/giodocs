import { describe, expect, it } from "vitest";
import { seedForGroup, seedFromFilters } from "./view-seed";

const DEFS = [
  { key: "area", type: "select" },
  { key: "owner", type: "person" },
  { key: "status", type: "status" },
  { key: "tags", type: "multi_select" },
  { key: "done", type: "checkbox" },
  { key: "effort", type: "number" },
  { key: "due", type: "date" },
  { key: "notes", type: "text" },
];
const WED = new Date(2026, 9, 14, 12);

describe("seedFromFilters", () => {
  it("takes the values the filters name", () => {
    expect(
      seedFromFilters(
        [
          { op: "eq", prop: "area", value: "Ops" },
          { op: "is_me", prop: "owner" },
          { op: "includes", prop: "tags", value: "q4" },
          { op: "includes", prop: "tags", value: "hiring" },
          { op: "eq", prop: "done", value: "true" },
          { op: "eq", prop: "effort", value: "3" },
        ],
        DEFS,
        "me",
        WED,
      ),
    ).toEqual({ area: "Ops", owner: "me", tags: ["q4", "hiring"], done: true, effort: 3 });
  });
  it("dates: today, tomorrow, an exact day; nothing for ranges in the past", () => {
    const s = (value: string) =>
      seedFromFilters([{ op: "date_is", prop: "due", value }], DEFS, "me", WED);
    expect(s("today")).toEqual({ due: "2026-10-14" });
    expect(s("tomorrow")).toEqual({ due: "2026-10-15" });
    expect(s("2026-11-02")).toEqual({ due: "2026-11-02" });
    expect(s("this_week")).toEqual({ due: "2026-10-14" });
    expect(s("overdue")).toEqual({});
    expect(s("last_week")).toEqual({});
  });
  it("comparisons, built-ins and unknown properties seed nothing", () => {
    expect(
      seedFromFilters(
        [
          { op: "contains", prop: "notes", value: "x" },
          { op: "gt", prop: "effort", value: 2 },
          { op: "is_me", prop: "@created_by" },
          { op: "eq", prop: "gone", value: "x" },
          { op: "unchecked", prop: "done" },
        ],
        DEFS,
        "me",
        WED,
      ),
    ).toEqual({ done: false });
  });
});

describe("seedForGroup", () => {
  it("sets the grouped property", () => {
    expect(seedForGroup("status", "todo", DEFS)).toEqual({ status: "todo" });
    expect(seedForGroup("done", "false", DEFS)).toEqual({ done: false });
    expect(seedForGroup("tags", "q4", DEFS)).toEqual({ tags: ["q4"] });
    expect(seedForGroup("status", null, DEFS)).toEqual({});
    expect(seedForGroup("@created_by", "me", DEFS)).toEqual({});
  });
});

describe("seeding relations", () => {
  const defs = [
    { key: "project", type: "relation", config: {} },
    { key: "tasks", type: "relation", config: { of: "project" } },
  ];
  it("a relation filter links the new page; a far side can't be seeded", () => {
    expect(
      seedFromFilters(
        [
          { op: "includes", prop: "project", value: "p1" },
          { op: "includes", prop: "tasks", value: "t1" },
        ],
        defs,
        "me",
      ),
    ).toEqual({ project: ["p1"] });
  });
});
