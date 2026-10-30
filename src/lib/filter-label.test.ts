import { describe, expect, it } from "vitest";
import { applyFilterReplacement, dayWords, filterLabel } from "./filter-label";
import type { Filter } from "./run-view";

const ctx = {
  people: [
    { id: "u-1", full_name: "Ada Lovelace" },
    { id: "u-2", full_name: "Grace Hopper" },
  ],
  staleDays: 30,
};

describe("filterLabel — one assertion per op", () => {
  it("eq owner resolves to full_name", () => {
    expect(filterLabel({ op: "eq", prop: "owner", value: "u-2" }, ctx)).toBe(
      "owner is Grace Hopper",
    );
  });

  it("eq non-owner uses curly quotes and lowercase prop", () => {
    expect(filterLabel({ op: "eq", prop: "status", value: "shipped" }, ctx)).toBe(
      "status is \u201Cshipped\u201D",
    );
  });

  it("includes uses curly quotes", () => {
    expect(filterLabel({ op: "includes", prop: "tags", value: "urgent" }, ctx)).toBe(
      "tagged \u201Curgent\u201D",
    );
  });

  it("is_me reads as 'owner is you'", () => {
    expect(filterLabel({ op: "is_me", prop: "owner" }, ctx)).toBe("owner is you");
  });

  it("not_empty reads as 'has a {prop}'", () => {
    expect(filterLabel({ op: "not_empty", prop: "stage" }, ctx)).toBe("has a stage");
  });

  it("stale interpolates staleDays", () => {
    expect(filterLabel({ op: "stale", prop: "verified" }, ctx)).toBe("not verified in 30+ days");
    expect(filterLabel({ op: "stale", prop: "verified" }, { ...ctx, staleDays: 45 })).toBe(
      "not verified in 45+ days",
    );
  });

  it("edited_within interpolates value", () => {
    expect(filterLabel({ op: "edited_within", prop: "edited", value: 14 }, ctx)).toBe(
      "edited in the last 14 days",
    );
  });
});

describe("applyFilterReplacement — the ship-exact rule", () => {
  it("second Status yields one chip (same prop+op replaces)", () => {
    const a: Filter = { op: "eq", prop: "status", value: "draft" };
    const b: Filter = { op: "eq", prop: "status", value: "shipped" };
    const out = applyFilterReplacement([a], b);
    expect(out).toEqual([b]);
  });

  it("two Tags yield two chips (includes accumulates)", () => {
    const a: Filter = { op: "includes", prop: "tags", value: "urgent" };
    const b: Filter = { op: "includes", prop: "tags", value: "q3" };
    const out = applyFilterReplacement([a], b);
    expect(out).toEqual([a, b]);
  });

  it("different props coexist", () => {
    const a: Filter = { op: "eq", prop: "status", value: "draft" };
    const b: Filter = { op: "eq", prop: "priority", value: "high" };
    expect(applyFilterReplacement([a], b)).toEqual([a, b]);
  });

  it("a new pick of what a property is replaces the old (2026-10-10)", () => {
    const a: Filter = { op: "not_empty", prop: "stage" };
    const b: Filter = { op: "eq", prop: "stage", value: "review" };
    expect(applyFilterReplacement([a], b)).toEqual([b]);
    const checked: Filter = { op: "eq", prop: "done", value: "true" };
    const not: Filter = { op: "unchecked", prop: "done" };
    expect(applyFilterReplacement([checked], not)).toEqual([not]);
  });

  it("comparisons add up into a range; the same comparison replaces itself", () => {
    const a: Filter = { op: "gte", prop: "effort", value: 3 };
    const b: Filter = { op: "lte", prop: "effort", value: 8 };
    const c: Filter = { op: "lte", prop: "effort", value: 5 };
    expect(applyFilterReplacement([a], b)).toEqual([a, b]);
    expect(applyFilterReplacement([a, b], c)).toEqual([a, c]);
    const today: Filter = { op: "date_is", prop: "due", value: "today" };
    const before: Filter = { op: "before", prop: "due", value: "2026-10-31" };
    expect(applyFilterReplacement([today], before)).toEqual([today, before]);
  });

  it("built-in people read by name", () => {
    expect(
      filterLabel(
        { op: "eq", prop: "@created_by", value: "u1" },
        { people: [{ id: "u1", full_name: "Ana" }], staleDays: 30, defs: [] },
      ),
    ).toBe("created by is Ana");
  });
});

describe("filterLabel — comparisons (2026-10-10)", () => {
  const defs = [
    { key: "due", label: "Due", type: "date" },
    { key: "effort", label: "Effort", type: "number" },
    { key: "notes", label: "Notes", type: "text" },
    { key: "done", label: "Done", type: "checkbox" },
  ];
  const ctx = { people: [{ id: "u1", full_name: "Ana" }], staleDays: 30, defs };
  it("reads like a sentence", () => {
    expect(filterLabel({ op: "date_is", prop: "due", value: "overdue" }, ctx)).toBe(
      "due is overdue",
    );
    expect(filterLabel({ op: "date_is", prop: "due", value: "this_week" }, ctx)).toBe(
      "due is this week",
    );
    expect(filterLabel({ op: "before", prop: "due", value: "today" }, ctx)).toBe(
      "due before today",
    );
    expect(filterLabel({ op: "gt", prop: "effort", value: 3 }, ctx)).toBe("effort above 3");
    expect(filterLabel({ op: "lte", prop: "effort", value: 8 }, ctx)).toBe("effort at most 8");
    expect(filterLabel({ op: "contains", prop: "notes", value: "plan" }, ctx)).toBe(
      "notes contains “plan”",
    );
    expect(filterLabel({ op: "unchecked", prop: "done" }, ctx)).toBe("done is not checked");
    expect(filterLabel({ op: "empty", prop: "due" }, ctx)).toBe("no due");
    expect(filterLabel({ op: "is_me", prop: "@created_by" }, ctx)).toBe("created by is you");
    expect(filterLabel({ op: "date_is", prop: "@created", value: "past_7" }, ctx)).toBe(
      "created in the past 7 days",
    );
  });
  it("days read as dates", () => {
    const now = new Date(2026, 9, 14);
    expect(dayWords("2026-10-20", now)).toBe("Oct 20");
    expect(dayWords("2027-01-02", now)).toBe("Jan 2, 2027");
  });
});

describe("filterLabel — relations", () => {
  it("names the linked page", () => {
    const ctx = {
      people: [],
      staleDays: 30,
      defs: [{ key: "project", label: "Project", type: "relation" }],
      pageTitle: (id: string) => (id === "p1" ? "Website" : "Private page"),
    };
    expect(filterLabel({ op: "includes", prop: "project", value: "p1" }, ctx)).toBe(
      "project includes Website",
    );
    expect(filterLabel({ op: "empty", prop: "project" }, ctx)).toBe("no project");
  });
});

describe("filterLabel — groups", () => {
  it("counts the rules a group holds, nested ones too", () => {
    const rule: Filter = { op: "eq", prop: "status", value: "done" };
    expect(filterLabel({ op: "group", mode: "or", filters: [] }, ctx)).toBe("advanced filter");
    expect(filterLabel({ op: "group", mode: "or", filters: [rule] }, ctx)).toBe("1 rule");
    expect(
      filterLabel(
        {
          op: "group",
          mode: "or",
          filters: [rule, { op: "group", mode: "and", filters: [rule, rule] }],
        },
        ctx,
      ),
    ).toBe("3 rules");
  });
});
