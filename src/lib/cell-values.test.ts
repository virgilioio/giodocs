import { describe, expect, it } from "vitest";
import { cellText, cellWritable, parseCell, sameKind } from "./cell-values";

const options = [
  { value: "todo", label: "Not started" },
  { value: "done", label: "Done" },
];
const people = [
  { id: "u1", name: "Ada Lovelace", email: "ada@x.io" },
  { id: "u2", name: "Grace Hopper", email: "grace@x.io" },
];
const today = new Date(2026, 9, 30);

describe("cellText", () => {
  it("writes each kind as you'd read it", () => {
    expect(cellText("title", undefined, "Plan")).toBe("Plan");
    expect(cellText("status", "status", "done", { options })).toBe("Done");
    expect(cellText("done", "checkbox", true)).toBe("Yes");
    expect(cellText("tags", "multi_select", ["a", "b"])).toBe("a, b");
    expect(cellText("who", "person", ["u1", "u2"], { people })).toBe("Ada Lovelace, Grace Hopper");
    expect(cellText("who", "person", ["u1", "gone"], { people })).toBe("Ada Lovelace");
    expect(cellText("due", "date", "2026-11-03/2026-11-05")).toBe("2026-11-03/2026-11-05");
    expect(cellText("n", "number", 1200)).toBe("1200");
    expect(cellText("x", "text", null)).toBe("");
  });
});

describe("parseCell", () => {
  it("reads text into each kind, and refuses what doesn't fit", () => {
    expect(parseCell("due", "date", "2026-10-31", { today })).toEqual({
      ok: true,
      value: "2026-10-31",
    });
    expect(parseCell("due", "date", "tomorrow", { today })).toEqual({
      ok: true,
      value: "2026-10-31",
    });
    expect(parseCell("due", "date", "2026-11-05/2026-11-03")).toEqual({
      ok: true,
      value: "2026-11-03/2026-11-05",
    });
    expect(parseCell("due", "date", "someday", { today }).ok).toBe(false);
    expect(parseCell("n", "number", "$1,200")).toEqual({ ok: true, value: 1200 });
    expect(parseCell("n", "number", "lots").ok).toBe(false);
    expect(parseCell("done", "checkbox", "✓")).toEqual({ ok: true, value: true });
    expect(parseCell("done", "checkbox", "FALSE")).toEqual({ ok: true, value: false });
    expect(parseCell("done", "checkbox", "maybe").ok).toBe(false);
    expect(parseCell("status", "status", "done", { options })).toEqual({ ok: true, value: "done" });
    expect(parseCell("status", "status", "not started", { options })).toEqual({
      ok: true,
      value: "todo",
    });
    expect(parseCell("status", "status", "Blocked", { options }).ok).toBe(false);
    expect(parseCell("area", "select", "Design", { options })).toEqual({
      ok: "new-option",
      label: "Design",
    });
    expect(parseCell("tags", "multi_select", "a, b, a")).toEqual({ ok: true, value: ["a", "b"] });
    expect(parseCell("who", "person", "grace@x.io, me", { people, me: "u1" })).toEqual({
      ok: true,
      value: ["u2", "u1"],
    });
    expect(parseCell("who", "person", "Ada Lovelace", { people, onePerson: true })).toEqual({
      ok: true,
      value: "u1",
    });
    expect(parseCell("who", "person", "Nobody", { people }).ok).toBe(false);
    expect(parseCell("site", "url", "example.com").ok).toBeDefined();
    expect(parseCell("x", "text", "  ")).toEqual({ ok: true, value: null });
    expect(parseCell("title", undefined, " New plan ")).toEqual({ ok: true, value: "New plan" });
    expect(parseCell("r", "rollup", "3").ok).toBe(false);
  });

  it("carries a date's time both ways", () => {
    const v = parseCell("due", "date", "2026-11-03 14:45");
    expect(v.ok).toBe(true);
    const stored = (v as { value: string }).value;
    expect(stored).toMatch(/^2026-11-03T14:45[+-]\d{2}:\d{2}$/);
    expect(cellText("due", "date", stored)).toBe("2026-11-03 14:45");
    const r = parseCell("due", "date", "2026-11-03 09:00/2026-11-03 10:30");
    expect(cellText("due", "date", (r as { value: string }).value)).toBe(
      "2026-11-03 09:00/2026-11-03 10:30",
    );
  });

  it("knows what can be written", () => {
    expect(cellWritable("title", undefined)).toBe(true);
    expect(cellWritable("@edited", "date")).toBe(false);
    expect(cellWritable("f", "formula")).toBe(false);
    expect(cellWritable("due", "date")).toBe(true);
  });

  it("moves values as they are only between columns of the same kind", () => {
    expect(sameKind({ key: "a", type: "date" }, { key: "b", type: "date" })).toBe(true);
    expect(sameKind({ key: "a", type: "select" }, { key: "b", type: "select" })).toBe(false);
    expect(sameKind({ key: "title" }, { key: "x", type: "text" })).toBe(false);
  });
});
