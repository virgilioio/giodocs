import { describe, it, expect } from "vitest";
import {
  dueParts,
  toDueString,
  dueState,
  formatDue,
  dueAgeLabel,
  dueDeltaDays,
  dueRelative,
  dueLabel,
  isPropSet,
  isTerminalStatus,
} from "./due-date";

/* Local noon "now" — the 4pm trap is the whole point of the midnight
 * normalisation, so a couple of cases use a late local hour. */
const NOW = new Date(2026, 7, 8, 12, 0, 0); // 8 Aug 2026, local
const LATE = new Date(2026, 7, 8, 16, 30, 0);

describe("dueParts / toDueString", () => {
  it("parses a plain calendar date", () => {
    expect(dueParts("2026-08-15")).toEqual([2026, 8, 15]);
  });
  it("keeps only the date part of a legacy timestamp", () => {
    expect(toDueString("2026-08-15T00:00:00Z")).toBe("2026-08-15");
  });
  it("rejects junk, numbers and null", () => {
    expect(dueParts("abc")).toBeNull();
    expect(dueParts(3)).toBeNull();
    expect(dueParts(null)).toBeNull();
    expect(dueParts("2026-13-01")).toBeNull();
  });
});

describe("dueState normalises to local midnight", () => {
  it("today is today even at 4:30pm", () => {
    expect(dueState("2026-08-08", LATE)).toBe("today");
  });
  it("yesterday is overdue", () => {
    expect(dueState("2026-08-07", NOW)).toBe("overdue");
  });
  it("tomorrow is future", () => {
    expect(dueState("2026-08-09", NOW)).toBe("future");
  });
  it("a terminal status never reads overdue", () => {
    expect(dueState("2026-08-01", NOW, { terminal: true })).toBe("future");
  });
  it("empty when unset", () => {
    expect(dueState(null, NOW)).toBe("empty");
  });
});

describe("formatDue", () => {
  it("omits the year in the current year", () => {
    expect(formatDue("2026-08-15", NOW)).toBe("Aug 15");
  });
  it("includes a differing year", () => {
    expect(formatDue("2027-08-15", NOW)).toBe("Aug 15, 2027");
  });
});

describe("dueAgeLabel / dueLabel", () => {
  it("counts whole days", () => {
    expect(dueAgeLabel("2026-08-05", NOW)).toBe("3 days ago");
    expect(dueAgeLabel("2026-08-07", NOW)).toBe("yesterday");
  });
  it("overdue label appends the relative age", () => {
    expect(dueLabel("2026-08-05", NOW)).toEqual({
      state: "overdue",
      text: "Aug 5 · 3 days ago",
    });
  });
  it("today reads Today", () => {
    expect(dueLabel("2026-08-08", LATE).text).toBe("Today");
  });
  it("future reads plainly", () => {
    expect(dueLabel("2026-09-01", NOW)).toEqual({
      state: "future",
      text: "Sep 1",
    });
  });
});

describe("dueDeltaDays / dueRelative", () => {
  it("counts calendar days, unaffected by the local hour", () => {
    expect(dueDeltaDays("2026-08-08", LATE)).toBe(0);
    expect(dueDeltaDays("2026-08-09", LATE)).toBe(1);
    expect(dueDeltaDays("2026-08-05", NOW)).toBe(-3);
    expect(dueDeltaDays(null, NOW)).toBeNull();
  });
  it("words the near days plainly", () => {
    expect(dueRelative("2026-08-08", LATE)).toBe("today");
    expect(dueRelative("2026-08-09", NOW)).toBe("tomorrow");
    expect(dueRelative("2026-08-07", NOW)).toBe("yesterday");
  });
  it("days under 14, weeks 14-59, months 60+, then years", () => {
    expect(dueRelative("2026-08-14", NOW)).toBe("in 6 days");
    expect(dueRelative("2026-07-18", NOW)).toBe("3 weeks ago");
    expect(dueRelative("2026-11-08", NOW)).toBe("in 3 months");
    expect(dueRelative("2028-08-08", NOW)).toBe("in 2 years");
  });
});

describe("isPropSet treats null as absent", () => {
  it("null, undefined and empty string are absent", () => {
    expect(isPropSet(null)).toBe(false);
    expect(isPropSet(undefined)).toBe(false);
    expect(isPropSet("")).toBe(false);
  });
  it("an empty array is absent, a full one is present", () => {
    expect(isPropSet([])).toBe(false);
    expect(isPropSet(["a"])).toBe(true);
  });
  it("false and 0 are SET — a checkbox off is a value", () => {
    expect(isPropSet(false)).toBe(true);
    expect(isPropSet(0)).toBe(true);
  });
});

describe("isTerminalStatus", () => {
  it("matches case-insensitively", () => {
    expect(isTerminalStatus("Done")).toBe(true);
    expect(isTerminalStatus("shipped")).toBe(true);
    expect(isTerminalStatus("in_progress")).toBe(false);
    expect(isTerminalStatus(null)).toBe(false);
  });
});
