import { describe, expect, it } from "vitest";
import { applyFilterReplacement, filterLabel } from "./filter-label";
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
    expect(
      filterLabel({ op: "eq", prop: "status", value: "shipped" }, ctx),
    ).toBe("status is \u201Cshipped\u201D");
  });

  it("includes uses curly quotes", () => {
    expect(
      filterLabel({ op: "includes", prop: "tags", value: "urgent" }, ctx),
    ).toBe("tagged \u201Curgent\u201D");
  });

  it("is_me reads as 'owner is you'", () => {
    expect(filterLabel({ op: "is_me", prop: "owner" }, ctx)).toBe(
      "owner is you",
    );
  });

  it("not_empty reads as 'has a {prop}'", () => {
    expect(filterLabel({ op: "not_empty", prop: "stage" }, ctx)).toBe(
      "has a stage",
    );
  });

  it("stale interpolates staleDays", () => {
    expect(filterLabel({ op: "stale", prop: "verified" }, ctx)).toBe(
      "not verified in 30+ days",
    );
    expect(
      filterLabel({ op: "stale", prop: "verified" }, { ...ctx, staleDays: 45 }),
    ).toBe("not verified in 45+ days");
  });

  it("edited_within interpolates value", () => {
    expect(
      filterLabel({ op: "edited_within", prop: "edited", value: 14 }, ctx),
    ).toBe("edited in the last 14 days");
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

  it("same prop, different op coexists (eq vs not_empty)", () => {
    const a: Filter = { op: "not_empty", prop: "stage" };
    const b: Filter = { op: "eq", prop: "stage", value: "review" };
    expect(applyFilterReplacement([a], b)).toEqual([a, b]);
  });
});
