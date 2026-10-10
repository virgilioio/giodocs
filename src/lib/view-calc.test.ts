import { describe, expect, it } from "vitest";
import { calcsFor, calculate } from "./view-calc";
import type { PageListItem } from "./types";

function pg(
  id: string,
  props: Record<string, unknown>,
  extra: Partial<PageListItem> = {},
): PageListItem {
  return {
    id,
    title: id,
    icon: "",
    props: props as PageListItem["props"],
    verified_at: "2026-10-01T10:00:00Z",
    verified_by: null,
    edited_at: "2026-10-01T10:00:00Z",
    edited_by: null,
    access_type: "workspace",
    ...extra,
  };
}

const NOW = new Date(2026, 9, 14);
const rows = [
  pg("a", { effort: 3, due: "2026-10-20", done: true, tags: ["q4", "ops"] }),
  pg("b", { effort: "8", due: "2026-10-12", tags: ["q4"] }),
  pg("c", { effort: 0, done: false }),
  pg("d", {}),
];

describe("calculate", () => {
  it("counts", () => {
    expect(calculate("count_all", rows, "effort", NOW)).toBe("4");
    expect(calculate("count_values", rows, "due", NOW)).toBe("2");
    expect(calculate("count_empty", rows, "due", NOW)).toBe("2");
    expect(calculate("percent_not_empty", rows, "effort", NOW)).toBe("75%");
    expect(calculate("count_unique", rows, "tags", NOW)).toBe("2");
    expect(calculate("percent_empty", [], "due", NOW)).toBe("0%");
  });
  it("numbers", () => {
    expect(calculate("sum", rows, "effort", NOW)).toBe("11");
    expect(calculate("average", rows, "effort", NOW)).toBe("3.67");
    expect(calculate("median", rows, "effort", NOW)).toBe("3");
    expect(calculate("min", rows, "effort", NOW)).toBe("0");
    expect(calculate("max", rows, "effort", NOW)).toBe("8");
    expect(calculate("range", rows, "effort", NOW)).toBe("8");
    expect(calculate("sum", rows, "missing", NOW)).toBe("");
    expect(calculate("sum", [pg("x", { n: 12450000 })], "n", NOW)).toBe("12,450,000");
  });
  it("dates", () => {
    expect(calculate("earliest", rows, "due", NOW)).toBe("Oct 12");
    expect(calculate("latest", rows, "due", NOW)).toBe("Oct 20");
    expect(calculate("date_range", rows, "due", NOW)).toBe("8 days");
    expect(calculate("earliest", rows, "@edited", NOW)).toBe("Oct 1");
  });
  it("checkboxes: blank is not checked", () => {
    expect(calculate("checked", rows, "done", NOW)).toBe("1");
    expect(calculate("unchecked", rows, "done", NOW)).toBe("3");
    expect(calculate("percent_checked", rows, "done", NOW)).toBe("25%");
  });
});

describe("calcsFor", () => {
  it("offers what fits the type", () => {
    expect(calcsFor("number")).toContain("sum");
    expect(calcsFor("date")).toContain("earliest");
    expect(calcsFor("text")).not.toContain("sum");
    expect(calcsFor("checkbox")).toContain("percent_checked");
    expect(calcsFor("checkbox")).not.toContain("count_empty");
    expect(calcsFor("title")).toEqual(["count_all"]);
  });
});
